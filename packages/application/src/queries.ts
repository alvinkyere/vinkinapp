/**
 * Read-side queries. `allowedActions` is computed here, server-side — clients render what
 * the server permits and never re-derive state-machine logic (master plan §19).
 */

import type { Participant, Vink, VinkId } from '../../domain/src/index.ts';
import { ApplicationError } from './errors.ts';
import type { ActivityEntry, VinkReader } from './ports.ts';
import { unallocatedAmount } from './commands.ts';

export type AllowedAction =
  'OPEN_VINK' | 'CANCEL_VINK' | 'ADD_PARTICIPANT' | 'EDIT_ALLOCATION' | 'COVER_REMAINING';

export interface VinkSnapshot {
  vink: Vink;
  participants: Participant[];
  unallocatedAmountMinor: number;
  allowedActions: AllowedAction[];
}

export function computeAllowedActions(vink: Vink, participants: Participant[]): AllowedAction[] {
  const active = participants.filter((participant) => participant.status !== 'REMOVED');
  const remaining = unallocatedAmount(vink, active).amountMinor;
  const hasMember = active.some((participant) => participant.role === 'MEMBER');
  const actions: AllowedAction[] = [];
  if (vink.state === 'DRAFT') {
    if (hasMember && remaining === 0) actions.push('OPEN_VINK');
    actions.push('ADD_PARTICIPANT', 'EDIT_ALLOCATION');
    if (remaining > 0) actions.push('COVER_REMAINING');
  } else if (vink.state === 'OPEN') {
    actions.push('CANCEL_VINK', 'ADD_PARTICIPANT', 'EDIT_ALLOCATION');
    if (remaining > 0) actions.push('COVER_REMAINING');
  }
  return actions;
}

async function loadOwnedVinkForRead(
  reader: VinkReader,
  vinkId: VinkId,
  actorUserId: string,
): Promise<Vink> {
  const vink = await reader.getVink(vinkId);
  if (vink === null) throw new ApplicationError('VINK_NOT_FOUND', `vink ${vinkId} not found`);
  if (vink.organizerUserId !== actorUserId) {
    // PV3 is the organizer API; participant/guest views arrive with PV4 tokens.
    throw new ApplicationError('FORBIDDEN', 'only the organizer may view this vink');
  }
  return vink;
}

export async function getVinkSnapshot(
  reader: VinkReader,
  vinkId: VinkId,
  actorUserId: string,
): Promise<VinkSnapshot> {
  const vink = await loadOwnedVinkForRead(reader, vinkId, actorUserId);
  const participants = await reader.listParticipants(vinkId);
  const active = participants.filter((participant) => participant.status !== 'REMOVED');
  return {
    vink,
    participants,
    unallocatedAmountMinor: unallocatedAmount(vink, active).amountMinor,
    allowedActions: computeAllowedActions(vink, participants),
  };
}

export async function getVinkActivity(
  reader: VinkReader,
  vinkId: VinkId,
  actorUserId: string,
): Promise<ActivityEntry[]> {
  await loadOwnedVinkForRead(reader, vinkId, actorUserId);
  return reader.listActivity(vinkId);
}
