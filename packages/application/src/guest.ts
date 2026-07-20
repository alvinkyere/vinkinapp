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
import { ApplicationError } from './errors.ts';
import type {
  CommandContext,
  GuestIdentityRecord,
  PublicCommandContext,
  VinkReader,
} from './ports.ts';
import { loadOwnedVink } from './support/guards.ts';

export const GUEST_TOKEN_TTL_DAYS = 7;

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
// ---------------------------------------------------------------------------

export interface InviteGuestInput {
  vinkId: Vink['id'];
  expectedVersion?: number;
  displayName: string;
  /** SHA-256 hash of the transport-minted guest token — same handling rule as
   * GuestJoinInput above: the application layer never sees the raw secret. */
  accessTokenHash: string;
}

export interface InviteGuestResult {
  participant: Participant;
  guest: GuestIdentityRecord;
}

export async function inviteGuestCommand(
  ctx: CommandContext,
  input: InviteGuestInput,
): Promise<InviteGuestResult> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
      throw new ApplicationError('INVALID_COMMAND', `guests cannot be invited in ${vink.state}`);
    }
    const now = ctx.clock.now();
    const guest: GuestIdentityRecord = {
      id: newGuestIdentityId(),
      displayName: input.displayName,
      accessTokenHash: input.accessTokenHash,
      expiresAt: new Date(now.getTime() + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
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
      payload: {
        vinkId: vink.id,
        participantId: participant.id,
        guest: true,
        invitedByOrganizer: true,
      },
    });
    return { participant, guest };
  });
}

// ---------------------------------------------------------------------------
// Public + guest queries
// ---------------------------------------------------------------------------

/** Pre-join view behind the QR/share link — anonymous, rate-limited at the transport. */
export async function getPublicVinkView(
  reader: VinkReader,
  publicCode: string,
  now: Date,
): Promise<PublicVinkSummary> {
  const vink = await reader.getVinkByPublicCode(publicCode);
  if (vink === null) throw new ApplicationError('VINK_NOT_FOUND', 'unknown code');
  const participantCount = (await reader.listParticipants(vink.id)).filter(
    (row) => row.status !== 'REMOVED',
  ).length;
  return toPublicSummary(vink, participantCount, now);
}

export interface GuestVinkView {
  vink: PublicVinkSummary;
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
  };
}

/** The joined guest's own view — resolved from the hashed token, never from client ids. */
export async function getGuestVinkView(
  reader: VinkReader,
  accessTokenHash: string,
  now: Date,
): Promise<GuestVinkView> {
  const resolved = await reader.findGuestParticipant(accessTokenHash, now);
  if (resolved === null)
    throw new ApplicationError('GUEST_UNAUTHENTICATED', 'invalid or expired guest token');
  const vink = await reader.getVink(resolved.participant.vinkId);
  if (vink === null)
    throw new ApplicationError('VINK_NOT_FOUND', 'vink missing for guest participant');
  const participantCount = (await reader.listParticipants(vink.id)).filter(
    (row) => row.status !== 'REMOVED',
  ).length;
  return {
    vink: toPublicSummary(vink, participantCount, now),
    participant: {
      id: resolved.participant.id,
      vinkId: resolved.participant.vinkId,
      displayName: resolved.participant.displayName,
      status: resolved.participant.status,
      allocatedAmountMinor: resolved.participant.allocatedAmount.amountMinor,
      maximumApprovedAmountMinor: resolved.participant.maximumApprovedAmount.amountMinor,
    },
  };
}
