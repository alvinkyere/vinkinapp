import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSplit, type SplitAllocation } from './split-engine.ts';
import { money } from './money.ts';
import { DomainError } from './errors.ts';
import type { ParticipantId } from './ids.ts';

const p = (name: string): ParticipantId => name as ParticipantId;

function total(allocations: readonly SplitAllocation[]): number {
  return allocations.reduce((sum, allocation) => sum + allocation.amount.amountMinor, 0);
}

describe('Split engine (Plan §15)', () => {
  describe('EQUAL', () => {
    it('splits $100.00 / 3 as 33.34 / 33.33 / 33.33 (Plan §15 example)', () => {
      const allocations = computeSplit({
        method: 'EQUAL',
        requiredAmount: money(10_000),
        participantIds: [p('A'), p('B'), p('C')],
      });
      assert.deepEqual(
        allocations.map((allocation) => allocation.amount.amountMinor),
        [3334, 3333, 3333],
      );
    });

    it('splits exactly when the amount divides evenly', () => {
      const allocations = computeSplit({
        method: 'EQUAL',
        requiredAmount: money(12_000),
        participantIds: [p('A'), p('B'), p('C')],
      });
      assert.deepEqual(
        allocations.map((allocation) => allocation.amount.amountMinor),
        [4000, 4000, 4000],
      );
    });

    it('is deterministic: same input order, same remainder assignment', () => {
      const input = {
        method: 'EQUAL',
        requiredAmount: money(1001),
        participantIds: [p('A'), p('B'), p('C'), p('D')],
      } as const;
      assert.deepEqual(computeSplit(input), computeSplit(input));
      assert.deepEqual(
        computeSplit(input).map((allocation) => allocation.amount.amountMinor),
        [251, 250, 250, 250],
      );
    });

    it('sums to the required amount for adversarial totals', () => {
      for (const amount of [1, 7, 99, 101, 9999, 123457]) {
        for (const count of [1, 2, 3, 7, 11]) {
          const allocations = computeSplit({
            method: 'EQUAL',
            requiredAmount: money(amount),
            participantIds: Array.from({ length: count }, (_, i) => p(`P${i}`)),
          });
          assert.equal(total(allocations), amount, `${amount} / ${count}`);
        }
      }
    });

    it('rejects zero participants', () => {
      assert.throws(
        () => computeSplit({ method: 'EQUAL', requiredAmount: money(100), participantIds: [] }),
        (error: unknown) => error instanceof DomainError && error.code === 'INVALID_SPLIT',
      );
    });
  });

  describe('CUSTOM_AMOUNT', () => {
    it('accepts amounts that sum exactly to the required amount', () => {
      const allocations = computeSplit({
        method: 'CUSTOM_AMOUNT',
        requiredAmount: money(10_000),
        amounts: [
          { participantId: p('A'), amount: money(8_000) },
          { participantId: p('B'), amount: money(2_000) },
        ],
      });
      assert.equal(total(allocations), 10_000);
    });

    it('rejects a sum mismatch', () => {
      assert.throws(
        () =>
          computeSplit({
            method: 'CUSTOM_AMOUNT',
            requiredAmount: money(10_000),
            amounts: [
              { participantId: p('A'), amount: money(8_000) },
              { participantId: p('B'), amount: money(1_999) },
            ],
          }),
        (error: unknown) => error instanceof DomainError && error.code === 'INVALID_SPLIT',
      );
    });

    it('rejects duplicate participants', () => {
      assert.throws(
        () =>
          computeSplit({
            method: 'CUSTOM_AMOUNT',
            requiredAmount: money(200),
            amounts: [
              { participantId: p('A'), amount: money(100) },
              { participantId: p('A'), amount: money(100) },
            ],
          }),
        (error: unknown) => error instanceof DomainError && error.code === 'INVALID_SPLIT',
      );
    });

    it('rejects negative amounts at Money construction (no allocation is negative)', () => {
      assert.throws(
        () => money(-1),
        (error: unknown) => error instanceof DomainError && error.code === 'INVALID_MONEY',
      );
    });
  });

  describe('PERCENTAGE', () => {
    it('rejects shares that do not total 10000 basis points', () => {
      assert.throws(
        () =>
          computeSplit({
            method: 'PERCENTAGE',
            requiredAmount: money(10_000),
            shares: [
              { participantId: p('A'), basisPoints: 5000 },
              { participantId: p('B'), basisPoints: 4999 },
            ],
          }),
        (error: unknown) => error instanceof DomainError && error.code === 'INVALID_SPLIT',
      );
    });

    it('splits 50/30/20 exactly', () => {
      const allocations = computeSplit({
        method: 'PERCENTAGE',
        requiredAmount: money(10_000),
        shares: [
          { participantId: p('A'), basisPoints: 5000 },
          { participantId: p('B'), basisPoints: 3000 },
          { participantId: p('C'), basisPoints: 2000 },
        ],
      });
      assert.deepEqual(
        allocations.map((allocation) => allocation.amount.amountMinor),
        [5000, 3000, 2000],
      );
    });

    it('assigns rounding remainder by largest fractional remainder, deterministically', () => {
      // 1/3, 1/3, 1/3 of $1.00 → 34, 33, 33 with the extra cent to the first (tie-break by input order).
      const input = {
        method: 'PERCENTAGE',
        requiredAmount: money(100),
        shares: [
          { participantId: p('A'), basisPoints: 3334 },
          { participantId: p('B'), basisPoints: 3333 },
          { participantId: p('C'), basisPoints: 3333 },
        ],
      } as const;
      const allocations = computeSplit(input);
      assert.equal(total(allocations), 100);
      assert.deepEqual(computeSplit(input), allocations);
      assert.deepEqual(
        allocations.map((allocation) => allocation.amount.amountMinor),
        [34, 33, 33],
      );
    });

    it('sums to the required amount for adversarial share sets', () => {
      const shareSets = [
        [3333, 3333, 3334],
        [1, 9999],
        [2500, 2500, 2500, 2500],
        [1234, 8766],
        [10, 20, 30, 40, 9900],
      ];
      for (const set of shareSets) {
        for (const amount of [1, 99, 101, 12_345]) {
          const allocations = computeSplit({
            method: 'PERCENTAGE',
            requiredAmount: money(amount),
            shares: set.map((basisPoints, i) => ({ participantId: p(`P${i}`), basisPoints })),
          });
          assert.equal(total(allocations), amount, `${amount} over [${set.join(',')}]`);
        }
      }
    });

    it('rejects non-integer basis points', () => {
      assert.throws(
        () =>
          computeSplit({
            method: 'PERCENTAGE',
            requiredAmount: money(100),
            shares: [
              { participantId: p('A'), basisPoints: 5000.5 },
              { participantId: p('B'), basisPoints: 4999.5 },
            ],
          }),
        (error: unknown) => error instanceof DomainError && error.code === 'INVALID_SPLIT',
      );
    });
  });

  describe('session maximum and unsupported methods', () => {
    it('rejects an allocation above the per-participant session maximum', () => {
      assert.throws(
        () =>
          computeSplit(
            {
              method: 'CUSTOM_AMOUNT',
              requiredAmount: money(10_000),
              amounts: [
                { participantId: p('A'), amount: money(9_000) },
                { participantId: p('B'), amount: money(1_000) },
              ],
            },
            { perParticipantMaximum: money(5_000) },
          ),
        (error: unknown) => error instanceof DomainError && error.code === 'INVALID_SPLIT',
      );
    });

    it('rejects ITEMIZED_LATER during the validation phase', () => {
      assert.throws(
        () => computeSplit({ method: 'ITEMIZED_LATER' }),
        (error: unknown) =>
          error instanceof DomainError && error.code === 'UNSUPPORTED_SPLIT_METHOD',
      );
    });
  });
});
