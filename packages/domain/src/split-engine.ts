/**
 * Split engine — Plan §15. EQUAL, CUSTOM_AMOUNT and PERCENTAGE only; ITEMIZED_LATER is
 * rejected during the validation phase. All arithmetic is integer minor units.
 *
 * Invariants enforced (Plan §15):
 *  - sum of allocations = required amount
 *  - no allocation is negative
 *  - no participant allocated more than their per-participant maximum (when given)
 *  - percentages (basis points) total exactly 10000
 *  - rounding remainder assigned deterministically
 *
 * Determinism: callers pass participants in a stable order (join order). EQUAL assigns the
 * remainder one minor unit at a time from the first participant ($100/3 → 33.34, 33.33,
 * 33.33 — the Plan §15 example). PERCENTAGE uses the largest-remainder method with input
 * order as the tie-break.
 */

import type { Money, CurrencyCode } from './money.ts';
import { money, sumMoney, compareMoney } from './money.ts';
import { DomainError } from './errors.ts';
import type { ParticipantId } from './ids.ts';

export interface SplitAllocation {
  participantId: ParticipantId;
  amount: Money;
}

export interface EqualSplitInput {
  method: 'EQUAL';
  requiredAmount: Money;
  participantIds: readonly ParticipantId[];
}

export interface CustomAmountSplitInput {
  method: 'CUSTOM_AMOUNT';
  requiredAmount: Money;
  amounts: ReadonlyArray<{ participantId: ParticipantId; amount: Money }>;
}

export interface PercentageSplitInput {
  method: 'PERCENTAGE';
  requiredAmount: Money;
  /** Basis points per participant; must total exactly 10000. */
  shares: ReadonlyArray<{ participantId: ParticipantId; basisPoints: number }>;
}

export interface ItemizedLaterSplitInput {
  method: 'ITEMIZED_LATER';
}

export type SplitInput =
  EqualSplitInput | CustomAmountSplitInput | PercentageSplitInput | ItemizedLaterSplitInput;

export interface SplitOptions {
  /** Optional §15 "allowed session maximum" cap applied to every allocation. */
  perParticipantMaximum?: Money;
}

export function computeSplit(input: SplitInput, options: SplitOptions = {}): SplitAllocation[] {
  if (input.method === 'ITEMIZED_LATER') {
    throw new DomainError(
      'UNSUPPORTED_SPLIT_METHOD',
      'ITEMIZED_LATER is not built during the validation phase (Plan §15)',
    );
  }
  const allocations = computeAllocations(input);
  assertSplitInvariants(allocations, input, options);
  return allocations;
}

function computeAllocations(
  input: Exclude<SplitInput, ItemizedLaterSplitInput>,
): SplitAllocation[] {
  switch (input.method) {
    case 'EQUAL':
      return equalSplit(input);
    case 'CUSTOM_AMOUNT':
      return input.amounts.map(({ participantId, amount }) => ({ participantId, amount }));
    case 'PERCENTAGE':
      return percentageSplit(input);
  }
}

function equalSplit(input: EqualSplitInput): SplitAllocation[] {
  const count = input.participantIds.length;
  if (count === 0)
    throw new DomainError('INVALID_SPLIT', 'EQUAL split requires at least one participant');

  const total = input.requiredAmount.amountMinor;
  const currency = input.requiredAmount.currency;
  const base = Math.floor(total / count);
  const remainder = total % count;

  return input.participantIds.map((participantId, index) => ({
    participantId,
    amount: money(base + (index < remainder ? 1 : 0), currency),
  }));
}

function percentageSplit(input: PercentageSplitInput): SplitAllocation[] {
  if (input.shares.length === 0) {
    throw new DomainError('INVALID_SPLIT', 'PERCENTAGE split requires at least one participant');
  }
  for (const share of input.shares) {
    if (!Number.isSafeInteger(share.basisPoints) || share.basisPoints < 0) {
      throw new DomainError(
        'INVALID_SPLIT',
        `basisPoints must be non-negative integers, got ${share.basisPoints}`,
      );
    }
  }
  const totalBasisPoints = input.shares.reduce((sum, share) => sum + share.basisPoints, 0);
  if (totalBasisPoints !== 10_000) {
    throw new DomainError(
      'INVALID_SPLIT',
      `PERCENTAGE shares must total exactly 10000 basis points, got ${totalBasisPoints}`,
    );
  }

  const total = input.requiredAmount.amountMinor;
  const currency: CurrencyCode = input.requiredAmount.currency;

  // Largest-remainder method: floor every share, then hand out the leftover minor units in
  // descending fractional-remainder order; ties break on input order (stable sort).
  const floored = input.shares.map((share, index) => {
    const exact = total * share.basisPoints;
    return {
      participantId: share.participantId,
      index,
      floor: Math.floor(exact / 10_000),
      fractionalRemainder: exact % 10_000,
    };
  });

  let leftover = total - floored.reduce((sum, entry) => sum + entry.floor, 0);
  const byRemainder = [...floored].sort(
    (a, b) => b.fractionalRemainder - a.fractionalRemainder || a.index - b.index,
  );
  const extraByIndex = new Set<number>();
  for (const entry of byRemainder) {
    if (leftover === 0) break;
    extraByIndex.add(entry.index);
    leftover -= 1;
  }

  return floored.map((entry) => ({
    participantId: entry.participantId,
    amount: money(entry.floor + (extraByIndex.has(entry.index) ? 1 : 0), currency),
  }));
}

function assertSplitInvariants(
  allocations: readonly SplitAllocation[],
  input: Exclude<SplitInput, ItemizedLaterSplitInput>,
  options: SplitOptions,
): void {
  const seen = new Set<string>();
  for (const allocation of allocations) {
    if (seen.has(allocation.participantId)) {
      throw new DomainError('INVALID_SPLIT', `Duplicate participant ${allocation.participantId}`);
    }
    seen.add(allocation.participantId);
    // money() already rejects negatives; re-assert to keep the §15 invariant explicit.
    if (allocation.amount.amountMinor < 0) {
      throw new DomainError('INVALID_SPLIT', 'No allocation may be negative');
    }
    if (
      options.perParticipantMaximum !== undefined &&
      compareMoney(allocation.amount, options.perParticipantMaximum) > 0
    ) {
      throw new DomainError(
        'INVALID_SPLIT',
        `Allocation ${allocation.amount.amountMinor} for ${allocation.participantId} exceeds the session per-participant maximum ${options.perParticipantMaximum.amountMinor}`,
      );
    }
  }

  const allocated = sumMoney(
    allocations.map((allocation) => allocation.amount),
    input.requiredAmount.currency,
  );
  if (allocated.amountMinor !== input.requiredAmount.amountMinor) {
    throw new DomainError(
      'INVALID_SPLIT',
      `Allocations total ${allocated.amountMinor} but required amount is ${input.requiredAmount.amountMinor}`,
    );
  }
}
