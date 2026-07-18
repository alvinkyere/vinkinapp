/**
 * Contribution transport (PV5) — thin bindings over the contribution engine (D13).
 * Scenario controls are simulator-only: any non-SUCCESS scenario requires an allowlisted
 * environment (governance §5); the same guard gates the /internal/simulator endpoints.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApplicationError,
  authorizeContributionCommand,
  closeSubmissionsCommand,
  resolveContributionCommand,
  resolveGraceCommand,
  type ContributionCommandContext,
  type ContributionRequester,
} from '../../../../../packages/application/src/index.ts';
import {
  DomainError,
  IllegalTransitionError,
  type Contribution,
  type ContributionId,
  type VinkId,
} from '../../../../../packages/domain/src/index.ts';
import {
  MockFinancialProvider,
  type FinancialProvider,
} from '../../../../../packages/payment-provider/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { simulatorRoutesPermitted } from '../../config/simulator-guard.ts';
import { requireUser } from '../../auth/http.ts';
import { GUEST_TOKEN_PREFIX, hashGuestToken } from '../../auth/guest-tokens.ts';
import { PostgresVinkStore } from '../vinks/store.ts';

const scenarioSchema = z.enum(['SUCCESS', 'DECLINE', 'DELAYED']);
const authorizeSchema = z.object({ scenario: scenarioSchema.optional() });
const resolveSchema = z.object({ scenario: scenarioSchema.optional() });

function contributionView(contribution: Contribution) {
  return {
    id: contribution.id,
    participantId: contribution.participantId,
    attemptNumber: contribution.attemptNumber,
    status: contribution.status,
    requestedAmountMinor: contribution.requestedAmount.amountMinor,
    authorizedAmountMinor: contribution.authorizedAmount?.amountMinor ?? null,
    capturedAmountMinor: contribution.capturedAmount?.amountMinor ?? null,
  };
}

function mapError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof ApplicationError) {
    const status =
      error.code === 'VINK_NOT_FOUND' || error.code === 'PARTICIPANT_NOT_FOUND'
        ? 404
        : error.code === 'FORBIDDEN'
          ? 403
          : error.code === 'GUEST_UNAUTHENTICATED'
            ? 401
            : error.code === 'VINK_VERSION_CONFLICT'
              ? 409
              : 422;
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

export function registerContributionRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  provider: FinancialProvider,
): void {
  const store = new PostgresVinkStore(sql);
  const simulatorAllowed = simulatorRoutesPermitted(env.VINKIN_ENV);

  function contextFor(request: FastifyRequest): ContributionCommandContext {
    return {
      uow: store,
      clock: { now: () => new Date() },
      correlationId: String(request.id),
      provider,
    };
  }

  function guardScenario(
    scenario: 'SUCCESS' | 'DECLINE' | 'DELAYED' | undefined,
    reply: FastifyReply,
  ): boolean {
    if (scenario !== undefined && scenario !== 'SUCCESS' && !simulatorAllowed) {
      void reply
        .code(403)
        .send({ error: 'SCENARIO_NOT_PERMITTED', message: 'scenario controls are test-only' });
      return false;
    }
    return true;
  }

  async function handle(reply: FastifyReply, action: () => Promise<unknown>): Promise<unknown> {
    try {
      return reply.send(await action());
    } catch (error) {
      const mapped = mapError(error);
      if (mapped === null) throw error;
      return reply.code(mapped.status).send(mapped.body);
    }
  }

  // --- Registered participant authorizes their own contribution -------------

  app.post('/api/v1/vinks/:vinkId/contributions/authorize', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = request.params as { vinkId: string };
    const body = authorizeSchema.parse(request.body ?? {});
    if (!guardScenario(body.scenario, reply)) return;
    const requester: ContributionRequester = { kind: 'user', userId: claims.userId };
    return handle(reply, async () => {
      const result = await authorizeContributionCommand(contextFor(request), {
        vinkId: vinkId as VinkId,
        requester,
        ...(body.scenario !== undefined && { scenario: body.scenario }),
      });
      return {
        contribution: contributionView(result.contribution),
        vinkState: result.vinkState,
        replayed: result.replayed,
      };
    });
  });

  // --- Guest authorizes via their vgt_ token --------------------------------

  app.post('/api/v1/guest/contributions/authorize', async (request, reply) => {
    const header = request.headers.authorization;
    const token =
      header?.startsWith(`Bearer ${GUEST_TOKEN_PREFIX}`) === true
        ? header.slice('Bearer '.length)
        : null;
    if (token === null) return reply.code(401).send({ error: 'GUEST_UNAUTHENTICATED' });
    const resolved = await store.findGuestParticipant(hashGuestToken(token), new Date());
    if (resolved === null) return reply.code(401).send({ error: 'GUEST_UNAUTHENTICATED' });
    const body = authorizeSchema.parse(request.body ?? {});
    if (!guardScenario(body.scenario, reply)) return;
    return handle(reply, async () => {
      const result = await authorizeContributionCommand(contextFor(request), {
        vinkId: resolved.participant.vinkId,
        requester: { kind: 'guest', guestIdentityId: resolved.guest.id },
        ...(body.scenario !== undefined && { scenario: body.scenario }),
      });
      return {
        contribution: contributionView(result.contribution),
        vinkState: result.vinkState,
        replayed: result.replayed,
      };
    });
  });

  // --- Retry / resolve an unresolved contribution (E5) ----------------------

  app.post(
    '/api/v1/vinks/:vinkId/contributions/:contributionId/resolve',
    async (request, reply) => {
      const claims = await requireUser(request, reply, env);
      if (claims === null) return;
      const params = request.params as { vinkId: string; contributionId: string };
      const body = resolveSchema.parse(request.body ?? {});
      if (!guardScenario(body.scenario, reply)) return;
      return handle(reply, async () => {
        const contribution = await resolveContributionCommand(contextFor(request), {
          vinkId: params.vinkId as VinkId,
          contributionId: params.contributionId as ContributionId,
          ...(body.scenario !== undefined && { scenario: body.scenario }),
        });
        return { contribution: contributionView(contribution) };
      });
    },
  );

  // --- Simulator surface (environment-allowlisted; Plan §13 "internal") -----

  if (simulatorAllowed) {
    // Runs the deadline jobs for one vink. `nowOverride` exists so tests can cross the
    // processing-grace boundary without waiting a minute; production never registers this.
    app.post('/internal/simulator/vinks/:vinkId/run-deadlines', async (request, reply) => {
      const { vinkId } = request.params as { vinkId: string };
      const body = z.object({ nowOverride: z.iso.datetime().optional() }).parse(request.body ?? {});
      const now = body.nowOverride !== undefined ? new Date(body.nowOverride) : new Date();
      return handle(reply, async () => {
        const closed = await closeSubmissionsCommand(contextFor(request), {
          vinkId: vinkId as VinkId,
          now,
        });
        const resolved = await resolveGraceCommand(contextFor(request), {
          vinkId: vinkId as VinkId,
          now,
        });
        return { closeOutcome: closed, graceOutcome: resolved };
      });
    });

    if (provider instanceof MockFinancialProvider) {
      // Resolves a provider-side pending authorization (3DS-style late confirmation).
      app.post(
        '/internal/simulator/contributions/:contributionId/resolve-pending',
        async (request, reply) => {
          const { contributionId } = request.params as { contributionId: string };
          const body = z
            .object({ vinkId: z.uuid(), outcome: z.enum(['AUTHORIZED', 'DECLINED']) })
            .parse(request.body);
          return handle(reply, async () => {
            const contributions = await store.run((tx) =>
              tx.listContributionsForUpdate(body.vinkId as VinkId),
            );
            const target = contributions.find((row) => row.id === contributionId);
            if (target?.providerReference == null) {
              throw new ApplicationError('PARTICIPANT_NOT_FOUND', 'no pending provider payment');
            }
            provider.resolvePendingAuthorization(target.providerReference, body.outcome);
            const contribution = await resolveContributionCommand(contextFor(request), {
              vinkId: body.vinkId as VinkId,
              contributionId: contributionId as ContributionId,
            });
            return { contribution: contributionView(contribution) };
          });
        },
      );
    }
  }
}
