/**
 * Organizer vink transport (PV3). Routes are thin bindings over application commands
 * (D13): parse → authenticate → invoke command/query → map typed errors. No business
 * logic here.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApplicationError,
  addParticipantCommand,
  cancelVinkCommand,
  configureVinkCommand,
  coverRemainingCommand,
  createVinkCommand,
  getParticipantVinkView,
  getVinkActivity,
  getVinkSnapshot,
  inviteGuestCommand,
  listMyVinks,
  listMyVinksWithRole,
  openVinkCommand,
  removeParticipantCommand,
  setSplitCommand,
  type CommandContext,
} from '../../../../../packages/application/src/index.ts';
import { newGuestToken } from '../../auth/guest-tokens.ts';
import {
  DomainError,
  IllegalTransitionError,
  type ParticipantId,
  type UserId,
  type VinkId,
} from '../../../../../packages/domain/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { requireUser } from '../../auth/http.ts';
import { PostgresVinkStore } from './store.ts';

const PURCHASE_CATEGORIES = [
  'GROCERY',
  'RETAIL',
  'ELECTRONICS',
  'RESTAURANT',
  'HOTEL',
  'FUEL',
  'CAR_RENTAL',
] as const;

const createSchema = z.object({
  purchaseCategory: z.enum(PURCHASE_CATEGORIES),
  subtotalMinor: z.number().int().nonnegative(),
  tipMinor: z.number().int().nonnegative().default(0),
  // ENG1 timer semantics: optional — the real app no longer computes/sends this itself
  // (previously hardcoded to `now + 24h` client-side); omitting it defers to the server's
  // own VINK_OPEN_DURATION_SECONDS config. Still accepted explicitly where a caller
  // genuinely needs specific control (tests).
  submissionDeadline: z.iso.datetime().optional(),
  organizerDisplayName: z.string().min(1).max(80),
  // ENG1 #4: client-generated, stable across retries of the same create attempt. Optional —
  // a caller that omits it just forgoes replay protection (createVinkCommand fills in a
  // fresh key that can never collide, same as before this existed).
  creationIdempotencyKey: z.string().min(1).max(200).optional(),
});

const configureSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  subtotalMinor: z.number().int().nonnegative().optional(),
  tipMinor: z.number().int().nonnegative().optional(),
  submissionDeadline: z.iso.datetime().optional(),
});

const lifecycleSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

const addParticipantSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  username: z.string().min(1),
  displayName: z.string().min(1).max(80).optional(),
});

const inviteGuestSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  displayName: z.string().min(1).max(80),
  // ENG1 #4: client-generated, stable across retries of the same "add as guest" attempt.
  // Optional — a caller that omits it just forgoes duplicate protection.
  invitationIdempotencyKey: z.string().min(1).max(200).optional(),
});

const splitSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('EQUAL'),
    expectedVersion: z.number().int().positive().optional(),
  }),
  z.object({
    method: z.literal('CUSTOM_AMOUNT'),
    expectedVersion: z.number().int().positive().optional(),
    amounts: z
      .array(z.object({ participantId: z.uuid(), amountMinor: z.number().int().nonnegative() }))
      .min(1),
  }),
  z.object({
    method: z.literal('PERCENTAGE'),
    expectedVersion: z.number().int().positive().optional(),
    shares: z
      .array(z.object({ participantId: z.uuid(), basisPoints: z.number().int().nonnegative() }))
      .min(1),
  }),
]);

function errorStatus(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof ApplicationError) {
    const status =
      error.code === 'VINK_NOT_FOUND' || error.code === 'PARTICIPANT_NOT_FOUND'
        ? 404
        : error.code === 'FORBIDDEN'
          ? 403
          : error.code === 'VINK_VERSION_CONFLICT' ||
              error.code === 'PARTICIPANT_ALREADY_ADDED' ||
              error.code === 'INVITE_ALREADY_SENT'
            ? 409
            : 422;
    return { status, body: { error: error.code, message: error.message } };
  }
  if (error instanceof IllegalTransitionError) {
    return {
      status: 409,
      body: { error: error.code, message: error.message, from: error.from, event: error.event },
    };
  }
  if (error instanceof DomainError) {
    return { status: 422, body: { error: error.code, message: error.message } };
  }
  return null;
}

export function registerVinkRoutes(app: FastifyInstance, env: Env, sql: Sql): void {
  const store = new PostgresVinkStore(sql);

  function contextFor(request: FastifyRequest, actorUserId: string): CommandContext {
    return {
      uow: store,
      clock: { now: () => new Date() },
      actorUserId,
      correlationId: String(request.id),
      timers: {
        openDurationSeconds: env.VINK_OPEN_DURATION_SECONDS,
        processingGraceSeconds: env.VINK_PROCESSING_GRACE_SECONDS,
      },
    };
  }

  // A distinct path from sharing/routes.ts's `/join/:publicCode` (the anonymous, pick-
  // your-own-name link): this one carries a pre-minted token for one specific named guest,
  // so apps/guest-web redeems it straight into a live session with no join form to fill in.
  function guestJoinUrl(token: string): string {
    return `${env.VINKIN_PUBLIC_BASE_URL.replace(/\/$/, '')}/g/${token}`;
  }

  async function handle(
    reply: FastifyReply,
    status: number,
    action: () => Promise<unknown>,
  ): Promise<unknown> {
    try {
      return reply.code(status).send(await action());
    } catch (error) {
      const mapped = errorStatus(error);
      if (mapped === null) throw error;
      return reply.code(mapped.status).send(mapped.body);
    }
  }

  app.post('/api/v1/vinks', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const body = createSchema.parse(request.body);
    return handle(reply, 201, () => createVinkCommand(contextFor(request, claims.userId), body));
  });

  // Slice I2B: flag off returns exactly today's shape (`Vink[]`, organizer-owned only) —
  // untouched byte-for-byte. Flag on returns the organizer∪participant union (I2A's
  // `listMyVinksWithRole`) with an additive `role` field spread onto each Vink's own JSON —
  // never a differently-shaped wrapper, so an unaware client parsing today's `Vink` shape is
  // unaffected either way (Phase 10 §12 compatibility rule).
  app.get('/api/v1/vinks', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    return handle(reply, 200, async () => {
      if (env.VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL === '1') {
        const withRole = await listMyVinksWithRole(store, claims.userId);
        return { vinks: withRole.map(({ vink, role }) => ({ ...vink, role })) };
      }
      return { vinks: await listMyVinks(store, claims.userId) };
    });
  });

  app.get('/api/v1/vinks/:vinkId', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = request.params as { vinkId: string };
    return handle(reply, 200, () => getVinkSnapshot(store, vinkId as VinkId, claims.userId));
  });

  // Slice I2B — the customer-safe counterpart to the organizer-only snapshot above, for a
  // signed-in member who participates in (but doesn't organize) this vink. New route, not a
  // branch inside the organizer snapshot handler above: keeps the well-tested organizer path
  // completely untouched and gives the two response shapes (VinkSnapshot vs
  // ParticipantVinkView) distinct, statically-knowable URLs rather than one URL whose shape
  // depends on caller identity.
  app.get('/api/v1/vinks/:vinkId/participant-view', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    if (env.VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL !== '1') {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'not found' });
    }
    const { vinkId } = request.params as { vinkId: string };
    return handle(reply, 200, () =>
      getParticipantVinkView(store, vinkId as VinkId, claims.userId, new Date()),
    );
  });

  app.patch('/api/v1/vinks/:vinkId', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = request.params as { vinkId: string };
    const body = configureSchema.parse(request.body);
    return handle(reply, 200, () =>
      configureVinkCommand(contextFor(request, claims.userId), {
        ...body,
        vinkId: vinkId as VinkId,
      }),
    );
  });

  for (const [path, command] of [
    ['open', openVinkCommand],
    ['cancel', cancelVinkCommand],
    ['cover-remaining', coverRemainingCommand],
  ] as const) {
    app.post(`/api/v1/vinks/:vinkId/${path}`, async (request, reply) => {
      const claims = await requireUser(request, reply, env);
      if (claims === null) return;
      const { vinkId } = request.params as { vinkId: string };
      const body = lifecycleSchema.parse(request.body ?? {});
      return handle(reply, 200, () =>
        command(contextFor(request, claims.userId), { ...body, vinkId: vinkId as VinkId }),
      );
    });
  }

  app.post('/api/v1/vinks/:vinkId/participants', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = request.params as { vinkId: string };
    const body = addParticipantSchema.parse(request.body);
    const users = await sql`SELECT id, display_name FROM users
      WHERE username = ${body.username} AND status = 'ACTIVE'`;
    const user = users[0] as { id: string; display_name: string } | undefined;
    if (user === undefined) {
      return reply.code(404).send({ error: 'USER_NOT_FOUND', message: `no user ${body.username}` });
    }
    return handle(reply, 201, () =>
      addParticipantCommand(contextFor(request, claims.userId), {
        vinkId: vinkId as VinkId,
        userId: user.id as UserId,
        displayName: body.displayName ?? user.display_name,
        ...(body.expectedVersion !== undefined && { expectedVersion: body.expectedVersion }),
      }),
    );
  });

  // PV13 design correction: "unknown username" must never be a dead end for the organizer
  // — invite a non-member by name instead. Same guest_identities/participants shape PV4's
  // public guestJoinVinkCommand writes (guest.ts), just organizer-initiated: the raw token
  // is minted here (never seen by the application layer, same rule as the public join
  // route) and returned once, in this response, for the organizer to share.
  app.post('/api/v1/vinks/:vinkId/guests', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = request.params as { vinkId: string };
    const body = inviteGuestSchema.parse(request.body);
    const { token, tokenHash } = newGuestToken();
    return handle(reply, 201, async () => {
      const result = await inviteGuestCommand(contextFor(request, claims.userId), {
        vinkId: vinkId as VinkId,
        displayName: body.displayName,
        accessTokenHash: tokenHash,
        ...(body.expectedVersion !== undefined && { expectedVersion: body.expectedVersion }),
        ...(body.invitationIdempotencyKey !== undefined && {
          invitationIdempotencyKey: body.invitationIdempotencyKey,
        }),
      });
      return {
        guestToken: token,
        joinUrl: guestJoinUrl(token),
        participant: {
          id: result.participant.id,
          vinkId: result.participant.vinkId,
          displayName: result.participant.displayName,
          status: result.participant.status,
        },
      };
    });
  });

  app.delete('/api/v1/vinks/:vinkId/participants/:participantId', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const params = request.params as { vinkId: string; participantId: string };
    return handle(reply, 200, () =>
      removeParticipantCommand(contextFor(request, claims.userId), {
        vinkId: params.vinkId as VinkId,
        participantId: params.participantId as ParticipantId,
      }),
    );
  });

  app.put('/api/v1/vinks/:vinkId/split', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = request.params as { vinkId: string };
    const body = splitSchema.parse(request.body);
    return handle(reply, 200, () =>
      setSplitCommand(contextFor(request, claims.userId), {
        ...(body.method === 'EQUAL'
          ? { method: body.method }
          : body.method === 'CUSTOM_AMOUNT'
            ? {
                method: body.method,
                amounts: body.amounts.map((entry) => ({
                  participantId: entry.participantId as ParticipantId,
                  amountMinor: entry.amountMinor,
                })),
              }
            : {
                method: body.method,
                shares: body.shares.map((entry) => ({
                  participantId: entry.participantId as ParticipantId,
                  basisPoints: entry.basisPoints,
                })),
              }),
        vinkId: vinkId as VinkId,
        ...(body.expectedVersion !== undefined && { expectedVersion: body.expectedVersion }),
      }),
    );
  });

  app.get('/api/v1/vinks/:vinkId/activity', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = request.params as { vinkId: string };
    return handle(reply, 200, () => getVinkActivity(store, vinkId as VinkId, claims.userId));
  });
}
