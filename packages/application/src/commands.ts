/**
 * Vink commands (D13): every business action is validate → load (row-locked) → domain
 * decision → persist + history + outbox event (D12) in one unit of work → return aggregate.
 * Transports (HTTP today, WebSocket/jobs later) bind to these; nothing else mutates state.
 */

import {
  assertVinkAmounts,
  computeSplit,
  money,
  newParticipantId,
  newVinkId,
  policyForCategory,
  sumMoney,
  type Money,
  type Participant,
  type ParticipantId,
  type PurchaseCategory,
  type SplitMethod,
  type UserId,
  type Vink,
  type VinkId,
} from '../../domain/src/index.ts';
import { ApplicationError } from './errors.ts';
import type { CommandContext } from './ports.ts';
import { applyVinkTransition } from './support/transition.ts';
import { loadOwnedVink } from './support/guards.ts';
import { newPublicCode } from './support/public-code.ts';

/** Grace window after submissions close (G9 proposed default, config later). */
const PROCESSING_GRACE_SECONDS = 60;

export interface VinkWithParticipants {
  vink: Vink;
  participants: Participant[];
}

function activeParticipants(participants: Participant[]): Participant[] {
  return participants.filter((participant) => participant.status !== 'REMOVED');
}

export function unallocatedAmount(vink: Vink, participants: Participant[]): Money {
  const allocated = sumMoney(
    activeParticipants(participants).map((participant) => participant.allocatedAmount),
    vink.currency,
  );
  const remaining = vink.requiredAmount.amountMinor - allocated.amountMinor;
  return money(Math.max(remaining, 0), vink.currency);
}

// ---------------------------------------------------------------------------
// CreateVinkCommand
// ---------------------------------------------------------------------------

export interface CreateVinkInput {
  purchaseCategory: PurchaseCategory;
  subtotalMinor: number;
  tipMinor: number;
  submissionDeadline: string; // ISO-8601
  organizerDisplayName: string;
}

export async function createVinkCommand(
  ctx: CommandContext,
  input: CreateVinkInput,
): Promise<VinkWithParticipants> {
  const policy = policyForCategory(input.purchaseCategory); // rejects unsupported categories
  const subtotal = money(input.subtotalMinor);
  const tip = money(input.tipMinor);
  const required = money(subtotal.amountMinor + tip.amountMinor);
  const deadline = new Date(input.submissionDeadline);
  const now = ctx.clock.now();
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= now.getTime()) {
    throw new ApplicationError('INVALID_COMMAND', 'submissionDeadline must be in the future');
  }

  const vink: Vink = {
    id: newVinkId(),
    organizerUserId: ctx.actorUserId as UserId,
    publicCode: newPublicCode(),
    currency: 'USD',
    purchaseCategory: input.purchaseCategory,
    paymentPolicy: policy.policyType,
    subtotalAmount: subtotal,
    tipAmount: tip,
    maximumAmount: required, // EXACT_FINAL: card limit = funded amount (Plan §16)
    requiredAmount: required,
    fundedAmount: money(0),
    state: 'DRAFT',
    submissionDeadline: deadline.toISOString(),
    processingGraceDeadline: new Date(
      deadline.getTime() + PROCESSING_GRACE_SECONDS * 1000,
    ).toISOString(),
    merchantLockStatus: 'UNLOCKED',
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  assertVinkAmounts(vink);

  const organizer: Participant = {
    id: newParticipantId(),
    vinkId: vink.id,
    userId: ctx.actorUserId as UserId,
    guestIdentityId: null,
    displayName: input.organizerDisplayName,
    role: 'ORGANIZER',
    status: 'JOINED',
    allocatedAmount: money(0),
    maximumApprovedAmount: money(0),
    joinedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  return ctx.uow.run(async (tx) => {
    await tx.insertVink(vink);
    await tx.insertParticipant(organizer);
    await tx.insertOutbox({
      eventType: 'VinkCreated',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: { vinkId: vink.id, requiredAmountMinor: vink.requiredAmount.amountMinor },
    });
    return { vink, participants: [organizer] };
  });
}

// ---------------------------------------------------------------------------
// ConfigureVinkCommand — amounts/deadline changes while DRAFT
// ---------------------------------------------------------------------------

export interface ConfigureVinkInput {
  vinkId: VinkId;
  expectedVersion?: number;
  subtotalMinor?: number;
  tipMinor?: number;
  submissionDeadline?: string;
}

export async function configureVinkCommand(
  ctx: CommandContext,
  input: ConfigureVinkInput,
): Promise<Vink> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    if (vink.state !== 'DRAFT') {
      throw new ApplicationError('INVALID_COMMAND', 'vink configuration is editable only in DRAFT');
    }
    const now = ctx.clock.now();
    const subtotal =
      input.subtotalMinor !== undefined ? money(input.subtotalMinor) : vink.subtotalAmount;
    const tip = input.tipMinor !== undefined ? money(input.tipMinor) : vink.tipAmount;
    const required = money(subtotal.amountMinor + tip.amountMinor);
    let submissionDeadline = vink.submissionDeadline;
    let processingGraceDeadline = vink.processingGraceDeadline;
    if (input.submissionDeadline !== undefined) {
      const deadline = new Date(input.submissionDeadline);
      if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= now.getTime()) {
        throw new ApplicationError('INVALID_COMMAND', 'submissionDeadline must be in the future');
      }
      submissionDeadline = deadline.toISOString();
      processingGraceDeadline = new Date(
        deadline.getTime() + PROCESSING_GRACE_SECONDS * 1000,
      ).toISOString();
    }
    const updated: Vink = {
      ...vink,
      subtotalAmount: subtotal,
      tipAmount: tip,
      requiredAmount: required,
      maximumAmount: required,
      submissionDeadline,
      processingGraceDeadline,
      version: vink.version + 1,
      updatedAt: now.toISOString(),
    };
    assertVinkAmounts(updated);
    await tx.updateVink(updated);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// AddParticipantCommand — organizer adds a known registered user (guests join in PV4)
// ---------------------------------------------------------------------------

export interface AddParticipantInput {
  vinkId: VinkId;
  expectedVersion?: number;
  userId: UserId;
  displayName: string;
}

export async function addParticipantCommand(
  ctx: CommandContext,
  input: AddParticipantInput,
): Promise<Participant> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `participants cannot be added in ${vink.state}`,
      );
    }
    const existing = activeParticipants(await tx.listParticipants(vink.id));
    if (existing.some((participant) => participant.userId === input.userId)) {
      throw new ApplicationError('INVALID_COMMAND', 'user is already a participant');
    }
    const now = ctx.clock.now().toISOString();
    const participant: Participant = {
      id: newParticipantId(),
      vinkId: vink.id,
      userId: input.userId,
      guestIdentityId: null,
      displayName: input.displayName,
      role: 'MEMBER',
      status: 'JOINED',
      allocatedAmount: money(0),
      maximumApprovedAmount: money(0),
      joinedAt: now,
      updatedAt: now,
    };
    await tx.insertParticipant(participant);
    await tx.insertOutbox({
      eventType: 'ParticipantJoined',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: { vinkId: vink.id, participantId: participant.id },
    });
    return participant;
  });
}

// ---------------------------------------------------------------------------
// RemoveParticipantCommand
// ---------------------------------------------------------------------------

export interface RemoveParticipantInput {
  vinkId: VinkId;
  expectedVersion?: number;
  participantId: ParticipantId;
}

export async function removeParticipantCommand(
  ctx: CommandContext,
  input: RemoveParticipantInput,
): Promise<Participant> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `participants cannot be removed in ${vink.state}`,
      );
    }
    const participants = await tx.listParticipants(vink.id);
    const participant = participants.find((row) => row.id === input.participantId);
    if (participant === undefined || participant.status === 'REMOVED') {
      throw new ApplicationError(
        'PARTICIPANT_NOT_FOUND',
        `participant ${input.participantId} not found`,
      );
    }
    if (participant.role === 'ORGANIZER') {
      throw new ApplicationError('INVALID_COMMAND', 'the organizer cannot be removed');
    }
    const updated: Participant = {
      ...participant,
      status: 'REMOVED',
      allocatedAmount: money(0),
      maximumApprovedAmount: money(0),
      updatedAt: ctx.clock.now().toISOString(),
    };
    await tx.updateParticipant(updated);
    await tx.insertOutbox({
      eventType: 'ParticipantRemoved',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: { vinkId: vink.id, participantId: participant.id },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// SetSplitCommand — allocations via the split engine (Plan §15)
// ---------------------------------------------------------------------------

export type SetSplitInput = {
  vinkId: VinkId;
  expectedVersion?: number;
} & (
  | { method: Extract<SplitMethod, 'EQUAL'> }
  | {
      method: Extract<SplitMethod, 'CUSTOM_AMOUNT'>;
      amounts: ReadonlyArray<{ participantId: ParticipantId; amountMinor: number }>;
    }
  | {
      method: Extract<SplitMethod, 'PERCENTAGE'>;
      shares: ReadonlyArray<{ participantId: ParticipantId; basisPoints: number }>;
    }
);

export async function setSplitCommand(
  ctx: CommandContext,
  input: SetSplitInput,
): Promise<VinkWithParticipants> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
      throw new ApplicationError('INVALID_COMMAND', `the split cannot be changed in ${vink.state}`);
    }
    const participants = await tx.listParticipants(vink.id);
    // Stable join order makes the EQUAL remainder deterministic (Plan §15).
    const active = activeParticipants(participants).sort((a, b) =>
      a.joinedAt === b.joinedAt ? a.id.localeCompare(b.id) : a.joinedAt.localeCompare(b.joinedAt),
    );
    const activeIds = new Set<string>(active.map((participant) => participant.id));

    const allocations =
      input.method === 'EQUAL'
        ? computeSplit({
            method: 'EQUAL',
            requiredAmount: vink.requiredAmount,
            participantIds: active.map((participant) => participant.id),
          })
        : input.method === 'CUSTOM_AMOUNT'
          ? computeSplit({
              method: 'CUSTOM_AMOUNT',
              requiredAmount: vink.requiredAmount,
              amounts: input.amounts.map((entry) => ({
                participantId: entry.participantId,
                amount: money(entry.amountMinor),
              })),
            })
          : computeSplit({
              method: 'PERCENTAGE',
              requiredAmount: vink.requiredAmount,
              shares: input.shares,
            });

    for (const allocation of allocations) {
      if (!activeIds.has(allocation.participantId)) {
        throw new ApplicationError(
          'INVALID_COMMAND',
          `unknown participant ${allocation.participantId}`,
        );
      }
    }
    if (allocations.length !== active.length) {
      throw new ApplicationError(
        'INVALID_COMMAND',
        'the split must cover every active participant exactly once',
      );
    }

    const now = ctx.clock.now().toISOString();
    const byId = new Map(
      allocations.map((allocation) => [allocation.participantId, allocation.amount]),
    );
    const updatedParticipants: Participant[] = [];
    for (const participant of active) {
      const amount = byId.get(participant.id);
      if (amount === undefined) continue;
      const updated: Participant = {
        ...participant,
        allocatedAmount: amount,
        // The allocation is what each participant will be asked to approve (§4.7 cap).
        maximumApprovedAmount: amount,
        updatedAt: now,
      };
      await tx.updateParticipant(updated);
      updatedParticipants.push(updated);
    }
    const bumped: Vink = { ...vink, version: vink.version + 1, updatedAt: now };
    await tx.updateVink(bumped);
    await tx.insertOutbox({
      eventType: 'ParticipantAllocationChanged',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: {
        vinkId: vink.id,
        method: input.method,
        allocations: allocations.map((allocation) => ({
          participantId: allocation.participantId,
          amountMinor: allocation.amount.amountMinor,
        })),
      },
    });
    return { vink: bumped, participants: updatedParticipants };
  });
}

// ---------------------------------------------------------------------------
// OpenVinkCommand / CancelVinkCommand — state transitions (D12 via applyVinkTransition)
// ---------------------------------------------------------------------------

export interface VinkLifecycleInput {
  vinkId: VinkId;
  expectedVersion?: number;
}

export async function openVinkCommand(
  ctx: CommandContext,
  input: VinkLifecycleInput,
): Promise<Vink> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    const active = activeParticipants(await tx.listParticipants(vink.id));
    if (!active.some((participant) => participant.role === 'MEMBER')) {
      throw new ApplicationError(
        'INVALID_COMMAND',
        'a vink needs at least one participant besides the organizer',
      );
    }
    const remaining = unallocatedAmount(vink, active);
    if (remaining.amountMinor !== 0) {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `allocations must equal the required amount before opening (${remaining.amountMinor} unallocated)`,
      );
    }
    return applyVinkTransition(
      tx,
      vink,
      'VINK_OPENED',
      ctx.actorUserId,
      ctx.correlationId,
      ctx.clock.now(),
    );
  });
}

export async function cancelVinkCommand(
  ctx: CommandContext,
  input: VinkLifecycleInput,
): Promise<Vink> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    // The machine enforces legality (OPEN → CANCELLED; DRAFT cancel is unmodeled per G13).
    return applyVinkTransition(
      tx,
      vink,
      'ORGANIZER_CANCELLED',
      ctx.actorUserId,
      ctx.correlationId,
      ctx.clock.now(),
    );
  });
}

// ---------------------------------------------------------------------------
// CoverRemainingCommand — organizer absorbs the unallocated remainder (journey E3's PV3 form;
// the funding-time variant arrives with contributions in PV5)
// ---------------------------------------------------------------------------

export async function coverRemainingCommand(
  ctx: CommandContext,
  input: VinkLifecycleInput,
): Promise<VinkWithParticipants> {
  return ctx.uow.run(async (tx) => {
    const vink = await loadOwnedVink(tx, input.vinkId, ctx.actorUserId, input.expectedVersion);
    if (vink.state !== 'DRAFT' && vink.state !== 'OPEN') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `cover-remaining is not available in ${vink.state}`,
      );
    }
    const participants = await tx.listParticipants(vink.id);
    const active = activeParticipants(participants);
    const remaining = unallocatedAmount(vink, active);
    if (remaining.amountMinor === 0) {
      throw new ApplicationError('INVALID_COMMAND', 'nothing left to cover');
    }
    const organizer = active.find((participant) => participant.role === 'ORGANIZER');
    if (organizer === undefined) {
      throw new ApplicationError('INVALID_COMMAND', 'vink has no organizer participant');
    }
    const now = ctx.clock.now().toISOString();
    const updatedOrganizer: Participant = {
      ...organizer,
      allocatedAmount: money(organizer.allocatedAmount.amountMinor + remaining.amountMinor),
      maximumApprovedAmount: money(
        organizer.maximumApprovedAmount.amountMinor + remaining.amountMinor,
      ),
      updatedAt: now,
    };
    await tx.updateParticipant(updatedOrganizer);
    const bumped: Vink = { ...vink, version: vink.version + 1, updatedAt: now };
    await tx.updateVink(bumped);
    await tx.insertOutbox({
      eventType: 'ParticipantAllocationChanged',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: {
        vinkId: vink.id,
        method: 'COVER_REMAINING',
        allocations: [
          {
            participantId: updatedOrganizer.id,
            amountMinor: updatedOrganizer.allocatedAmount.amountMinor,
          },
        ],
      },
    });
    return { vink: bumped, participants: [updatedOrganizer] };
  });
}
