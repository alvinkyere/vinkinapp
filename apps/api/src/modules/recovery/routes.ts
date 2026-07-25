/**
 * Recovery + refund transport (PV7). Both surfaces are simulator-only (allowlist-gated) —
 * in production the recovery ladder and refund retries are timer jobs, not endpoints. Thin
 * bindings over the engines (D13).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApplicationError,
  refundFailedSessionCommand,
  retryRecoveryCommand,
  retryRefundCommand,
  startRecoveryCommand,
  type RecoveryCommandContext,
  type RefundCommandContext,
} from '../../../../../packages/application/src/index.ts';
import {
  DomainError,
  IllegalTransitionError,
  type ContributionId,
  type VinkId,
} from '../../../../../packages/domain/src/index.ts';
import type { FinancialProvider } from '../../../../../packages/payment-provider/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { simulatorRoutesPermitted } from '../../config/simulator-guard.ts';
import { vinkAndContributionIdParams, vinkIdParams } from '../../middleware/params.ts';
import { PostgresVinkStore } from '../vinks/store.ts';
import { toCommandLogger } from '../../observability/command-logger.ts';
import { withProviderLogging } from '../../observability/provider-logging.ts';
import { NOOP_METRICS, type Metrics } from '../../observability/metrics.ts';
import { tagActiveSpan } from '../../observability/tracing.ts';

const scenarioSchema = z.enum(['SUCCESS', 'DECLINE']).optional();

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

export function registerRecoveryRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  provider: FinancialProvider,
  metrics: Metrics = NOOP_METRICS,
): void {
  if (!simulatorRoutesPermitted(env.VINKIN_ENV)) return;
  const store = new PostgresVinkStore(sql);

  function recoveryCtx(request: FastifyRequest): RecoveryCommandContext {
    const correlationId = String(request.id);
    const logger = toCommandLogger(request.log);
    tagActiveSpan({ 'correlation.id': correlationId });
    return {
      uow: store,
      clock: { now: () => new Date() },
      correlationId,
      provider: withProviderLogging(provider, correlationId, logger, metrics),
      logger,
    };
  }
  function refundCtx(request: FastifyRequest): RefundCommandContext {
    const correlationId = String(request.id);
    const logger = toCommandLogger(request.log);
    tagActiveSpan({ 'correlation.id': correlationId });
    return {
      uow: store,
      clock: { now: () => new Date() },
      correlationId,
      provider: withProviderLogging(provider, correlationId, logger, metrics),
      logger,
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

  app.post('/internal/simulator/vinks/:vinkId/recovery/start', async (request, reply) => {
    const { vinkId } = vinkIdParams.parse(request.params);
    const body = z.object({ scenario: scenarioSchema }).parse(request.body ?? {});
    return handle(reply, 200, async () => {
      const result = await startRecoveryCommand(recoveryCtx(request), {
        vinkId: vinkId as VinkId,
        ...(body.scenario !== undefined && { scenario: body.scenario }),
      });
      return {
        outcome: result.outcome,
        vinkState: result.vinkState,
        obligationStatus: result.obligation.status,
        amountMinor: result.obligation.amount.amountMinor,
      };
    });
  });

  app.post('/internal/simulator/vinks/:vinkId/recovery/retry', async (request, reply) => {
    const { vinkId } = vinkIdParams.parse(request.params);
    const body = z.object({ scenario: scenarioSchema }).parse(request.body ?? {});
    return handle(reply, 200, async () => {
      const result = await retryRecoveryCommand(recoveryCtx(request), {
        vinkId: vinkId as VinkId,
        ...(body.scenario !== undefined && { scenario: body.scenario }),
      });
      return {
        outcome: result.outcome,
        vinkState: result.vinkState,
        obligationStatus: result.obligation.status,
      };
    });
  });

  app.post('/internal/simulator/vinks/:vinkId/refund-failed-session', async (request, reply) => {
    const { vinkId } = vinkIdParams.parse(request.params);
    return handle(reply, 200, () =>
      refundFailedSessionCommand(refundCtx(request), { vinkId: vinkId as VinkId }),
    );
  });

  app.post(
    '/internal/simulator/vinks/:vinkId/contributions/:contributionId/retry-refund',
    async (request, reply) => {
      const params = vinkAndContributionIdParams.parse(request.params);
      return handle(reply, 200, async () => {
        const contribution = await retryRefundCommand(refundCtx(request), {
          vinkId: params.vinkId as VinkId,
          contributionId: params.contributionId as ContributionId,
        });
        return { status: contribution.status };
      });
    },
  );
}
