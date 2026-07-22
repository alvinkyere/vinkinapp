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
// Slice I4 (D19/D27) — a real architectural finding, not a scope choice: this command
// deliberately never dispatches an automatic invitation itself, even though it's the exact
// moment a contact destination becomes available. The raw guest token is minted by the
// TRANSPORT (`newGuestToken()` in `apps/api/src/modules/vinks/routes.ts`) and only its hash
// ever reaches this command (D14, hard rule) — the join link a delivery message needs
// literally cannot be assembled here. Automatic dispatch for a guest invite can only happen
// in the same transport request that mints the token, while the raw value is still in scope;
// it can never be deferred to a later moment (e.g. batched at `VINK_OPENED`) the way a
// member's plain, non-secret invite link safely can (see `openVinkCommand`,
// `commands.ts`) — there is no way to "resend" a guest invite later without minting a new
// token, which is out of this slice's scope. This command only captures and stores the
// contact destination; the transport-layer dispatch call site is deferred (flagged in the
// I4 milestone report, not silently dropped) because `vinks/routes.ts` was under active,
// unrelated concurrent edit for this entire pass.
// ---------------------------------------------------------------------------

export interface InviteGuestInput {
  vinkId: Vink['id'];
  expectedVersion?: number;
  displayName: string;
  /** SHA-256 hash of the transport-minted guest token — same handling rule as
   * GuestJoinInput above: the application layer never sees the raw secret. */
  accessTokenHash: string;
  /** ENG1 #4: client-generated, stable across retries of the same "add as guest" attempt.
   * Optional — a caller that omits it just forgoes duplicate protection. Unlike
   * `CreateVinkInput.creationIdempotencyKey` (Slice 2), a detected repeat here is REJECTED
   * rather than replayed: the raw guest token/join link from the original attempt is gone by
   * design (D14 — only its hash is ever stored), so there is nothing to hand back. */
  invitationIdempotencyKey?: string;
  /** Slice I4 (D19/D27) — optional; captured and stored on the guest identity for later
   * automatic delivery. Deliberately NOT dispatched from inside this command — see the
   * doc comment above `inviteGuestCommand` for why (D14: the raw join link can only be
   * assembled where the raw token exists, which is the transport layer, never here). */
  contactDestination?: string;
  contactMethod?: 'EMAIL' | 'SMS';
}

export interface InviteGuestResult {
  participant: Participant;
  guest: GuestIdentityRecord;
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
  try {
    return await ctx.uow.run(async (tx) => {
      const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
      if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
        throw new ApplicationError('INVALID_COMMAND', `guests cannot be invited in ${vink.state}`);
      }
      if (key !== undefined) await assertInviteNotAlreadySent(tx, vink.id, key);

      const now = ctx.clock.now();
      const guest: GuestIdentityRecord = {
        id: newGuestIdentityId(),
        displayName: input.displayName,
        accessTokenHash: input.accessTokenHash,
        expiresAt: new Date(
          now.getTime() + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
        createdAt: now.toISOString(),
        contactDestination: input.contactDestination ?? null,
        contactMethod: input.contactMethod ?? null,
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
      return { participant, guest };
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
