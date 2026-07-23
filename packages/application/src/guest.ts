/**
 * Guest join + public/guest views (PV4, master plan journey E9). D13 shape throughout.
 *
 * Token handling: the TRANSPORT mints the raw guest token and passes only its hash here —
 * the application layer never sees the secret (Plan §21 "hash guest access tokens").
 * Validation-build token design (single-slot binding, 7-day expiry) is D14; the production
 * design (G4: OTP thresholds, TTLs) remains open.
 */

import {
  money,
  newGuestIdentityId,
  newParticipantId,
  type Participant,
  type Vink,
} from '../../domain/src/index.ts';
import { ApplicationError, InviteIdempotencyRaceError } from './errors.ts';
import type {
  CommandContext,
  GuestDeliveryMode,
  GuestIdentityRecord,
  PublicCommandContext,
  VinkReader,
  VinkTx,
} from './ports.ts';
import {
  computeContributionProgress,
  latestContributionStatusByParticipant,
  type ContributionProgressView,
} from './queries.ts';
import { loadOwnedVink } from './support/guards.ts';

export const GUEST_TOKEN_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// D23/D24/D25 (Slice I1, docs/design/phase-10-implementation-readiness.md) — customer-safe
// projections layered on top of PublicVinkSummary/GuestVinkView. Additive only: neither
// existing type nor `toPublicSummary`/`guestJoinVinkCommand`/`inviteGuestCommand` changes —
// these are new fields on the two READ queries only (getPublicVinkView, getGuestVinkView).
// ---------------------------------------------------------------------------

/**
 * A vink-level, guest-safe outcome category (D25/D34) — never the raw `Vink['state']` name.
 * Deliberately coarse: it answers "can I still act, and if not, what happened," not the full
 * in-progress lifecycle detail (that stays out of I1's scope — no Ink Progress/UI rendering
 * here, per the slice's own boundary).
 */
export type GuestVinkOutcome =
  | 'not_open_yet'
  | 'open'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'return_pending'
  | 'returned'
  | 'recovery_required';

function computeGuestVinkOutcome(vinkState: Vink['state']): GuestVinkOutcome {
  switch (vinkState) {
    case 'DRAFT':
      return 'not_open_yet';
    case 'OPEN':
    case 'SUBMISSIONS_CLOSED':
    case 'PROCESSING_GRACE':
    case 'FUNDED':
    case 'CARD_PROVISIONING':
    case 'CARD_READY':
    case 'PURCHASE_AUTHORIZED':
    case 'SETTLING':
      return 'open';
    case 'FUNDING_REVERSAL':
    case 'EXPIRED':
      // FUNDING_REVERSAL's only exit transition is to EXPIRED (deterministic,
      // vink-state-machine.ts) — safe to report the outcome it is unconditionally headed
      // toward, not a fabricated intermediate category.
      return 'expired';
    case 'CANCELLED':
      return 'cancelled';
    case 'RECOVERY_REQUIRED':
    case 'RECOVERY_PENDING':
      return 'recovery_required';
    case 'COMPLETED':
    case 'RESTRICTED':
      // RESTRICTED is an organizer-only consequence of a failed recovery ladder — the
      // guest's own contribution is already SETTLED by the time RESTRICTED is reachable
      // (Phase 0 §11), so from a guest's own outcome, the merchant was paid: 'completed'.
      return 'completed';
  }
}

/**
 * The requesting guest's OWN contribution outcome (D24/D25) — viewer-specific, computed
 * from that guest's own latest contribution attempt only. Never derivable for any other
 * participant.
 */
export type GuestContributionStatus =
  | 'not_started'
  | 'processing'
  | 'confirmed'
  | 'declined_retryable'
  | 'declined_final'
  | 'return_pending'
  | 'returned'
  | 'recovery_required';

function computeGuestContributionStatus(
  ownContributionStatus: string | undefined,
  vinkState: Vink['state'],
): GuestContributionStatus {
  if (ownContributionStatus === undefined) return 'not_started';
  switch (ownContributionStatus) {
    case 'CREATED':
    case 'AUTHORIZATION_PENDING':
    case 'RESOLUTION_PENDING':
    case 'CANCELLATION_PENDING':
      return 'processing';
    case 'AUTHORIZED':
    case 'CAPTURE_PENDING':
    case 'CAPTURED':
    case 'SETTLED':
      // A confirmed contribution stays "confirmed" from the guest's own perspective even
      // while the vink resolves an organizer-only recovery obligation (Phase 6 §8's
      // continuity rule) — except the API still surfaces the precise `recovery_required`
      // value here so a client CAN distinguish it if it ever needs to, without that
      // requiring a new visual state (the copy layer may render it identically to
      // "confirmed", per D25/D34 — this field only makes the fact available).
      return vinkState === 'RECOVERY_REQUIRED' || vinkState === 'RECOVERY_PENDING'
        ? 'recovery_required'
        : 'confirmed';
    case 'DECLINED':
      // Retryable only while the vink is still OPEN — a new attempt is a NEW contribution
      // (domain invariant, contribution-state-machine.ts), never a retry of this one.
      return vinkState === 'OPEN' ? 'declined_retryable' : 'declined_final';
    case 'CANCELLED':
      // The resolver explicitly cancels every uncaptured contribution on FUNDING_FAILED
      // (contributions.ts resolveFunding) — by the time a contribution reaches CANCELLED,
      // no further attempt is ever possible for this Vink.
      return 'declined_final';
    case 'REFUND_PENDING':
    case 'REFUND_FAILED':
      // REFUND_FAILED is a server-internal retry loop (Phase 2 §9) — never surfaced to the
      // guest as a distinct alarming state, collapsed into the same return_pending category.
      return 'return_pending';
    case 'REFUNDED':
      return 'returned';
    default:
      // Forward-compatible fallback for any status this projection doesn't yet recognize —
      // never crashes, never silently claims "confirmed" for an unrecognized status.
      return 'processing';
  }
}

/** The minimal, customer-safe shape for a Vink that hasn't opened yet (D23) — deliberately
 * withholds everything else (purpose, amount, split), matching D23's own rejected
 * alternative ("relabel the badge but still show the summary" was explicitly rejected). */
export interface NotOpenYetView {
  vinkOutcome: 'not_open_yet';
}

/** What an anonymous visitor (or joined guest) may see — no internal ids beyond the code. */
export interface PublicVinkSummary {
  publicCode: string;
  /** Slice I5B (D39) — human-readable payment context; null for a Vink that never had one
   * (every pre-I5B Vink, and every Vink the five-step wizard still creates). Consumers apply
   * their own customer-safe fallback (e.g. the category's own display label) when null —
   * this projection passes the raw value through, it does not invent one. */
  purpose: string | null;
  purchaseCategory: Vink['purchaseCategory'];
  state: Vink['state'];
  requiredAmountMinor: number;
  fundedAmountMinor: number;
  submissionDeadline: string;
  participantCount: number;
  joinable: boolean;
}

function isJoinable(vink: Vink, now: Date): boolean {
  return vink.state === 'OPEN' && now.getTime() < new Date(vink.submissionDeadline).getTime();
}

function toPublicSummary(vink: Vink, participantCount: number, now: Date): PublicVinkSummary {
  return {
    publicCode: vink.publicCode,
    purpose: vink.purpose,
    purchaseCategory: vink.purchaseCategory,
    state: vink.state,
    requiredAmountMinor: vink.requiredAmount.amountMinor,
    fundedAmountMinor: vink.fundedAmount.amountMinor,
    submissionDeadline: vink.submissionDeadline,
    participantCount,
    joinable: isJoinable(vink, now),
  };
}

// ---------------------------------------------------------------------------
// GuestJoinVinkCommand — the E9 entry point
// ---------------------------------------------------------------------------

export interface GuestJoinInput {
  publicCode: string;
  displayName: string;
  /** SHA-256 hash of the transport-minted guest token. */
  accessTokenHash: string;
}

export interface GuestJoinResult {
  vink: PublicVinkSummary;
  participant: Participant;
  guest: GuestIdentityRecord;
}

export async function guestJoinVinkCommand(
  ctx: PublicCommandContext,
  input: GuestJoinInput,
): Promise<GuestJoinResult> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkByPublicCodeForUpdate(input.publicCode);
    if (vink === null) throw new ApplicationError('VINK_NOT_FOUND', 'unknown code');
    const now = ctx.clock.now();
    if (!isJoinable(vink, now)) {
      // Expiration handling (Plan PV4): a precise, guest-safe signal — no internals leaked.
      throw new ApplicationError(
        'VINK_NOT_JOINABLE',
        `this vink is no longer accepting participants`,
      );
    }

    const guest: GuestIdentityRecord = {
      id: newGuestIdentityId(),
      displayName: input.displayName,
      accessTokenHash: input.accessTokenHash,
      expiresAt: new Date(now.getTime() + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
      // Slice I4: a self-joined guest already has the link in hand (that's how they got
      // here) — there is nothing to automatically deliver, unlike an organizer-initiated
      // named invite (`inviteGuestCommand` below), which can capture a destination.
      contactDestination: null,
      contactMethod: null,
      // Slice I4B (D38): always MANUAL — never a candidate for automatic dispatch.
      deliveryMode: 'MANUAL',
    };
    const participant: Participant = {
      id: newParticipantId(),
      vinkId: vink.id,
      userId: null,
      guestIdentityId: guest.id,
      displayName: input.displayName,
      role: 'MEMBER',
      status: 'JOINED',
      allocatedAmount: money(0),
      maximumApprovedAmount: money(0),
      joinedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await tx.insertGuestIdentity(guest);
    await tx.insertParticipant(participant);
    await tx.insertOutbox({
      eventType: 'ParticipantJoined',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: { vinkId: vink.id, participantId: participant.id, guest: true },
    });

    const participantCount = (await tx.listParticipants(vink.id)).filter(
      (row) => row.status !== 'REMOVED',
    ).length;
    return { vink: toPublicSummary(vink, participantCount, now), participant, guest };
  });
}

// ---------------------------------------------------------------------------
// InviteGuestCommand — the organizer adds a non-member by name (PV13 design correction:
// "unknown username" must never be a dead end). Same guest_identities/participants shape
// guestJoinVinkCommand writes, but organizer-initiated and organizer-authenticated —
// mirrors addParticipantCommand's own DRAFT-or-OPEN precondition (commands.ts) rather than
// guestJoinVinkCommand's public isJoinable check, since the organizer controls timing here,
// not an anonymous visitor hitting a public link.
//
// Slice I4B (D38) — closes the I4 architectural gap this comment used to describe. The raw
// guest token is still minted by the TRANSPORT (`newGuestToken()`,
// `apps/api/src/modules/vinks/routes.ts`) and only its hash ever reaches this command (D14,
// hard rule) — that constraint hasn't changed. What changed is WHEN the token is minted:
//
//  - `deliveryMode: 'MANUAL'` mints synchronously, exactly like I4 did — the organizer needs
//    the raw link back in this same response to copy/share it, so `accessTokenHash` is
//    required and stored immediately.
//  - `deliveryMode: 'SMS' | 'EMAIL'` mints NOTHING here. `accessTokenHash` must be omitted;
//    the guest identity is stored with a null hash (migration 0012) and sits inert —
//    unreachable by any token, since no hash can ever equal null — until the transport
//    mints one at the moment it can actually dispatch: immediately, in this same request, if
//    the vink is already OPEN (mirrors `addParticipantCommand`'s member-dispatch ordering),
//    or later, batched at VINK_OPENED (`openVinkCommand`'s transport wrapper), if the vink is
//    still DRAFT (D23). This is what makes "resend" possible at all for automatic delivery —
//    I4 couldn't offer it because the one-time raw token was gone forever after the invite
//    response; now a fresh one can always be minted on demand (`resendGuestInvitationCommand`
//    below), at the cost of invalidating whichever token came before it (single-slot binding
//    — see that command's own doc comment).
// ---------------------------------------------------------------------------

export interface InviteGuestInput {
  vinkId: Vink['id'];
  expectedVersion?: number;
  displayName: string;
  /** Slice I4B (D38) — explicit, never inferred from provider availability (§ brief). */
  deliveryMode: GuestDeliveryMode;
  /** SHA-256 hash of the transport-minted guest token. Required (and transport always
   * supplies it) for `deliveryMode: 'MANUAL'` only — see the doc comment above. Must be
   * omitted for `SMS`/`EMAIL`; providing one there is a caller bug (`INVALID_COMMAND`). */
  accessTokenHash?: string;
  /** ENG1 #4: client-generated, stable across retries of the same "add as guest" attempt.
   * Optional — a caller that omits it just forgoes duplicate protection. Unlike
   * `CreateVinkInput.creationIdempotencyKey` (Slice 2), a detected repeat here is REJECTED
   * rather than replayed: for MANUAL mode the raw join link from the original attempt is
   * gone by design (D14); for SMS/EMAIL mode a replay would either duplicate a pending
   * dispatch or reissue a fresh token for no reason — in both cases refusing is correct. */
  invitationIdempotencyKey?: string;
  /** Required for `deliveryMode: 'SMS' | 'EMAIL'` (the phone/email the invitation will be
   * sent to); must be omitted for `MANUAL`, where there is nothing to automatically send —
   * display name stays a separate concept from destination in every mode. */
  contactDestination?: string;
}

export interface InviteGuestResult {
  participant: Participant;
  guest: GuestIdentityRecord;
  /** Slice I4B — the transport dispatch call site needs the vink's own state (was this
   * invite created into an already-OPEN vink, meaning dispatch should fire now rather than
   * waiting for a future VINK_OPENED?) without a second read. */
  vink: Vink;
}

function contactMethodFor(mode: GuestDeliveryMode): 'EMAIL' | 'SMS' | null {
  return mode === 'MANUAL' ? null : mode;
}

/** Slice I4B (D38) — the delivery-mode contract itself: SMS needs a phone-shaped
 * destination, EMAIL needs an email-shaped one, MANUAL needs neither and must not receive
 * one (deliberately rejected, not silently ignored, so a caller doesn't believe a destination
 * they supplied will ever be used). Loose format checks only — real deliverability is the
 * provider's own concern; this just catches an obviously wrong pairing. */
function assertDeliveryModeContract(
  mode: GuestDeliveryMode,
  accessTokenHash: string | undefined,
  contactDestination: string | undefined,
): void {
  if (mode === 'MANUAL') {
    if (accessTokenHash === undefined) {
      throw new ApplicationError('INVALID_COMMAND', 'manual delivery requires a minted token');
    }
    if (contactDestination !== undefined) {
      throw new ApplicationError(
        'INVALID_COMMAND',
        'manual delivery must not carry a contact destination — it is never automatically sent',
      );
    }
    return;
  }
  if (accessTokenHash !== undefined) {
    throw new ApplicationError(
      'INVALID_COMMAND',
      `${mode} delivery mints its own token at dispatch time — a caller must not pre-mint one`,
    );
  }
  if (contactDestination === undefined || contactDestination.trim().length === 0) {
    throw new ApplicationError(
      'INVALID_COMMAND',
      `${mode} delivery requires a contact destination`,
    );
  }
}

async function assertInviteNotAlreadySent(
  tx: VinkTx,
  vinkId: Vink['id'],
  key: string,
): Promise<void> {
  const alreadySent = await tx.findGuestInviteIdempotencyKey(vinkId, key);
  if (alreadySent) {
    throw new ApplicationError(
      'INVITE_ALREADY_SENT',
      'this invitation was already sent — refresh to see the guest who was added',
    );
  }
}

export async function inviteGuestCommand(
  ctx: CommandContext,
  input: InviteGuestInput,
): Promise<InviteGuestResult> {
  const key = input.invitationIdempotencyKey;
  assertDeliveryModeContract(input.deliveryMode, input.accessTokenHash, input.contactDestination);
  try {
    return await ctx.uow.run(async (tx) => {
      const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
      if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
        throw new ApplicationError('INVALID_COMMAND', `guests cannot be invited in ${vink.state}`);
      }
      if (key !== undefined) await assertInviteNotAlreadySent(tx, vink.id, key);

      const now = ctx.clock.now();
      const mintedNow = input.accessTokenHash !== undefined;
      const guest: GuestIdentityRecord = {
        id: newGuestIdentityId(),
        displayName: input.displayName,
        accessTokenHash: input.accessTokenHash ?? null,
        expiresAt: mintedNow
          ? new Date(now.getTime() + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
          : null,
        createdAt: now.toISOString(),
        contactDestination: input.contactDestination ?? null,
        contactMethod: contactMethodFor(input.deliveryMode),
        deliveryMode: input.deliveryMode,
      };
      const participant: Participant = {
        id: newParticipantId(),
        vinkId: vink.id,
        userId: null,
        guestIdentityId: guest.id,
        displayName: input.displayName,
        role: 'MEMBER',
        status: 'JOINED',
        allocatedAmount: money(0),
        maximumApprovedAmount: money(0),
        joinedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await tx.insertGuestIdentity(guest);
      await tx.insertParticipant(participant);
      if (key !== undefined) await tx.recordGuestInviteIdempotencyKey(vink.id, key, participant.id);
      await tx.insertOutbox({
        eventType: 'ParticipantJoined',
        aggregateType: 'vink',
        aggregateId: vink.id,
        payload: {
          vinkId: vink.id,
          participantId: participant.id,
          guest: true,
          invitedByOrganizer: true,
        },
      });
      return { participant, guest, vink };
    });
  } catch (error) {
    if (!(error instanceof InviteIdempotencyRaceError)) throw error;
    // Lost a genuine concurrent race (both requests missed each other's pre-check) — the
    // database's unique constraint is the final guard (hard rule). Same outcome as the
    // sequential case: reject as already-sent, nothing to replay.
    throw new ApplicationError(
      'INVITE_ALREADY_SENT',
      'this invitation was already sent — refresh to see the guest who was added',
    );
  }
}

// ---------------------------------------------------------------------------
// ResendGuestInvitationCommand — Slice I4B (D38). Scoped to SMS/EMAIL-mode guests only: a
// MANUAL-mode guest was never automatically dispatched in the first place (the organizer's
// own copy of the link from the invite response is the only "resend" that mode has, and
// re-minting one here would silently invalidate whatever they already copied — worse, not
// better). Cooldown/throttling is enforced by the TRANSPORT (`vinks/routes.ts`, reading
// `VinkReader.listInvitationDeliveries`' own `attemptedAt` before ever calling this command) —
// this command's own job is narrower: verify the resend is legitimate (organizer owns the
// vink, the vink is open-or-later, the participant is a live SMS/EMAIL guest) and claim a
// fresh token slot. It does not call the delivery provider itself — same D14 reason
// `inviteGuestCommand` never has: the raw token this command mints must stay in the
// transport's hands to build the join URL and dispatch it, then be discarded.
// ---------------------------------------------------------------------------

export interface ResendGuestInvitationInput {
  vinkId: Vink['id'];
  participantId: Participant['id'];
  /** SHA-256 hash of a token the transport just minted for this resend. */
  tokenHash: string;
  expiresAt: string;
}

export interface ResendGuestInvitationResult {
  vink: Vink;
  participant: Participant;
  guest: GuestIdentityRecord;
}

export async function resendGuestInvitationCommand(
  ctx: CommandContext,
  input: ResendGuestInvitationInput,
): Promise<ResendGuestInvitationResult> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId);
    if (vink.state === 'DRAFT') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        'cannot resend before the vink is open — nothing has been dispatched yet',
      );
    }
    const participants = await tx.listParticipants(vink.id);
    const participant = participants.find(
      (row) => row.id === input.participantId && row.status !== 'REMOVED',
    );
    if (participant === undefined || participant.guestIdentityId === null) {
      throw new ApplicationError(
        'PARTICIPANT_NOT_FOUND',
        `no active guest participant ${input.participantId}`,
      );
    }
    const guest = await tx.getGuestIdentity(participant.guestIdentityId);
    if (guest === null) {
      throw new ApplicationError('PARTICIPANT_NOT_FOUND', 'guest identity missing');
    }
    if (guest.deliveryMode === 'MANUAL') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        'resend is only available for automatic (sms/email) delivery — this guest was invited with manual sharing',
      );
    }
    await tx.setGuestDeliveryToken(guest.id, input.tokenHash, input.expiresAt);
    return {
      vink,
      participant,
      guest: { ...guest, accessTokenHash: input.tokenHash, expiresAt: input.expiresAt },
    };
  });
}

// ---------------------------------------------------------------------------
// EditGuestParticipantCommand — Slice I5B (D40). Draft-only correction of a guest's display
// name, delivery mode, and contact destination — the same I4B contract `inviteGuestCommand`
// enforces (`assertDeliveryModeContract`), applied to the participant's resulting state
// instead of a brand-new one. Every field is resent on every call (not a sparse patch) —
// matching `inviteGuestSchema`'s own shape exactly removes any ambiguity about whether an
// omitted `contactDestination` means "unchanged" or "not applicable for this mode."
//
// The only case that ever touches the token is a transition into or out of MANUAL: MANUAL is
// the one mode that mints synchronously (I4B), so entering it needs a fresh mint (the raw
// token, once again, only ever exists in the transport — D14) and leaving it must clear the
// old one rather than let a since-abandoned manual link keep working silently.
// ---------------------------------------------------------------------------

export interface EditGuestParticipantInput {
  vinkId: Vink['id'];
  participantId: Participant['id'];
  expectedVersion?: number;
  displayName: string;
  deliveryMode: GuestDeliveryMode;
  contactDestination?: string;
  /** Transport-minted token hash — present only when this edit results in MANUAL mode and
   * the guest wasn't already MANUAL (a fresh mint is actually needed). Ignored otherwise,
   * exactly like `inviteGuestCommand`'s own `accessTokenHash` for every non-manual mode. */
  mintedAccessTokenHash?: string;
}

export interface EditGuestParticipantResult {
  participant: Participant;
  guest: GuestIdentityRecord;
  /** True only when this edit minted a genuinely new manual token — tells the transport
   * whether to return the corresponding raw joinUrl (D14: returned exactly once). */
  mintedNewManualToken: boolean;
}

export async function editGuestParticipantCommand(
  ctx: CommandContext,
  input: EditGuestParticipantInput,
): Promise<EditGuestParticipantResult> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    if (vink.state !== 'DRAFT') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        'participants can only be edited while the vink is still DRAFT',
      );
    }
    const participants = await tx.listParticipants(vink.id);
    const participant = participants.find(
      (row) => row.id === input.participantId && row.status !== 'REMOVED',
    );
    if (participant === undefined || participant.guestIdentityId === null) {
      throw new ApplicationError(
        'PARTICIPANT_NOT_FOUND',
        `no active guest participant ${input.participantId}`,
      );
    }
    const guest = await tx.getGuestIdentity(participant.guestIdentityId);
    if (guest === null) {
      throw new ApplicationError('PARTICIPANT_NOT_FOUND', 'guest identity missing');
    }

    const mintingManualNow = input.deliveryMode === 'MANUAL' && guest.deliveryMode !== 'MANUAL';
    const clearingManual = input.deliveryMode !== 'MANUAL' && guest.deliveryMode === 'MANUAL';

    assertDeliveryModeContract(
      input.deliveryMode,
      input.deliveryMode === 'MANUAL'
        ? mintingManualNow
          ? input.mintedAccessTokenHash
          : (guest.accessTokenHash ?? undefined)
        : undefined,
      input.contactDestination,
    );

    const updatedGuest: GuestIdentityRecord = {
      ...guest,
      displayName: input.displayName,
      deliveryMode: input.deliveryMode,
      contactDestination:
        input.deliveryMode === 'MANUAL' ? null : (input.contactDestination ?? null),
      contactMethod: contactMethodFor(input.deliveryMode),
    };
    await tx.updateGuestIdentity(updatedGuest);
    if (input.displayName !== participant.displayName) {
      await tx.updateParticipant({
        ...participant,
        displayName: input.displayName,
        updatedAt: ctx.clock.now().toISOString(),
      });
    }

    let mintedNewManualToken = false;
    let finalHash = guest.accessTokenHash;
    let finalExpiresAt = guest.expiresAt;
    if (mintingManualNow) {
      if (input.mintedAccessTokenHash === undefined) {
        throw new ApplicationError(
          'INVALID_COMMAND',
          'switching to manual delivery requires a minted token',
        );
      }
      finalExpiresAt = new Date(
        ctx.clock.now().getTime() + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      await tx.setGuestDeliveryToken(guest.id, input.mintedAccessTokenHash, finalExpiresAt);
      finalHash = input.mintedAccessTokenHash;
      mintedNewManualToken = true;
    } else if (clearingManual) {
      await tx.clearGuestDeliveryToken(guest.id);
      finalHash = null;
      finalExpiresAt = null;
    }

    return {
      participant: { ...participant, displayName: input.displayName },
      guest: { ...updatedGuest, accessTokenHash: finalHash, expiresAt: finalExpiresAt },
      mintedNewManualToken,
    };
  });
}

// ---------------------------------------------------------------------------
// Public + guest queries
// ---------------------------------------------------------------------------

/** D24 — `PublicVinkSummary` plus the two additive, guest-safe projections. `PublicVinkSummary`
 * itself is untouched (still used unmodified by `GuestJoinResult`, a write-command result out
 * of I1's read-model scope). */
export type EnrichedPublicVinkSummary = PublicVinkSummary & {
  contributionProgress: ContributionProgressView;
  vinkOutcome: GuestVinkOutcome;
};

export type PublicVinkView = NotOpenYetView | EnrichedPublicVinkSummary;

export interface GetGuestViewOptions {
  /** D23 — when true, a DRAFT vink returns only `NotOpenYetView`, never the full summary.
   * Defaults to false (today's exact existing behavior, preserved byte-for-byte for already-
   * deployed callers) until the gate rolls out behind a flag
   * (docs/design/phase-10-implementation-readiness.md §11). */
  gateDraft?: boolean;
}

async function loadContributionProgressData(
  reader: VinkReader,
  vink: Vink,
): Promise<{
  participants: Participant[];
  activeParticipantCount: number;
  latestStatusByParticipant: Map<string, string>;
}> {
  const [participants, contributions] = await Promise.all([
    reader.listParticipants(vink.id),
    reader.listContributionsByVink(vink.id),
  ]);
  return {
    participants,
    activeParticipantCount: participants.filter((row) => row.status !== 'REMOVED').length,
    latestStatusByParticipant: latestContributionStatusByParticipant(contributions),
  };
}

function enrichPublicSummary(
  vink: Vink,
  participants: Participant[],
  activeParticipantCount: number,
  latestStatusByParticipant: Map<string, string>,
  now: Date,
): EnrichedPublicVinkSummary {
  return {
    ...toPublicSummary(vink, activeParticipantCount, now),
    contributionProgress: computeContributionProgress(
      vink,
      participants,
      latestStatusByParticipant,
    ),
    vinkOutcome: computeGuestVinkOutcome(vink.state),
  };
}

/** Pre-join view behind the QR/share link — anonymous, rate-limited at the transport. */
export async function getPublicVinkView(
  reader: VinkReader,
  publicCode: string,
  now: Date,
): Promise<PublicVinkSummary>;
export async function getPublicVinkView(
  reader: VinkReader,
  publicCode: string,
  now: Date,
  options: GetGuestViewOptions,
): Promise<PublicVinkView>;
export async function getPublicVinkView(
  reader: VinkReader,
  publicCode: string,
  now: Date,
  options: GetGuestViewOptions = {},
): Promise<PublicVinkSummary | PublicVinkView> {
  const vink = await reader.getVinkByPublicCode(publicCode);
  if (vink === null) throw new ApplicationError('VINK_NOT_FOUND', 'unknown code');

  if (options.gateDraft === true && vink.state === 'DRAFT') {
    return { vinkOutcome: 'not_open_yet' };
  }

  const { participants, activeParticipantCount, latestStatusByParticipant } =
    await loadContributionProgressData(reader, vink);
  return enrichPublicSummary(
    vink,
    participants,
    activeParticipantCount,
    latestStatusByParticipant,
    now,
  );
}

/** D24 — the joined guest's own view. `GuestVinkView` itself always carries the new
 * `contributionProgress`/`vinkOutcome`/`contributionStatus` fields (purely additive — no
 * existing field changed or removed, so today's callers reading `.vink.publicCode` /
 * `.participant.displayName` are unaffected). Only the DRAFT-gate (D23) is opt-in, via the
 * fourth-argument overload, matching `getPublicVinkView`'s exact pattern. */
export interface GuestVinkView {
  vink: EnrichedPublicVinkSummary;
  participant: {
    id: Participant['id'];
    /** Needed by PV10's guest web client to open the realtime channel (keyed by vink id,
     * same route the organizer app uses) — not exposed pre-join (`PublicVinkSummary`
     * deliberately carries no internal ids), only once genuinely joined. */
    vinkId: Participant['vinkId'];
    displayName: string;
    status: Participant['status'];
    allocatedAmountMinor: number;
    maximumApprovedAmountMinor: number;
    /** D24/D25 — this guest's own contribution outcome, never another participant's. */
    contributionStatus: GuestContributionStatus;
  };
}

export type GuestVinkViewResult = NotOpenYetView | GuestVinkView;

// ---------------------------------------------------------------------------
// ParticipantVinkView — Slice I2B (docs/design/phase-10-implementation-readiness.md).
// The authenticated-member counterpart of GuestVinkView: same customer-safe boundary
// (own contribution only, aggregate progress only, never another participant's identity
// or status), just resolved from a signed-in `actorUserId` instead of a guest token. Exists
// because `getVinkSnapshot` (queries.ts) is organizer-only by design (D13/PV3) — a
// registered member added to someone else's vink has no other authenticated read path today.
// Reuses computeGuestVinkOutcome/computeGuestContributionStatus/enrichPublicSummary as-is:
// the categorization is identity-agnostic (driven by vink state + the viewer's own
// contribution status only), so it is exactly correct for a member too, not merely similar.
// ---------------------------------------------------------------------------

export interface ParticipantVinkView {
  vink: EnrichedPublicVinkSummary;
  participant: {
    id: Participant['id'];
    displayName: string;
    status: Participant['status'];
    allocatedAmountMinor: number;
    maximumApprovedAmountMinor: number;
    /** D24/D25 — this participant's own contribution outcome, never another participant's. */
    contributionStatus: GuestContributionStatus;
  };
}

/** The signed-in participant's own view of a vink they are not the organizer of. Throws
 * FORBIDDEN if the actor has no active (non-REMOVED) participant row on this vink — this is
 * an authorization boundary, not a privacy projection choice, so unlike getGuestVinkView it
 * has no legacy/overload shape to preserve (this endpoint is new; there is no prior caller
 * whose contract must survive unchanged). */
export async function getParticipantVinkView(
  reader: VinkReader,
  vinkId: Vink['id'],
  actorUserId: string,
  now: Date,
): Promise<ParticipantVinkView> {
  const vink = await reader.getVink(vinkId);
  if (vink === null) throw new ApplicationError('VINK_NOT_FOUND', `vink ${vinkId} not found`);

  const { participants, activeParticipantCount, latestStatusByParticipant } =
    await loadContributionProgressData(reader, vink);
  const self = participants.find(
    (participant) => participant.userId === actorUserId && participant.status !== 'REMOVED',
  );
  if (self === undefined) {
    throw new ApplicationError('FORBIDDEN', 'not an active participant of this vink');
  }
  return {
    vink: enrichPublicSummary(
      vink,
      participants,
      activeParticipantCount,
      latestStatusByParticipant,
      now,
    ),
    participant: {
      id: self.id,
      displayName: self.displayName,
      status: self.status,
      allocatedAmountMinor: self.allocatedAmount.amountMinor,
      maximumApprovedAmountMinor: self.maximumApprovedAmount.amountMinor,
      contributionStatus: computeGuestContributionStatus(
        latestStatusByParticipant.get(self.id),
        vink.state,
      ),
    },
  };
}

/** The joined guest's own view — resolved from the hashed token, never from client ids. */
export async function getGuestVinkView(
  reader: VinkReader,
  accessTokenHash: string,
  now: Date,
): Promise<GuestVinkView>;
export async function getGuestVinkView(
  reader: VinkReader,
  accessTokenHash: string,
  now: Date,
  options: GetGuestViewOptions,
): Promise<GuestVinkViewResult>;
export async function getGuestVinkView(
  reader: VinkReader,
  accessTokenHash: string,
  now: Date,
  options: GetGuestViewOptions = {},
): Promise<GuestVinkView | GuestVinkViewResult> {
  const resolved = await reader.findGuestParticipant(accessTokenHash, now);
  if (resolved === null)
    throw new ApplicationError('GUEST_UNAUTHENTICATED', 'invalid or expired guest token');
  const vink = await reader.getVink(resolved.participant.vinkId);
  if (vink === null)
    throw new ApplicationError('VINK_NOT_FOUND', 'vink missing for guest participant');

  if (options.gateDraft === true && vink.state === 'DRAFT') {
    return { vinkOutcome: 'not_open_yet' };
  }

  const { participants, activeParticipantCount, latestStatusByParticipant } =
    await loadContributionProgressData(reader, vink);
  const ownContributionStatus = latestStatusByParticipant.get(resolved.participant.id);

  return {
    vink: enrichPublicSummary(
      vink,
      participants,
      activeParticipantCount,
      latestStatusByParticipant,
      now,
    ),
    participant: {
      id: resolved.participant.id,
      vinkId: resolved.participant.vinkId,
      displayName: resolved.participant.displayName,
      status: resolved.participant.status,
      allocatedAmountMinor: resolved.participant.allocatedAmount.amountMinor,
      maximumApprovedAmountMinor: resolved.participant.maximumApprovedAmount.amountMinor,
      contributionStatus: computeGuestContributionStatus(ownContributionStatus, vink.state),
    },
  };
}
