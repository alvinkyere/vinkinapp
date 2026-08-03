/**
 * ENG6 Slice 6 — read-only operations console transport over the webhook inbox and
 * reconciliation engine. Diagnostic, not transactional, BY CONSTRUCTION: every route here
 * either reads (`ops-queries.ts` has no write path to any financial table) or writes only to
 * `reconciliation_findings.review_status` (an operator-annotation column, Slice 5's own
 * migration) or `operator_audit_log` (the immutable audit trail, PV11/D17's existing table,
 * reused rather than duplicated). No route here can move money, approve a payment, issue a
 * refund, create a card, or alter a provider/ledger record — there is no code path to do so
 * anywhere in this file.
 *
 * Same environment/auth gating as the rest of the ops console (`simulatorRoutesPermitted` +
 * `requireOperator`, reused verbatim from `modules/ops/routes.ts` — not a lookalike).
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { simulatorRoutesPermitted } from '../../config/simulator-guard.ts';
import { requireOperator } from '../ops/routes.ts';
import { insertAuditEntry } from '../ops/store.ts';
import { findingIdParams, webhookEventIdParams } from '../../middleware/params.ts';
import {
  getFindingDetail,
  getWebhookEventDetail,
  listFindings,
  listWebhookEvents,
  setFindingReviewStatus,
  type ReviewStatus,
} from './ops-queries.ts';
import { runReconciliation } from './runner.ts';
import { ingestWebhookEvent, type WebhookRouteConfig } from '../webhooks/routes.ts';

const CLASSIFICATIONS = ['EXPECTED', 'PENDING', 'MISMATCHED', 'ORPHANED', 'UNRECOGNIZED'] as const;
const REVIEW_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;

const listWebhookEventsQuery = z.object({
  provider: z.string().optional(),
  status: z.enum(['received', 'dead_letter']).optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

const listFindingsQuery = z.object({
  classification: z.enum(CLASSIFICATIONS).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  provider: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

const reviewBodySchema = z.object({ notes: z.string().max(2000).optional() });
const resolveBodySchema = z.object({ notes: z.string().min(1).max(2000) });

/**
 * A module-level in-process flag, not a distributed lock — "prevent concurrent executions"
 * for the realistic scope this slice targets (a manual, operator-triggered action against a
 * single running API instance, no scheduler). PostgreSQL's own `FOR UPDATE SKIP LOCKED`
 * inside `runReconciliation` (Slice 5, proven by its own concurrent-run test) is the deeper
 * correctness guarantee regardless — this flag exists purely to give an operator a clear
 * "a run is already in progress" response instead of two runs silently interleaving,
 * disclosed as a single-instance limitation in the milestone report, not hidden.
 */
let runInProgress = false;
let lastRun: {
  runId: string;
  eventsExamined: number;
  findingsCreated: number;
  completedAt: string;
} | null = null;

export function registerReconciliationOpsRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  webhookConfigsByProvider: Map<string, WebhookRouteConfig>,
): void {
  if (!simulatorRoutesPermitted(env.VINKIN_ENV)) return; // same allowlist as the rest of ops

  async function operatorOrReply(
    request: Parameters<typeof requireOperator>[0],
    reply: FastifyReply,
  ) {
    return requireOperator(request, reply, env);
  }

  // --- webhook inbox (read-only) ------------------------------------------------------

  app.get('/internal/ops/reconciliation/webhook-events', async (request, reply) => {
    if ((await operatorOrReply(request, reply)) === null) return;
    const query = listWebhookEventsQuery.parse(request.query);
    return reply.send(await listWebhookEvents(sql, query));
  });

  app.get('/internal/ops/reconciliation/webhook-events/:webhookEventId', async (request, reply) => {
    if ((await operatorOrReply(request, reply)) === null) return;
    const { webhookEventId } = webhookEventIdParams.parse(request.params);
    const detail = await getWebhookEventDetail(sql, webhookEventId);
    if (detail === null) return reply.code(404).send({ error: 'WEBHOOK_EVENT_NOT_FOUND' });
    return reply.send(detail);
  });

  // --- dead-letter replay --------------------------------------------------------------

  app.post(
    '/internal/ops/reconciliation/webhook-events/:webhookEventId/replay',
    async (request, reply) => {
      const operator = await operatorOrReply(request, reply);
      if (operator === null) return;
      const { webhookEventId } = webhookEventIdParams.parse(request.params);

      const existing = await getWebhookEventDetail(sql, webhookEventId);
      if (existing === null) return reply.code(404).send({ error: 'WEBHOOK_EVENT_NOT_FOUND' });

      const config = webhookConfigsByProvider.get(existing.provider);
      if (config === undefined) {
        // Honest failure, not a silent no-op or a fabricated success: this provider has no
        // currently-configured ingestion route to replay through (e.g. the Stripe webhook
        // flag is off, or these are stale mock-provider rows from a test environment) — the
        // "normal ingestion path" genuinely does not exist right now for this provider.
        return reply.code(409).send({
          error: 'NO_INGESTION_PATH_CONFIGURED',
          message: `no currently-configured webhook route for provider "${existing.provider}"`,
        });
      }

      const rows = (await sql`
        SELECT raw_body, signature_header FROM webhook_events WHERE id = ${webhookEventId}
      `) as unknown as { raw_body: string; signature_header: string | null }[];
      const row = rows[0];
      if (row === undefined) return reply.code(404).send({ error: 'WEBHOOK_EVENT_NOT_FOUND' });
      if (row.signature_header === null) {
        return reply.code(409).send({
          error: 'NO_STORED_SIGNATURE',
          message:
            'this event predates signature-header storage and cannot be replayed through real verification',
        });
      }

      // The EXACT same function the live webhook route calls (modules/webhooks/routes.ts) —
      // real signature re-verification against the stored raw body, real dedupe. Never a
      // direct status flip on the row.
      const result = await ingestWebhookEvent(sql, config, row.raw_body, row.signature_header);

      await insertAuditEntry(sql, {
        operatorName: operator.operatorName,
        action: 'WEBHOOK_EVENT_REPLAYED',
        correlationId: String(request.id),
        details: {
          findingId: null,
          webhookEventId,
          outcome: result.outcome,
          replayedWebhookEventId: result.webhookEventId,
        },
      });

      return reply.send({
        outcome: result.outcome,
        webhookEventId: result.webhookEventId,
        deliveryCount: result.deliveryCount,
      });
    },
  );

  // --- reconciliation findings (read-only + review workflow) ----------------------------

  app.get('/internal/ops/reconciliation/findings', async (request, reply) => {
    if ((await operatorOrReply(request, reply)) === null) return;
    const query = listFindingsQuery.parse(request.query);
    return reply.send(await listFindings(sql, query));
  });

  app.get('/internal/ops/reconciliation/findings/:findingId', async (request, reply) => {
    if ((await operatorOrReply(request, reply)) === null) return;
    const { findingId } = findingIdParams.parse(request.params);
    const detail = await getFindingDetail(sql, findingId);
    if (detail === null) return reply.code(404).send({ error: 'FINDING_NOT_FOUND' });
    return reply.send(detail);
  });

  // Auth is checked FIRST, before params/body validation, in every route below — an
  // unauthenticated caller must always see 401, never a 400 that leaks the route's expected
  // shape ahead of authenticating (a real bug this slice's own AUTHZ test caught: `resolve`'s
  // required `notes` field previously threw a ZodError, and hence a 400, before the auth
  // check ever ran, for any unauthenticated request with no body).
  async function review(
    request: Parameters<typeof requireOperator>[0],
    reply: FastifyReply,
    newStatus: ReviewStatus,
    action: string,
    parseBody: () => { notes?: string },
  ): Promise<unknown> {
    const operator = await operatorOrReply(request, reply);
    if (operator === null) return undefined;

    const { findingId } = findingIdParams.parse(request.params);
    const body = parseBody();

    const before = await getFindingDetail(sql, findingId);
    if (before === null) return reply.code(404).send({ error: 'FINDING_NOT_FOUND' });

    const updated = await setFindingReviewStatus(sql, findingId, newStatus);
    if (updated === null) return reply.code(404).send({ error: 'FINDING_NOT_FOUND' });

    await insertAuditEntry(sql, {
      operatorName: operator.operatorName,
      action,
      vinkId: before.linkedVinkId ?? undefined,
      correlationId: String(request.id),
      details: {
        findingId,
        previousReviewStatus: before.reviewStatus,
        newReviewStatus: newStatus,
        notes: body.notes ?? null,
      },
    });

    return reply.send(updated);
  }

  app.post(
    '/internal/ops/reconciliation/findings/:findingId/acknowledge',
    async (request, reply) => {
      return review(request, reply, 'ACKNOWLEDGED', 'RECONCILIATION_FINDING_ACKNOWLEDGED', () =>
        reviewBodySchema.parse(request.body ?? {}),
      );
    },
  );

  app.post('/internal/ops/reconciliation/findings/:findingId/resolve', async (request, reply) => {
    return review(request, reply, 'RESOLVED', 'RECONCILIATION_FINDING_RESOLVED', () =>
      resolveBodySchema.parse(request.body),
    );
  });

  // --- manual reconciliation run ---------------------------------------------------------

  app.get('/internal/ops/reconciliation/run-status', async (request, reply) => {
    if ((await operatorOrReply(request, reply)) === null) return;
    return reply.send({ inProgress: runInProgress, lastRun });
  });

  app.post('/internal/ops/reconciliation/run', async (request, reply) => {
    // The check-and-claim below is the FIRST thing this handler does — no `await` precedes
    // it — so it is atomic with respect to any other JS execution (the event loop cannot
    // interleave two synchronous prefixes). Checking `runInProgress` after an `await
    // operatorOrReply(...)` would reopen exactly the race this guard exists to close: two
    // concurrent requests could both observe `false` before either sets it `true`.
    if (runInProgress) {
      return reply.code(409).send({ error: 'RECONCILIATION_RUN_IN_PROGRESS' });
    }
    runInProgress = true;
    try {
      const operator = await operatorOrReply(request, reply);
      if (operator === null) return; // operatorOrReply already sent 401

      const body = z
        .object({ batchSize: z.coerce.number().int().positive().optional() })
        .parse(request.body ?? {});

      const result = await runReconciliation(sql, body.batchSize);
      lastRun = {
        runId: result.runId,
        eventsExamined: result.eventsExamined,
        findingsCreated: result.findingsCreated,
        completedAt: new Date().toISOString(),
      };
      await insertAuditEntry(sql, {
        operatorName: operator.operatorName,
        action: 'RECONCILIATION_RUN_TRIGGERED',
        correlationId: String(request.id),
        details: { ...result },
      });
      return reply.send(lastRun);
    } finally {
      runInProgress = false;
    }
  });
}
