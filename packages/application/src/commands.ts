/**
 * Vink commands (D13): every business action is validate → load (row-locked) → domain
 * decision → persist + history + outbox event (D12) in one unit of work → return aggregate.
 * Transports (HTTP today, WebSocket/jobs later) bind to these; nothing else mutates state.
 */

import { randomUUID } from 'node:crypto';
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
import { ApplicationError, CreationIdempotencyRaceError } from './errors.ts';
import {
  dispatchMemberInvitation,
  dispatchMemberInvitationsOnOpen,
  type DeliveryCommandContext,
} from './delivery.ts';
import type { CommandContext, VinkTx } from './ports.ts';
import { applyVinkTransition } from './support/transition.ts';
import { loadOwnedVink } from './support/guards.ts';
import { newPublicCode } from './support/public-code.ts';

// ENG1 timer semantics: these match VINK_OPEN_DURATION_SECONDS/VINK_PROCESSING_GRACE_SECONDS'
// own defaults (apps/api/src/config/env.ts) exactly — the fallback for any caller (most
// tests, internal tooling) that doesn't thread real `ctx.timers` in, so behavior is
// unchanged for everyone who doesn't opt into configuring it.
const DEFAULT_OPEN_DURATION_SECONDS = 86_400;
const DEFAULT_PROCESSING_GRACE_SECONDS = 60;

export interface VinkWithParticipants {
  vink: Vink;
  participants: Participant[];
}

function activeParticipants(participants: Participant[]): Participant[] {
  return participants.filter((participant) => participant.status !== 'REMOVED');
}

/**
 * Allocation-shape changes are locked once any live contribution exists — an authorized
 * amount must keep matching its allocation or the funding resolver could never conclude
 * (§15 split-immutability spirit; participant-exit flows arrive with PV7 recovery work).
 */
async function assertNoLiveContributions(
  tx: VinkTx,
  vinkId: VinkId,
  action: string,
): Promise<void> {
  const contributions = await tx.listContributionsForUpdate(vinkId);
  if (contributions.some((row) => row.status !== 'DECLINED' && row.status !== 'CANCELLED')) {
    throw new ApplicationError(
      'INVALID_COMMAND',
      `${action} is locked once contributions have started`,
    );
  }
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
  /** Slice I5B (D39) — optional here (the five-step wizard, and any other pre-I5B caller,
   * never sends one), even though the canonical Flutter screen requires it client-side
   * before Continue enables. Trimmed defensively; empty-after-trim is treated as absent
   * (never stored as `''`) so a blank string and an omitted field mean the same thing. */
  purpose?: string;
  subtotalMinor: number;
  tipMinor: number;
  /** ISO-8601. ENG1 timer semantics: optional — the real client no longer computes and sends
   * this itself (it used to hardcode `now + 24h`, exactly the "accidentally hard-coded"
   * client-side timing the ENG1 brief warns about); omitting it defers to the server's own
   * `ctx.timers.openDurationSeconds` (or the matching default). An explicit value is still
   * accepted — genuinely useful for tests that need specific control over deadline timing,
   * not a production backdoor, since the real app stopped sending one. */
  submissionDeadline?: string;
  organizerDisplayName: string;
  /** Client-generated, stable across retries of the same create attempt (ENG1 #4): a lost-
   * response retry with the same key replays the original Vink instead of creating a
   * duplicate. Optional so existing callers (tests, internal tooling) are unaffected —
   * omitting it just forgoes replay protection for that call. */
  creationIdempotencyKey?: string;
}

async function findVinkReplay(
  tx: VinkTx,
  organizerUserId: string,
  creationIdempotencyKey: string,
): Promise<VinkWithParticipants | null> {
  const existing = await tx.findVinkByCreationIdempotencyKey(
    organizerUserId,
    creationIdempotencyKey,
  );
  if (existing === null) return null;
  return { vink: existing, participants: await tx.listParticipants(existing.id) };
}

export async function createVinkCommand(
  ctx: CommandContext,
  input: CreateVinkInput,
): Promise<VinkWithParticipants> {
  const policy = policyForCategory(input.purchaseCategory); // rejects unsupported categories
  const subtotal = money(input.subtotalMinor);
  const tip = money(input.tipMinor);
  const required = money(subtotal.amountMinor + tip.amountMinor);
  const now = ctx.clock.now();
  const openDurationSeconds = ctx.timers?.openDurationSeconds ?? DEFAULT_OPEN_DURATION_SECONDS;
  const processingGraceSeconds =
    ctx.timers?.processingGraceSeconds ?? DEFAULT_PROCESSING_GRACE_SECONDS;
  const deadline =
    input.submissionDeadline !== undefined
      ? new Date(input.submissionDeadline)
      : new Date(now.getTime() + openDurationSeconds * 1000);
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= now.getTime()) {
    throw new ApplicationError('INVALID_COMMAND', 'submissionDeadline must be in the future');
  }
  // A caller that doesn't care about replay protection (internal tooling, most tests) still
  // gets a key so every row satisfies the NOT NULL/unique constraint — a fresh random one
  // never collides, so it behaves exactly like "always insert," same as before this existed.
  const creationIdempotencyKey = input.creationIdempotencyKey ?? randomUUID();

  const vink: Vink = {
    id: newVinkId(),
    organizerUserId: ctx.actorUserId as UserId,
    publicCode: newPublicCode(),
    currency: 'USD',
    purpose: input.purpose?.trim() ? input.purpose.trim() : null,
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
      deadline.getTime() + processingGraceSeconds * 1000,
    ).toISOString(),
    merchantLockStatus: 'UNLOCKED',
    version: 1,
    creationIdempotencyKey,
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

  try {
    return await ctx.uow.run(async (tx) => {
      // The common case (response lost after the original request already committed): the
      // retry finds the earlier row and replays it, no new insert, no duplicate VinkCreated.
      const replay = await findVinkReplay(tx, vink.organizerUserId, creationIdempotencyKey);
      if (replay !== null) return replay;

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
  } catch (error) {
    if (!(error instanceof CreationIdempotencyRaceError)) throw error;
    // Rarer case: two truly concurrent requests both missed each other's pre-check and both
    // tried to insert; this one lost at the unique constraint. The winner has already
    // committed in its own transaction, so replay it fresh rather than surfacing an error.
    const winner = await ctx.uow.run((tx) =>
      findVinkReplay(tx, vink.organizerUserId, creationIdempotencyKey),
    );
    if (winner === null) throw error; // unreachable: the constraint only fires if a winner exists
    return winner;
  }
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
        deadline.getTime() +
          (ctx.timers?.processingGraceSeconds ?? DEFAULT_PROCESSING_GRACE_SECONDS) * 1000,
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
  ctx: DeliveryCommandContext,
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
      // ENG1 #4: a distinct code (not generic INVALID_COMMAND) so a duplicate add — a
      // double-tap, or a lost-response retry — can be told apart from a genuinely invalid
      // command and treated as "already done," not an error.
      throw new ApplicationError('PARTICIPANT_ALREADY_ADDED', 'user is already a participant');
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
    // Slice I4 — dispatch-ordering: never before VINK_OPENED. A member added while still
    // DRAFT is NOT dispatched here (openVinkCommand's own batch dispatch picks them up once
    // the vink actually opens); a member added once the vink is already OPEN-or-later has
    // already passed that gate, so their own invite fires immediately — there's no reason to
    // make them wait for an event that already happened.
    if (vink.state === 'OPEN') {
      const organizer = existing.find((row) => row.role === 'ORGANIZER');
      if (organizer !== undefined) {
        await dispatchMemberInvitation(ctx, tx, vink, participant, organizer.displayName);
      }
    }
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
    await assertNoLiveContributions(tx, vink.id, 'participant removal');
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
    await assertNoLiveContributions(tx, vink.id, 'the split');
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
  ctx: DeliveryCommandContext,
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
    const opened = await applyVinkTransition(
      tx,
      vink,
      'VINK_OPENED',
      ctx.actorUserId,
      ctx.correlationId,
      ctx.clock.now(),
    );
    // Slice I4 (D19/D27) — the actual "automatic delivery fires at VINK_OPENED" trigger, for
    // every member added while the vink was still DRAFT (never dispatched earlier — see
    // addParticipantCommand's own comment on this exact ordering). Runs after the transition
    // has succeeded, inside the same unit of work — a delivery failure here never rolls back
    // or misrepresents the vink's own now-committed OPEN state (Phase 5 §2).
    await dispatchMemberInvitationsOnOpen(ctx, tx, opened, active);
    return opened;
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
    await assertNoLiveContributions(tx, vink.id, 'cover-remaining');
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
