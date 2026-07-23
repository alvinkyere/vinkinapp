/**
 * Organizer vink transport (PV3). Routes are thin bindings over application commands
 * (D13): parse → authenticate → invoke command/query → map typed errors. No business
 * logic here.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApplicationError,
  GUEST_TOKEN_TTL_DAYS,
  addParticipantCommand,
  cancelVinkCommand,
  claimGuestDeliverySlot,
  configureVinkCommand,
  coverRemainingCommand,
  createVinkCommand,
  editGuestParticipantCommand,
  getParticipantVinkView,
  getVinkActivity,
  getVinkSnapshot,
  inviteGuestCommand,
  listMyVinks,
  listMyVinksWithRole,
  openVinkCommand,
  recordGuestInvitationDeliveryResult,
  removeParticipantCommand,
  resendGuestInvitationCommand,
  setSplitCommand,
  type DeliveryCommandContext,
  type PendingGuestDelivery,
} from '../../../../../packages/application/src/index.ts';
import type { DeliveryProvider } from '../../../../../packages/delivery/src/index.ts';
import { newGuestToken } from '../../auth/guest-tokens.ts';
import {
  DomainError,
  IllegalTransitionError,
  type ParticipantId,
  type UserId,
  type Vink,
  type VinkId,
} from '../../../../../packages/domain/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { requireUser } from '../../auth/http.ts';
import { vinkAndParticipantIdParams, vinkIdParams } from '../../middleware/params.ts';
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
  // Slice I5B (D39) — human-readable payment context, separate from purchaseCategory (the
  // policy input, untouched below). Optional here so the five-step wizard (which never sends
  // one) keeps working byte-for-byte; the canonical screen requires it client-side before
  // Continue enables. Same trim-and-length convention as organizerDisplayName/guest
  // displayName elsewhere in this file.
  purpose: z.string().trim().min(1).max(120).optional(),
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

// Slice I4B (D38): a loose phone-shape check, deliberately not a strict E.164 validator — real
// deliverability is the provider's own concern (never built here, no provider selected yet,
// §4); this only catches an obviously-wrong value in the wrong field.
const PHONE_SHAPE = /^\+?[0-9][0-9\s\-().]{6,}$/;

// Slice I5B (D40) — shared by `inviteGuestSchema` and `editGuestSchema`: the same
// deliveryMode/contactDestination cross-field contract applies whether a guest is being
// invited fresh or having their delivery configuration corrected pre-open.
function superRefineDeliveryMode(
  value: { deliveryMode: 'sms' | 'email' | 'manual'; contactDestination?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.deliveryMode === 'manual') {
    if (value.contactDestination !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['contactDestination'],
        message: 'manual delivery must not include a contact destination',
      });
    }
    return;
  }
  if (value.contactDestination === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['contactDestination'],
      message: `${value.deliveryMode} delivery requires a contact destination`,
    });
    return;
  }
  if (value.deliveryMode === 'email' && !z.email().safeParse(value.contactDestination).success) {
    ctx.addIssue({
      code: 'custom',
      path: ['contactDestination'],
      message: 'not a valid email address',
    });
  }
  if (value.deliveryMode === 'sms' && !PHONE_SHAPE.test(value.contactDestination)) {
    ctx.addIssue({
      code: 'custom',
      path: ['contactDestination'],
      message: 'not a valid phone number',
    });
  }
}

const inviteGuestSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
    displayName: z.string().min(1).max(80),
    // ENG1 #4: client-generated, stable across retries of the same "add as guest" attempt.
    // Optional — a caller that omits it just forgoes duplicate protection.
    invitationIdempotencyKey: z.string().min(1).max(200).optional(),
    // Slice I4B (D38): explicit, never inferred from provider availability. Defaults to
    // 'manual' — I4's own (and every prior) behavior — so a caller that has never heard of
    // this field keeps getting a synchronously-minted token/link back, unchanged.
    deliveryMode: z.enum(['sms', 'email', 'manual']).default('manual'),
    contactDestination: z.string().min(1).max(200).optional(),
  })
  .superRefine(superRefineDeliveryMode);

// Slice I5B (D40) — draft-only guest correction. Every field is resent on every call (not a
// sparse patch): `deliveryMode` and `displayName` are required, matching `inviteGuestSchema`'s
// own shape exactly so there is no ambiguity about whether an omitted `contactDestination`
// means "unchanged" or "not applicable for this mode" — the client always sends the guest's
// complete resulting configuration.
const editGuestSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
    displayName: z.string().min(1).max(80),
    deliveryMode: z.enum(['sms', 'email', 'manual']),
    contactDestination: z.string().min(1).max(200).optional(),
  })
  .superRefine(superRefineDeliveryMode);

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

/** Slice I4B (D38) — the customer-safe delivery-state projection: never conflates "sent"
 * with "viewed"/"in," never exposes a provider's own status vocabulary. `dispatch` is the
 * outcome of a dispatch attempt made in THIS same request, if one was made. */
function projectDeliveryStatus(
  mode: 'sms' | 'email' | 'manual',
  dispatch: { accepted: boolean } | undefined,
): 'pending' | 'sent' | 'failed' | 'manual' {
  if (mode === 'manual') return 'manual';
  if (dispatch === undefined) return 'pending';
  return dispatch.accepted ? 'sent' : 'failed';
}

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

export function registerVinkRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  deliveryProvider?: DeliveryProvider,
): void {
  const store = new PostgresVinkStore(sql);

  function contextFor(request: FastifyRequest, actorUserId: string): DeliveryCommandContext {
    return {
      uow: store,
      clock: { now: () => new Date() },
      actorUserId,
      correlationId: String(request.id),
      timers: {
        openDurationSeconds: env.VINK_OPEN_DURATION_SECONDS,
        processingGraceSeconds: env.VINK_PROCESSING_GRACE_SECONDS,
      },
      // Slice I4 — member-only automatic dispatch (see packages/application/src/delivery.ts
      // for why guest dispatch isn't wired here). `enabled` is the actual gate; a provider
      // being present doesn't matter if the flag is off (boot-refused outside dev/test
      // anyway, apps/api/src/config/env.ts).
      ...(deliveryProvider !== undefined && {
        delivery: {
          provider: deliveryProvider,
          enabled: env.VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED === '1',
        },
      }),
    };
  }

  // A distinct path from sharing/routes.ts's `/join/:publicCode` (the anonymous, pick-
  // your-own-name link): this one carries a pre-minted token for one specific named guest,
  // so apps/guest-web redeems it straight into a live session with no join form to fill in.
  function guestJoinUrl(token: string): string {
    return `${env.VINKIN_PUBLIC_BASE_URL.replace(/\/$/, '')}/g/${token}`;
  }

  // Slice I4B (D38) — the one place in this codebase where a guest's raw token is minted for
  // AUTOMATIC delivery, and the one place `ctx.delivery.provider.send()` is called with a
  // guest's plaintext join URL. Both must stay here, in the transport: D14 forbids the raw
  // token (and therefore the URL built from it) from ever reaching `packages/application`.
  // `claimGuestDeliverySlot`/`recordGuestInvitationDeliveryResult` are the only two things
  // this function tells the application layer, and neither carries the secret — one hash,
  // one already-sent/failed audit record.
  async function dispatchGuestInvitation(
    ctx: DeliveryCommandContext,
    vink: Vink,
    organizerDisplayName: string,
    guest: PendingGuestDelivery,
  ): Promise<{ accepted: boolean } | undefined> {
    if (ctx.delivery?.enabled !== true) return undefined;
    const { token, tokenHash } = newGuestToken();
    const expiresAt = new Date(
      ctx.clock.now().getTime() + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    // Claim BEFORE sending: a lost claim (another dispatch already won) means this freshly
    // minted token was never anyone's actual credential — just discard it, never call the
    // provider with it. This is what makes a defensive re-invocation of this function (or a
    // genuine concurrent race, though the OPEN state machine already rules that out for the
    // batch call site) produce at most one real send per guest.
    const claimed = await claimGuestDeliverySlot(ctx, guest.guestIdentityId, tokenHash, expiresAt);
    if (!claimed) return undefined;
    const result = await ctx.delivery.provider.send({
      destination: guest.contactDestination,
      method: guest.contactMethod,
      template: {
        kind: 'guest_invite',
        organizerName: organizerDisplayName,
        // Slice I5B (D39): real purpose when the vink has one, else the category fallback.
        purpose: vink.purpose ?? vink.purchaseCategory,
        yourShareMinor: guest.allocatedAmountMinor,
        deadline: vink.submissionDeadline,
        link: guestJoinUrl(token),
      },
    });
    await recordGuestInvitationDeliveryResult(ctx, {
      participantId: guest.participantId,
      status: result.accepted ? 'SENT' : 'FAILED',
      method: guest.contactMethod,
      destination: guest.contactDestination,
      ...(result.providerMessageId !== undefined && {
        providerMessageId: result.providerMessageId,
      }),
      ...(result.failureReason !== undefined && { failureReason: result.failureReason }),
    });
    return { accepted: result.accepted };
  }

  // Slice I4B (D38) — a genuinely broken adapter (throws rather than resolving
  // `{accepted:false}` — an ordinary provider-side rejection never throws, per
  // `DeliveryProvider`'s own contract) must never take down the request that triggered it:
  // the vink's own OPEN transition (or, for an in-request invite dispatch, the guest's own
  // creation) has already committed by the time any of this runs. One guest's dispatch
  // blowing up must not stop the others in the same batch either (Phase 5 §2).
  async function dispatchGuestInvitationSafely(
    ctx: DeliveryCommandContext,
    vink: Vink,
    organizerDisplayName: string,
    guest: PendingGuestDelivery,
  ): Promise<{ accepted: boolean } | undefined> {
    try {
      return await dispatchGuestInvitation(ctx, vink, organizerDisplayName, guest);
    } catch (error) {
      // Deliberately no destination/token in this log line (privacy review, I4B report).
      app.log.error(
        { err: error, participantId: guest.participantId },
        'guest invitation dispatch failed unexpectedly',
      );
      return undefined;
    }
  }

  // Slice I4B (D38) — the actual "VINK_OPENED dispatches every DRAFT-time SMS/EMAIL invite"
  // trigger (D23: never earlier), mirroring `dispatchMemberInvitationsOnOpen`'s own ordering
  // rule but from the transport, since only the transport can mint the raw tokens this needs.
  async function dispatchPendingGuestInvitations(
    ctx: DeliveryCommandContext,
    vink: Vink,
  ): Promise<void> {
    if (ctx.delivery?.enabled !== true) return;
    const pending = await store.listPendingGuestDeliveries(vink.id);
    if (pending.length === 0) return;
    const organizer = (await store.listParticipants(vink.id)).find(
      (participant) => participant.role === 'ORGANIZER',
    );
    if (organizer === undefined) return;
    for (const guest of pending) {
      await dispatchGuestInvitationSafely(ctx, vink, organizer.displayName, guest);
    }
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
    const { vinkId } = vinkIdParams.parse(request.params);
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
    const { vinkId } = vinkIdParams.parse(request.params);
    return handle(reply, 200, () =>
      getParticipantVinkView(store, vinkId as VinkId, claims.userId, new Date()),
    );
  });

  app.patch('/api/v1/vinks/:vinkId', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = vinkIdParams.parse(request.params);
    const body = configureSchema.parse(request.body);
    return handle(reply, 200, () =>
      configureVinkCommand(contextFor(request, claims.userId), {
        ...body,
        vinkId: vinkId as VinkId,
      }),
    );
  });

  // Pulled out of the generic lifecycle loop below (Slice I4B, D38): this is the one lifecycle
  // transition with a post-transition side effect (dispatching every guest whose automatic
  // invitation was waiting on VINK_OPENED, D23) — `cancel`/`cover-remaining` stay generic.
  app.post('/api/v1/vinks/:vinkId/open', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = vinkIdParams.parse(request.params);
    const body = lifecycleSchema.parse(request.body ?? {});
    const ctx = contextFor(request, claims.userId);
    return handle(reply, 200, async () => {
      const opened = await openVinkCommand(ctx, { ...body, vinkId: vinkId as VinkId });
      // A duplicate/racing `open` call never reaches here a second time for the same vink:
      // `VINK_OPENED` is a one-time domain transition (packages/domain/src/
      // vink-state-machine.ts) — every request after the first genuinely-successful one fails
      // inside `openVinkCommand` itself (IllegalTransitionError, mapped to 409), before this
      // line ever runs. `claimGuestDeliverySlot`'s own per-guest conditional update is a
      // second, independent guard on top of that, not the only thing preventing a duplicate
      // send.
      await dispatchPendingGuestInvitations(ctx, opened);
      return opened;
    });
  });

  for (const [path, command] of [
    ['cancel', cancelVinkCommand],
    ['cover-remaining', coverRemainingCommand],
  ] as const) {
    app.post(`/api/v1/vinks/:vinkId/${path}`, async (request, reply) => {
      const claims = await requireUser(request, reply, env);
      if (claims === null) return;
      const { vinkId } = vinkIdParams.parse(request.params);
      const body = lifecycleSchema.parse(request.body ?? {});
      return handle(reply, 200, () =>
        command(contextFor(request, claims.userId), { ...body, vinkId: vinkId as VinkId }),
      );
    });
  }

  app.post('/api/v1/vinks/:vinkId/participants', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = vinkIdParams.parse(request.params);
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
  // public guestJoinVinkCommand writes (guest.ts), just organizer-initiated.
  //
  // Slice I4B (D38): MANUAL mode mints the raw token here exactly as I4 always did (never
  // seen by the application layer, returned once in this response for the organizer to
  // share). SMS/EMAIL mode mints nothing here — `inviteGuestCommand` stores an inert,
  // unauthenticatable guest identity (null hash) and the real token is minted only once
  // dispatch can actually happen: immediately below, in this same request, if the vink is
  // already OPEN (mirrors `addParticipantCommand`'s member-dispatch-on-add ordering), or
  // later, batched at VINK_OPENED, if it's still DRAFT (D23; see the `open` route above).
  app.post('/api/v1/vinks/:vinkId/guests', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const { vinkId } = vinkIdParams.parse(request.params);
    const body = inviteGuestSchema.parse(request.body);
    const deliveryMode = body.deliveryMode.toUpperCase() as 'SMS' | 'EMAIL' | 'MANUAL';
    const minted = deliveryMode === 'MANUAL' ? newGuestToken() : null;
    const ctx = contextFor(request, claims.userId);
    return handle(reply, 201, async () => {
      const result = await inviteGuestCommand(ctx, {
        vinkId: vinkId as VinkId,
        displayName: body.displayName,
        deliveryMode,
        ...(minted !== null && { accessTokenHash: minted.tokenHash }),
        ...(body.contactDestination !== undefined && {
          contactDestination: body.contactDestination,
        }),
        ...(body.expectedVersion !== undefined && { expectedVersion: body.expectedVersion }),
        ...(body.invitationIdempotencyKey !== undefined && {
          invitationIdempotencyKey: body.invitationIdempotencyKey,
        }),
      });

      let dispatch: { accepted: boolean } | undefined;
      if (deliveryMode !== 'MANUAL' && result.vink.state === 'OPEN') {
        const organizer = (await store.listParticipants(result.vink.id)).find(
          (participant) => participant.role === 'ORGANIZER',
        );
        if (organizer !== undefined) {
          dispatch = await dispatchGuestInvitationSafely(ctx, result.vink, organizer.displayName, {
            guestIdentityId: result.guest.id,
            participantId: result.participant.id,
            displayName: result.participant.displayName,
            contactDestination: result.guest.contactDestination as string,
            contactMethod: result.guest.contactMethod as 'EMAIL' | 'SMS',
            allocatedAmountMinor: result.participant.allocatedAmount.amountMinor,
          });
        }
      }

      return {
        ...(minted !== null && { guestToken: minted.token, joinUrl: guestJoinUrl(minted.token) }),
        participant: {
          id: result.participant.id,
          vinkId: result.participant.vinkId,
          displayName: result.participant.displayName,
          status: result.participant.status,
        },
        deliveryMode: body.deliveryMode,
        deliveryStatus: projectDeliveryStatus(body.deliveryMode, dispatch),
      };
    });
  });

  // Slice I5B (D40) — draft-only guest correction (display name, delivery mode, contact
  // destination). Mirrors the invite route's own D14 discipline: a fresh token is minted
  // HERE, in the transport, only when the request asks for MANUAL mode — the command itself
  // decides (from the guest's current mode) whether that mint is actually used; an unused
  // one is simply discarded, never persisted, never returned.
  app.patch('/api/v1/vinks/:vinkId/participants/:participantId/guest', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const params = vinkAndParticipantIdParams.parse(request.params);
    const body = editGuestSchema.parse(request.body);
    const deliveryMode = body.deliveryMode.toUpperCase() as 'SMS' | 'EMAIL' | 'MANUAL';
    const minted = deliveryMode === 'MANUAL' ? newGuestToken() : null;
    const ctx = contextFor(request, claims.userId);
    return handle(reply, 200, async () => {
      const result = await editGuestParticipantCommand(ctx, {
        vinkId: params.vinkId as VinkId,
        participantId: params.participantId as ParticipantId,
        displayName: body.displayName,
        deliveryMode,
        ...(body.contactDestination !== undefined && {
          contactDestination: body.contactDestination,
        }),
        ...(minted !== null && { mintedAccessTokenHash: minted.tokenHash }),
        ...(body.expectedVersion !== undefined && { expectedVersion: body.expectedVersion }),
      });
      return {
        participant: {
          id: result.participant.id,
          vinkId: result.participant.vinkId,
          displayName: result.participant.displayName,
          status: result.participant.status,
        },
        deliveryMode: body.deliveryMode,
        // Returned only when a genuinely new manual token was minted this call — D14: a
        // raw guest link is returned exactly once, at the moment it's actually created.
        ...(result.mintedNewManualToken &&
          minted !== null && { guestToken: minted.token, joinUrl: guestJoinUrl(minted.token) }),
      };
    });
  });

  // Slice I4B (D38) — resend for automatic (SMS/EMAIL) delivery only; MANUAL mode has no
  // dispatch to resend (the organizer's own copy of the original response is the only "link"
  // that mode ever had — re-minting one here would silently break whatever they already
  // shared, see `resendGuestInvitationCommand`'s doc comment). Best-effort cooldown throttle
  // (`GUEST_RESEND_COOLDOWN_SECONDS`, config not a constant — same "a test needs to shrink
  // this" reasoning as the ENG1 timer values) doubles as this endpoint's idempotency guard:
  // given the single-slot token binding, there is no safe way to "replay" an identical prior
  // send (the raw link is never persisted, D14) — a resend always mints a fresh credential
  // and invalidates the last one, so the only thing that CAN make a lost-response retry safe
  // is refusing to repeat it too soon, exactly what the cooldown already does.
  app.post('/api/v1/vinks/:vinkId/participants/:participantId/resend', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const params = vinkAndParticipantIdParams.parse(request.params);
    const vink = await store.getVink(params.vinkId as VinkId);
    if (vink === null) {
      return reply.code(404).send({ error: 'VINK_NOT_FOUND', message: 'vink not found' });
    }
    if (vink.organizerUserId !== claims.userId) {
      return reply
        .code(403)
        .send({ error: 'FORBIDDEN', message: 'only the organizer may manage this vink' });
    }
    const priorAttempts = await store.listInvitationDeliveries(
      params.participantId as ParticipantId,
    );
    const last = priorAttempts[0];
    const cooldownMs = env.GUEST_RESEND_COOLDOWN_SECONDS * 1000;
    if (last !== undefined) {
      const elapsedMs = Date.now() - new Date(last.attemptedAt).getTime();
      if (elapsedMs < cooldownMs) {
        return reply.code(429).send({
          error: 'RESEND_THROTTLED',
          message: `try again in ${Math.ceil((cooldownMs - elapsedMs) / 1000)}s`,
        });
      }
    }
    const ctx = contextFor(request, claims.userId);
    const { token, tokenHash } = newGuestToken();
    const expiresAt = new Date(
      ctx.clock.now().getTime() + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    return handle(reply, 200, async () => {
      const resent = await resendGuestInvitationCommand(ctx, {
        vinkId: params.vinkId as VinkId,
        participantId: params.participantId as ParticipantId,
        tokenHash,
        expiresAt,
      });
      let dispatch: { accepted: boolean } | undefined;
      // Same "a broken adapter must never fail the primary action" rule as
      // `dispatchGuestInvitationSafely` above — the token has already been committed by
      // `resendGuestInvitationCommand` by this point, so this whole block is best-effort.
      if (ctx.delivery?.enabled === true) {
        try {
          const organizer = (await store.listParticipants(resent.vink.id)).find(
            (participant) => participant.role === 'ORGANIZER',
          );
          const result = await ctx.delivery.provider.send({
            destination: resent.guest.contactDestination as string,
            method: resent.guest.contactMethod as 'EMAIL' | 'SMS',
            template: {
              kind: 'guest_invite',
              organizerName: organizer?.displayName ?? '',
              purpose: resent.vink.purchaseCategory,
              yourShareMinor: resent.participant.allocatedAmount.amountMinor,
              deadline: resent.vink.submissionDeadline,
              link: guestJoinUrl(token),
            },
          });
          dispatch = { accepted: result.accepted };
          await recordGuestInvitationDeliveryResult(ctx, {
            participantId: resent.participant.id,
            status: result.accepted ? 'SENT' : 'FAILED',
            method: resent.guest.contactMethod as 'EMAIL' | 'SMS',
            destination: resent.guest.contactDestination as string,
            ...(result.providerMessageId !== undefined && {
              providerMessageId: result.providerMessageId,
            }),
            ...(result.failureReason !== undefined && { failureReason: result.failureReason }),
          });
        } catch (error) {
          app.log.error(
            { err: error, participantId: resent.participant.id },
            'guest resend dispatch failed unexpectedly',
          );
        }
      }
      return {
        participantId: resent.participant.id,
        deliveryStatus: projectDeliveryStatus(
          resent.guest.deliveryMode.toLowerCase() as 'sms' | 'email',
          dispatch,
        ),
      };
    });
  });

  app.delete('/api/v1/vinks/:vinkId/participants/:participantId', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const params = vinkAndParticipantIdParams.parse(request.params);
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
    const { vinkId } = vinkIdParams.parse(request.params);
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
    const { vinkId } = vinkIdParams.parse(request.params);
    return handle(reply, 200, () => getVinkActivity(store, vinkId as VinkId, claims.userId));
  });
}
