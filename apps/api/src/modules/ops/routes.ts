/**
 * Operations console transport (PV11, D17). Read routes are a new query layer
 * (`./store.ts`) purpose-built for inspection — never used to decide anything. The two
 * action routes (merchant-authorization, capture) call the EXACT SAME application commands
 * `/internal/simulator/*` calls (PV6) — this module introduces no new financial semantics,
 * only operator auth in front of existing behavior and an audit-log write after it.
 * Environment-gated identically to the simulator surface (governance §5); additionally
 * requires an operator token (`auth/operator-tokens.ts`) on every route but login.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApplicationError,
  authorizeMerchantPurchaseCommand,
  settlePurchaseCommand,
  type PurchaseCommandContext,
} from '../../../../../packages/application/src/index.ts';
import {
  DomainError,
  IllegalTransitionError,
  type VinkId,
} from '../../../../../packages/domain/src/index.ts';
import {
  MockFinancialProvider,
  type FinancialProvider,
} from '../../../../../packages/payment-provider/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { simulatorRoutesPermitted } from '../../config/simulator-guard.ts';
import { signOperatorToken, verifyOperatorToken } from '../../auth/operator-tokens.ts';
import { authorizationIdParams, vinkIdParams } from '../../middleware/params.ts';
import { PostgresVinkStore } from '../vinks/store.ts';
import { getVinkDetail, insertAuditEntry, listAuditLog, searchVinks } from './store.ts';
import { getFunnelSummary } from './analytics.ts';
import { toCommandLogger } from '../../observability/command-logger.ts';
import { toCommandMetrics } from '../../observability/command-metrics.ts';
import { withProviderLogging } from '../../observability/provider-logging.ts';
import { NOOP_METRICS, type Metrics } from '../../observability/metrics.ts';
import { tagActiveSpan } from '../../observability/tracing.ts';

const merchantSchema = z.object({
  merchantName: z.string().min(1).max(120).default('Simulated Merchant'),
  merchantIdentifier: z.string().min(1).max(120).default('SIM-MERCHANT-1'),
  mcc: z
    .string()
    .regex(/^\d{4}$/)
    .default('5411'),
  amountMinor: z.number().int().positive(),
});

const captureSchema = z.object({
  vinkId: z.uuid(),
  providerAuthorizationId: z.string().optional(),
  settledAmountMinor: z.number().int().positive(),
});

function mapError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof ApplicationError) {
    const status =
      error.code === 'VINK_NOT_FOUND' || error.code === 'PARTICIPANT_NOT_FOUND' ? 404 : 422;
    return { status, body: { error: error.code, message: error.message } };
  }
  if (error instanceof IllegalTransitionError) {
    return { status: 409, body: { error: error.code, message: error.message } };
  }
  if (error instanceof DomainError) {
    return { status: 422, body: { error: error.code, message: error.message } };
  }
  return null;
}

/** Exported for reuse by `modules/reconciliation/routes.ts` (ENG6 Slice 6) — the identical
 * operator-token check, not a lookalike, so the two consoles' auth boundaries can never
 * drift apart. */
export async function requireOperator(
  request: FastifyRequest,
  reply: FastifyReply,
  env: Env,
): Promise<{ operatorName: string } | null> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
  if (token === null) {
    await reply.code(401).send({ error: 'OPERATOR_UNAUTHENTICATED' });
    return null;
  }
  const claims = await verifyOperatorToken(env.JWT_SECRET, token);
  if (claims === null) {
    await reply.code(401).send({ error: 'OPERATOR_UNAUTHENTICATED' });
    return null;
  }
  return claims;
}

export function registerOpsRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  provider: FinancialProvider,
  metrics: Metrics = NOOP_METRICS,
): void {
  if (!simulatorRoutesPermitted(env.VINKIN_ENV)) return; // same allowlist as the simulator surface
  const store = new PostgresVinkStore(sql);

  function contextFor(request: FastifyRequest): PurchaseCommandContext {
    const correlationId = String(request.id);
    const logger = toCommandLogger(request.log);
    tagActiveSpan({ 'correlation.id': correlationId });
    return {
      uow: store,
      clock: { now: () => new Date() },
      correlationId,
      provider: withProviderLogging(provider, correlationId, logger, metrics),
      logger,
      metrics: toCommandMetrics(metrics),
    };
  }

  async function handle(
    reply: FastifyReply,
    status: number,
    action: () => Promise<unknown>,
  ): Promise<unknown> {
    try {
      return reply.code(status).send(await action());
    } catch (error) {
      const mapped = mapError(error);
      if (mapped === null) throw error;
      return reply.code(mapped.status).send(mapped.body);
    }
  }

  // --- Auth ------------------------------------------------------------------

  app.post('/internal/ops/auth/login', async (request, reply) => {
    const body = z
      .object({ operatorName: z.string().min(1).max(80), password: z.string().min(1) })
      .parse(request.body);
    if (body.password !== env.OPERATOR_PASSWORD) {
      return reply.code(401).send({ error: 'OPERATOR_UNAUTHENTICATED' });
    }
    const token = await signOperatorToken(env.JWT_SECRET, body.operatorName);
    return reply.send({ operatorToken: token, operatorName: body.operatorName });
  });

  // --- Inspection (read-only) --------------------------------------------------

  app.get('/internal/ops/vinks', async (request, reply) => {
    if ((await requireOperator(request, reply, env)) === null) return;
    const query = z
      .object({
        publicCode: z.string().optional(),
        organizer: z.string().optional(),
        state: z.string().optional(),
        limit: z.coerce.number().int().optional(),
      })
      .parse(request.query);
    const results = await searchVinks(sql, {
      publicCode: query.publicCode,
      organizerUsername: query.organizer,
      state: query.state,
      limit: query.limit,
    });
    return reply.send({ vinks: results });
  });

  app.get('/internal/ops/vinks/:vinkId', async (request, reply) => {
    if ((await requireOperator(request, reply, env)) === null) return;
    const { vinkId } = vinkIdParams.parse(request.params);
    const detail = await getVinkDetail(sql, vinkId);
    if (detail.vink === null) return reply.code(404).send({ error: 'VINK_NOT_FOUND' });
    return reply.send(detail);
  });

  // PV12 exit-gate metrics — see ./analytics.ts's module doc for what's computed from
  // existing tables vs. the new analytics_events table.
  app.get('/internal/ops/analytics/summary', async (request, reply) => {
    if ((await requireOperator(request, reply, env)) === null) return;
    return reply.send(await getFunnelSummary(sql));
  });

  app.get('/internal/ops/audit-log', async (request, reply) => {
    if ((await requireOperator(request, reply, env)) === null) return;
    const query = z
      .object({ vinkId: z.string().optional(), limit: z.coerce.number().int().optional() })
      .parse(request.query);
    const entries = await listAuditLog(sql, { vinkId: query.vinkId, limit: query.limit });
    return reply.send({ entries });
  });

  // --- Actions (existing commands only — see module header) -------------------

  app.post('/internal/ops/vinks/:vinkId/merchant-authorizations', async (request, reply) => {
    const operator = await requireOperator(request, reply, env);
    if (operator === null) return;
    const { vinkId } = vinkIdParams.parse(request.params);
    const body = merchantSchema.parse(request.body ?? {});
    return handle(reply, 201, async () => {
      const card = await store.getCardByVink(vinkId as VinkId);
      if (card === null) throw new ApplicationError('PARTICIPANT_NOT_FOUND', 'no card to charge');
      let providerAuthorizationId = `ext_auth_${Date.now()}`;
      if (provider instanceof MockFinancialProvider) {
        const outcome = provider.simulateMerchantAuthorization({
          providerCardId: card.providerCardId,
          amount: { amountMinor: body.amountMinor, currency: 'USD' },
          merchantId: body.merchantIdentifier,
          merchantName: body.merchantName,
          mcc: body.mcc,
          merchantCountry: 'US',
        });
        if (outcome.providerAuthorizationId !== undefined) {
          providerAuthorizationId = outcome.providerAuthorizationId;
        }
      }
      const result = await authorizeMerchantPurchaseCommand(contextFor(request), {
        vinkId: vinkId as VinkId,
        providerAuthorizationId,
        merchantName: body.merchantName,
        merchantIdentifier: body.merchantIdentifier,
        mcc: body.mcc,
        amountMinor: body.amountMinor,
      });
      await insertAuditEntry(sql, {
        operatorName: operator.operatorName,
        action: 'MERCHANT_AUTHORIZATION',
        vinkId,
        correlationId: String(request.id),
        details: {
          outcome: result.outcome,
          amountMinor: body.amountMinor,
          merchantName: body.merchantName,
        },
      });
      return {
        outcome: result.outcome,
        authorizationId: result.authorization.id,
        providerAuthorizationId,
        vinkState: result.vinkState,
      };
    });
  });

  app.post('/internal/ops/authorizations/:authorizationId/capture', async (request, reply) => {
    const operator = await requireOperator(request, reply, env);
    if (operator === null) return;
    const { authorizationId } = authorizationIdParams.parse(request.params);
    const body = captureSchema.parse(request.body);
    return handle(reply, 200, async () => {
      if (provider instanceof MockFinancialProvider && body.providerAuthorizationId !== undefined) {
        provider.simulateMerchantCapture(body.providerAuthorizationId, {
          amountMinor: body.settledAmountMinor,
          currency: 'USD',
        });
      }
      const result = await settlePurchaseCommand(contextFor(request), {
        vinkId: body.vinkId as VinkId,
        authorizationId,
        settledAmountMinor: body.settledAmountMinor,
      });
      await insertAuditEntry(sql, {
        operatorName: operator.operatorName,
        action: 'CAPTURE',
        vinkId: body.vinkId,
        correlationId: String(request.id),
        details: {
          settlementStatus: result.settlement.status,
          settledAmountMinor: body.settledAmountMinor,
        },
      });
      return {
        settlementStatus: result.settlement.status,
        varianceMinor: result.settlement.varianceAmount.amountMinor,
        vinkState: result.vinkState,
      };
    });
  });
}
