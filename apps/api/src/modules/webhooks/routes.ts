/**
 * ENG6 Slice 4 — provider webhook ingestion framework (§28, D46). Deliberately
 * provider-agnostic: the route is a thin binding over `FinancialProvider.parseWebhookEvent`
 * (which already does signature verification internally, per that method's own doc comment —
 * "verification is inherently provider-specific"), so the identical framework here is proven
 * offline against `MockFinancialProvider` (fast, no network, no credentials) and, separately,
 * against the real Stripe sandbox adapter built in Slice 3 — matching Slice 1's own audit
 * finding that webhook ingestion is "buildable against the mock's synthetic events regardless
 * of how the M0 question resolves."
 *
 * §28's own three-step rule, followed in order: verify signature (delegated into
 * `parseWebhookEvent`; an invalid signature is rejected with 400 and NOTHING is stored — an
 * unverified body cannot be trusted enough to persist), store raw (the exact bytes the
 * signature covered, not a re-serialized object), dedupe on `(provider, provider_event_id)`
 * (PostgreSQL's own `UNIQUE` constraint via `ON CONFLICT` — the final guard, per this
 * codebase's hard idempotency rule, not just an app-layer check).
 *
 * This route is unversioned (`/webhooks/...`, not `/api/v1/...`) — a provider's webhook
 * sender is not a first-party VinkIn client the versioning policy governs, the same reasoning
 * that already carves out `/internal/simulator/*` and `/internal/ops/*`.
 *
 * `ingestWebhookEvent` is exported deliberately (ENG6 Slice 6): it is the ENTIRE ingestion
 * logic, not just what the HTTP handler happens to call — an operator-triggered "replay" of a
 * dead-lettered event calls this exact function again with the originally stored raw body and
 * signature, so replay is provably "the normal ingestion path," never a parallel shortcut that
 * bypasses signature verification or dedupe.
 *
 * NOT built here (out of Slice 4's scope, ENG6's own hard boundary against inventing
 * "automatic reconciliation repairs without reviewed rules"): any processor that reads these
 * rows and changes Vink/contribution/settlement state. This table is a durable, deduped
 * inbox; ENG6 Slice 5 is what reads it, Slice 6 is read-only visibility over both.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import postgres from 'postgres';
import type { Sql } from '../../db/client.ts';
import { NOOP_METRICS, type Metrics } from '../../observability/metrics.ts';
import {
  ProviderError,
  type FinancialProvider,
  type ProviderEvent,
} from '../../../../../packages/payment-provider/src/index.ts';

export interface WebhookRouteConfig {
  /** e.g. `/webhooks/stripe/sandbox` — the "isolated... different route" half of D46's own
   * hard guard; a future live-mode integration must mount at a different path entirely, never
   * this one. */
  routePath: string;
  /** Used only to verify+parse inbound events (`parseWebhookEvent`) — deliberately NOT the
   * same provider instance wired into command execution (D15/Slice 3's own documented
   * boundary); this route never drives application state. */
  provider: FinancialProvider;
  webhookSecret: string;
  /** e.g. `stripe-signature` — the provider's own signature header name. */
  signatureHeaderName: string;
}

export type WebhookIngestOutcome = 'received' | 'duplicate' | 'dead_letter' | 'invalid_signature';

export interface WebhookIngestResult {
  outcome: WebhookIngestOutcome;
  webhookEventId: string | null;
  deliveryCount: number | null;
  /** RM4C — the parsed, ALREADY signature-verified event, present only on `received`/
   * `duplicate` (never on `dead_letter`/`invalid_signature`, where nothing was structurally
   * mapped or trusted). Lets a caller (the live route below) trigger further processing
   * without re-parsing/re-verifying a body it already verified once. */
  event: ProviderEvent | null;
}

/** The "id" field is a near-universal webhook envelope convention (confirmed for Stripe's own
 * raw shape in Slice 3); used only as a best-effort dedupe key for events this adapter could
 * verify the signature of but not structurally map (dead-letter path). A provider whose raw
 * envelope has no such field falls back to a hash of the raw body itself — deliberately NOT a
 * fresh random id: the dedupe key must be a deterministic function of content, or replaying
 * the identical delivery would mint a new "distinct" row every time, defeating the entire
 * point of a dead-letter dedupe key (a real bug this route's own tests caught: two identical
 * dead-letter deliveries produced two rows before this was fixed to hash instead of
 * randomUUID()). */
function extractBestEffortId(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as { id: unknown }).id === 'string'
    ) {
      return (parsed as { id: string }).id;
    }
  } catch {
    // fall through to the content hash below
  }
  return `unidentified:${createHash('sha256').update(rawBody).digest('hex')}`;
}

/**
 * The entire ingestion decision, independent of HTTP/Fastify — verify, store raw, dedupe.
 * Called by the live route below AND, verbatim, by ENG6 Slice 6's replay endpoint
 * (`modules/reconciliation/routes.ts`) — the same function, not a lookalike, is what makes
 * "replay always goes through the normal ingestion path" true rather than asserted.
 *
 * Idempotent by construction: an `ON CONFLICT ... DO UPDATE SET delivery_count =
 * delivery_count + 1` upsert (not `DO NOTHING`) means a redelivery is always durably counted
 * (Slice 6's own "retry count" requirement) while still never creating a second row or
 * reprocessing anything — `deliveryCount === 1` on the returned row is what distinguishes a
 * fresh delivery from a redelivery, not a separate existence check.
 */
export async function ingestWebhookEvent(
  sql: Sql,
  config: Pick<WebhookRouteConfig, 'provider' | 'webhookSecret'>,
  rawBody: string,
  signatureHeader: string,
): Promise<WebhookIngestResult> {
  let event;
  try {
    event = config.provider.parseWebhookEvent({
      rawBody,
      signatureHeader,
      webhookSecret: config.webhookSecret,
    });
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'INVALID_SIGNATURE') {
      return {
        outcome: 'invalid_signature',
        webhookEventId: null,
        deliveryCount: null,
        event: null,
      };
    }
    // Signature-independent failure (e.g. NOT_SUPPORTED — an event type this adapter has no
    // mapping for yet). Never silently dropped, never retried forever either: a durable
    // dead-letter row, acknowledged so the provider stops resending an event this adapter
    // will never be able to process.
    const message = error instanceof Error ? error.message : String(error);
    const dedupeId = extractBestEffortId(rawBody);
    const rows = (await sql`
      INSERT INTO webhook_events
        (provider, provider_event_id, raw_body, signature_header, status, last_error)
      VALUES
        (${config.provider.providerName}, ${dedupeId}, ${rawBody}, ${signatureHeader},
         'dead_letter', ${message})
      ON CONFLICT (provider, provider_event_id)
        DO UPDATE SET delivery_count = webhook_events.delivery_count + 1, last_error = ${message}
      RETURNING id, delivery_count
    `) as unknown as { id: string; delivery_count: number }[];
    const row = rows[0]!;
    return {
      outcome: 'dead_letter',
      webhookEventId: row.id,
      deliveryCount: row.delivery_count,
      event: null,
    };
  }

  const rows = (await sql`
    INSERT INTO webhook_events
      (provider, provider_event_id, event_type, object_id, occurred_at, raw_body,
       signature_header, payload)
    VALUES
      (${event.provider}, ${event.providerEventId}, ${event.type}, ${event.objectId},
       ${event.occurredAt}, ${rawBody}, ${signatureHeader},
       ${sql.json(event.payload as postgres.JSONValue)})
    ON CONFLICT (provider, provider_event_id)
      DO UPDATE SET delivery_count = webhook_events.delivery_count + 1
    RETURNING id, delivery_count
  `) as unknown as { id: string; delivery_count: number }[];
  const row = rows[0]!;
  // A redelivery (delivery_count > 1) is replay protection in action: acknowledged
  // identically to a first delivery, never reprocessed, never rejected as an error either
  // (rejecting a duplicate would make the sender retry it forever, believing it never
  // succeeded).
  const outcome: WebhookIngestOutcome = row.delivery_count === 1 ? 'received' : 'duplicate';
  return { outcome, webhookEventId: row.id, deliveryCount: row.delivery_count, event };
}

export function registerWebhookRoutes(
  app: FastifyInstance,
  sql: Sql,
  config: WebhookRouteConfig,
  metrics: Metrics = NOOP_METRICS,
  /** RM4C — invoked after a freshly-stored OR redelivered event (never dead-letter/invalid-
   * signature, where nothing was verified/mapped). Errors are caught and logged here, never
   * allowed to turn an already-successful ingestion into a failed HTTP response — the raw
   * event is durably stored either way; this is best-effort further processing on top. */
  onEventIngested?: (event: ProviderEvent, request: FastifyRequest) => Promise<void>,
): void {
  app.register(async (instance) => {
    // Raw-body capture, scoped to THIS encapsulated Fastify context only — Fastify's plugin
    // encapsulation means every other route's normal JSON-object body parsing is untouched.
    // Signature verification needs the exact bytes the provider signed; Fastify's default
    // JSON parser would re-serialize the object, changing whitespace/key order and silently
    // breaking every signature check.
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    instance.post(config.routePath, async (request, reply) => {
      const rawBody = request.body as string;
      const signatureHeader = request.headers[config.signatureHeaderName];
      if (typeof signatureHeader !== 'string') {
        return reply.code(400).send({ error: 'MISSING_SIGNATURE' });
      }

      const result = await ingestWebhookEvent(sql, config, rawBody, signatureHeader);
      metrics.recordWebhookIngestion({
        provider: config.provider.providerName,
        outcome: result.outcome,
      });

      if (result.outcome === 'invalid_signature') {
        request.log.warn({ provider: config.provider.providerName }, 'webhook signature rejected');
        return reply.code(400).send({ error: 'INVALID_SIGNATURE' });
      }
      if (result.outcome === 'dead_letter') {
        request.log.error({ provider: config.provider.providerName }, 'webhook dead-lettered');
        return reply.code(200).send({ status: 'dead_letter' });
      }
      request.log.info(
        { provider: config.provider.providerName, duplicate: result.outcome === 'duplicate' },
        'webhook received',
      );
      if (onEventIngested && result.event) {
        try {
          await onEventIngested(result.event, request);
        } catch (error) {
          request.log.error(
            { provider: config.provider.providerName, err: error },
            'onEventIngested hook failed — event is durably stored, safe to retry via sweep',
          );
        }
      }
      return reply.code(200).send({ status: result.outcome });
    });
  });
}
