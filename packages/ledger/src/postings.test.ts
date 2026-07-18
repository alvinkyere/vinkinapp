import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, money } from '../../domain/src/index.ts';
import {
  assertBalanced,
  contributionCapturePosting,
  contributionRefundPosting,
  sessionFundingPosting,
} from './postings.ts';
import { LEDGER_ACCOUNT_CODES } from './accounts.ts';

function totals(entries: ReadonlyArray<{ direction: string; amountMinor: number }>) {
  return entries.reduce(
    (acc, entry) => {
      if (entry.direction === 'DEBIT') acc.debits += entry.amountMinor;
      else acc.credits += entry.amountMinor;
      return acc;
    },
    { debits: 0, credits: 0 },
  );
}

describe('ledger postings (Plan §18)', () => {
  it('capture posting: DR processor_clearing / CR participant_contribution_liability', () => {
    const { entries } = contributionCapturePosting(money(4_000));
    assert.deepEqual(
      entries.map((entry) => [entry.account, entry.direction, entry.amountMinor]),
      [
        ['processor_clearing', 'DEBIT', 4000],
        ['participant_contribution_liability', 'CREDIT', 4000],
      ],
    );
  });

  it('funding posting: DR liability / CR session_funding_balance', () => {
    const { entries } = sessionFundingPosting(money(4_000));
    assert.deepEqual(
      entries.map((entry) => [entry.account, entry.direction]),
      [
        ['participant_contribution_liability', 'DEBIT'],
        ['session_funding_balance', 'CREDIT'],
      ],
    );
  });

  it('every builder produces balanced postings using known accounts', () => {
    for (const { entries } of [
      contributionCapturePosting(money(1)),
      sessionFundingPosting(money(123_45)),
      contributionRefundPosting(money(999)),
    ]) {
      const { debits, credits } = totals(entries);
      assert.equal(debits, credits);
      for (const entry of entries) {
        assert.ok((LEDGER_ACCOUNT_CODES as readonly string[]).includes(entry.account));
      }
    }
  });

  it('assertBalanced rejects unbalanced, empty, zero and non-integer postings', () => {
    const reject = (entries: Parameters<typeof assertBalanced>[0]) =>
      assert.throws(
        () => assertBalanced(entries),
        (error: unknown) => error instanceof DomainError && error.code === 'INVARIANT_VIOLATION',
      );
    reject([]);
    reject([
      { account: 'processor_clearing', direction: 'DEBIT', amountMinor: 100, entryType: 'x' },
      {
        account: 'participant_contribution_liability',
        direction: 'CREDIT',
        amountMinor: 99,
        entryType: 'x',
      },
    ]);
    reject([
      { account: 'processor_clearing', direction: 'DEBIT', amountMinor: 0, entryType: 'x' },
      {
        account: 'participant_contribution_liability',
        direction: 'CREDIT',
        amountMinor: 0,
        entryType: 'x',
      },
    ]);
    reject([
      { account: 'processor_clearing', direction: 'DEBIT', amountMinor: 10.5, entryType: 'x' },
      {
        account: 'participant_contribution_liability',
        direction: 'CREDIT',
        amountMinor: 10.5,
        entryType: 'x',
      },
    ]);
  });
});
