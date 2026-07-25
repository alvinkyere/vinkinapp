/**
 * Invites feature (2026-07-23, D44): a real `INVITED -> accept/decline` gate before an
 * existing member added to someone else's Vink becomes `JOINED`, replacing the previous
 * immediate-join behavior. See `addParticipantCommand` (commands.ts) for the write side that
 * creates the `INVITED` row in the first place — this module owns only what the invitee
 * themselves can do with it: accept, decline, and list their own pending invites.
 */

import {
  money,
  type Participant,
  type PurchaseCategory,
  type Vink,
  type VinkId,
} from '../../domain/src/index.ts';
import { assertNoLiveContributions } from './commands.ts';
import { ApplicationError } from './errors.ts';
import type { CommandContext, VinkReader } from './ports.ts';
import { loadVink } from './support/guards.ts';

export interface AcceptInviteInput {
  vinkId: VinkId;
  expectedVersion?: number;
}

export interface DeclineInviteInput {
  vinkId: VinkId;
  expectedVersion?: number;
}

/** Resolves the actor's own `INVITED` participant row on this vink, or throws. Not
 * `loadOwnedVink`'s organizer check — the invitee is calling on their own behalf.
 *
 * The organizer is always a participant of their own vink (`status: 'JOINED'`, set at
 * creation) — matching only on `userId` would misclassify the organizer calling this by
 * mistake as "already resolved" rather than "not an invite at all." `role === 'MEMBER'` is
 * required too, so only a genuinely never-was-an-invite actor (a stranger) gets FORBIDDEN,
 * and only a real MEMBER row that has already left `INVITED` gets INVITE_ALREADY_RESOLVED. */
async function findOwnInvite(
  participants: Participant[],
  actorUserId: string,
): Promise<Participant> {
  const participant = participants.find(
    (row) => row.userId === actorUserId && row.role === 'MEMBER',
  );
  if (participant === undefined) {
    throw new ApplicationError('FORBIDDEN', 'no invite found for this user on this vink');
  }
  if (participant.status !== 'INVITED') {
    throw new ApplicationError(
      'INVITE_ALREADY_RESOLVED',
      'this invite was already accepted or declined',
    );
  }
  return participant;
}

export async function acceptInviteCommand(
  ctx: CommandContext,
  input: AcceptInviteInput,
): Promise<Participant> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadVink(tx, input.vinkId, input.expectedVersion);
    if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
      throw new ApplicationError('INVALID_COMMAND', `invites cannot be resolved in ${vink.state}`);
    }
    const participants = await tx.listParticipants(vink.id);
    const participant = await findOwnInvite(participants, ctx.actorUserId);
    const now = ctx.clock.now().toISOString();
    const updated: Participant = {
      ...participant,
      status: 'JOINED',
      joinedAt: now,
      updatedAt: now,
    };
    await tx.updateParticipant(updated);
    await tx.insertOutbox({
      eventType: 'ParticipantInviteAccepted',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: { vinkId: vink.id, participantId: participant.id },
    });
    return updated;
  });
}

export async function declineInviteCommand(
  ctx: CommandContext,
  input: DeclineInviteInput,
): Promise<Participant> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadVink(tx, input.vinkId, input.expectedVersion);
    if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
      throw new ApplicationError('INVALID_COMMAND', `invites cannot be resolved in ${vink.state}`);
    }
    const participants = await tx.listParticipants(vink.id);
    const participant = await findOwnInvite(participants, ctx.actorUserId);
    // Same vink-wide allocation-shape lock removeParticipantCommand already enforces — a
    // decline changes the split exactly like a removal does.
    await assertNoLiveContributions(tx, vink.id, 'declining an invite');
    const updated: Participant = {
      ...participant,
      status: 'REMOVED',
      allocatedAmount: money(0),
      maximumApprovedAmount: money(0),
      updatedAt: ctx.clock.now().toISOString(),
    };
    await tx.updateParticipant(updated);
    await tx.insertOutbox({
      eventType: 'ParticipantInviteDeclined',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: { vinkId: vink.id, participantId: participant.id },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Read side — "my pending invites"
// ---------------------------------------------------------------------------

export interface PendingInvite {
  vinkId: Vink['id'];
  purpose: string | null;
  purchaseCategory: PurchaseCategory;
  organizerDisplayName: string;
  assignedShareMinor: number;
  invitedAt: string;
}

/** Newest-invited-first. Deliberately a small, purpose-built projection (not
 * `ParticipantVinkView`/`enrichPublicSummary`) — a pending invite needs "why am I seeing
 * this" (organizer identity, your share), not the funding-progress detail a joined
 * participant's own view needs. Same per-vink N+1 read this codebase already accepts at
 * pilot scale for Activity (`recentActivityProvider`'s own established pattern). */
export async function listMyPendingInvites(
  reader: VinkReader,
  actorUserId: string,
): Promise<PendingInvite[]> {
  const vinks = await reader.listVinksByPendingInvite(actorUserId);
  const invites: PendingInvite[] = [];
  for (const vink of vinks) {
    const participants = await reader.listParticipants(vink.id);
    const self = participants.find((row) => row.userId === actorUserId && row.status === 'INVITED');
    const organizer = participants.find((row) => row.role === 'ORGANIZER');
    if (self === undefined || organizer === undefined) continue;
    invites.push({
      vinkId: vink.id,
      purpose: vink.purpose,
      purchaseCategory: vink.purchaseCategory,
      organizerDisplayName: organizer.displayName,
      assignedShareMinor: self.allocatedAmount.amountMinor,
      invitedAt: self.invitedAt,
    });
  }
  return invites;
}
