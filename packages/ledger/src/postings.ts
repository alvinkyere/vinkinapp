import { DomainError, type Money } from '../../domain/src/index.ts';
import type { LedgerAccountCode } from './accounts.ts';

export type EntryDirection = 'DEBIT' | 'CREDIT';

export interface LedgerEntryInput {
  account: LedgerAccountCode;
  direction: EntryDirection;
  amountMinor: number;
  entryType: string;
}

export interface LedgerPosting {
  entries: LedgerEntryInput[];
}

/** Total debits must equal total credits and every amount must be a positive integer. */
export function assertBalanced(entries: readonly LedgerEntryInput[]): void {
  if (entries.length === 0) {
    throw new DomainError('INVARIANT_VIOLATION', 'a ledger posting cannot be empty');
  }
  let debits = 0;
  let credits = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0) {
      throw new DomainError(
        'INVARIANT_VIOLATION',
        `ledger amounts must be positive integers, got ${entry.amountMinor}`,
      );
    }
    if (entry.direction === 'DEBIT') debits += entry.amountMinor;
    else credits += entry.amountMinor;
  }
  if (debits !== credits) {
    throw new DomainError(
      'INVARIANT_VIOLATION',
      `unbalanced posting: debits ${debits} != credits ${credits}`,
    );
  }
}

function posting(entries: LedgerEntryInput[]): LedgerPosting {
  assertBalanced(entries);
  return { entries };
}

/** Plan §18 "contribution capture": DR processor_clearing / CR participant_contribution_liability. */
export function contributionCapturePosting(amount: Money): LedgerPosting {
  return posting([
    {
      account: 'processor_clearing',
      direction: 'DEBIT',
      amountMinor: amount.amountMinor,
      entryType: 'contribution_capture',
    },
    {
      account: 'participant_contribution_liability',
      direction: 'CREDIT',
      amountMinor: amount.amountMinor,
      entryType: 'contribution_capture',
    },
  ]);
}

/** Plan §18 "move funds into session funding": DR liability / CR session_funding_balance. */
export function sessionFundingPosting(amount: Money): LedgerPosting {
  return posting([
    {
      account: 'participant_contribution_liability',
      direction: 'DEBIT',
      amountMinor: amount.amountMinor,
      entryType: 'session_funding',
    },
    {
      account: 'session_funding_balance',
      direction: 'CREDIT',
      amountMinor: amount.amountMinor,
      entryType: 'session_funding',
    },
  ]);
}

/**
 * Failed-session refund of a captured contribution: reverse the funding move and the
 * capture in one balanced posting (corrections are reversals — never edits).
 */
export function contributionRefundPosting(amount: Money): LedgerPosting {
  return posting([
    {
      account: 'session_funding_balance',
      direction: 'DEBIT',
      amountMinor: amount.amountMinor,
      entryType: 'contribution_refund',
    },
    {
      account: 'participant_contribution_liability',
      direction: 'CREDIT',
      amountMinor: amount.amountMinor,
      entryType: 'contribution_refund',
    },
    {
      account: 'participant_contribution_liability',
      direction: 'DEBIT',
      amountMinor: amount.amountMinor,
      entryType: 'contribution_refund',
    },
    {
      account: 'processor_clearing',
      direction: 'CREDIT',
      amountMinor: amount.amountMinor,
      entryType: 'contribution_refund',
    },
  ]);
}
