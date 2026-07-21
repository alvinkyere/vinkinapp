// Zero-dependency, Node-native test (matches the backend's own convention — `node --test`,
// no extra runner) — Guest Web has no other unit-test layer (its only other test tool is
// Playwright; see tests/e9.spec.ts). Run: `node --experimental-strip-types --test
// apps/guest-web/lib/guest-copy.test.ts`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contributionStatusSentence,
  contributionStatusWord,
  countdownLabel,
  terminalOutcomeSentence,
} from './guest-copy.ts';
import type { GuestContributionStatus, GuestVinkOutcome } from './types.ts';

const ALL_CONTRIBUTION_STATUSES: GuestContributionStatus[] = [
  'not_started',
  'processing',
  'confirmed',
  'declined_retryable',
  'declined_final',
  'return_pending',
  'returned',
  'recovery_required',
];

const ALL_VINK_OUTCOMES: GuestVinkOutcome[] = [
  'not_open_yet',
  'open',
  'completed',
  'expired',
  'cancelled',
  'return_pending',
  'returned',
  'recovery_required',
];

describe('contributionStatusWord (Phase 6 §10 — exhaustive)', () => {
  const expected: Record<GuestContributionStatus, string> = {
    not_started: 'Waiting',
    processing: 'Processing',
    confirmed: 'Paid',
    declined_retryable: 'Needs another try',
    declined_final: 'Not charged',
    return_pending: 'Being returned',
    returned: 'Returned',
    recovery_required: 'Paid', // §18 continuity rule — never a distinct word
  };
  for (const status of ALL_CONTRIBUTION_STATUSES) {
    it(`${status} -> "${expected[status]}"`, () => {
      assert.equal(contributionStatusWord(status), expected[status]);
    });
  }
});

describe('contributionStatusSentence (Phase 6 §10 — exhaustive)', () => {
  const expected: Record<GuestContributionStatus, string> = {
    not_started: 'Your part is $10.00.',
    processing: "We're confirming your payment.",
    confirmed: "You're in.",
    declined_retryable: "That didn't go through. Nothing was charged.",
    declined_final: 'Nothing was charged.',
    return_pending: 'Your payment is being returned.',
    returned: 'Your payment was returned.',
    recovery_required: "You're in.", // §18 continuity rule — never re-described
  };
  for (const status of ALL_CONTRIBUTION_STATUSES) {
    it(`${status} -> "${expected[status]}"`, () => {
      assert.equal(contributionStatusSentence(status, '$10.00'), expected[status]);
    });
  }
});

describe('terminalOutcomeSentence (Phase 6 §18, D34 — exhaustive)', () => {
  const expected: Record<GuestVinkOutcome, string | null> = {
    not_open_yet: null,
    open: null,
    completed: 'Payment complete. Your part helped pay Grocery run.',
    expired: "You weren't charged.",
    cancelled: "The organizer cancelled. You weren't charged.",
    return_pending: 'Your payment is being returned.',
    returned: 'Your payment was returned.',
    // §18: this sentence is organizer-only; a guest's own view stays whatever
    // contributionStatusSentence already says (never a distinct terminal sentence here).
    recovery_required: null,
  };
  for (const outcome of ALL_VINK_OUTCOMES) {
    it(`${outcome} -> ${JSON.stringify(expected[outcome])}`, () => {
      assert.equal(terminalOutcomeSentence(outcome, 'GROCERY'), expected[outcome]);
    });
  }

  it('D34: the individual no-charge phrase is byte-identical for expired and (independently) matches the guest/member/organizer-shared wording', () => {
    // D34's own locked rule: "You weren't charged" is never softened for guests — this
    // guards against a future edit accidentally diverging the two call sites.
    assert.equal(terminalOutcomeSentence('expired', 'GROCERY'), "You weren't charged.");
  });
});

describe('countdownLabel (Phase 6 §13)', () => {
  const now = new Date('2026-07-21T10:00:00Z');

  it('more than a minute remaining rounds down to the minute', () => {
    const deadline = new Date(now.getTime() + 4 * 60_000 + 30_000).toISOString();
    assert.equal(countdownLabel(deadline, now), 'Closes in 4 minutes');
  });

  it('exactly one minute remaining uses the singular', () => {
    const deadline = new Date(now.getTime() + 60_000).toISOString();
    assert.equal(countdownLabel(deadline, now), 'Closes in 1 minute');
  });

  it('under a minute remaining', () => {
    const deadline = new Date(now.getTime() + 30_000).toISOString();
    assert.equal(countdownLabel(deadline, now), 'Closes in under a minute');
  });

  it('already past the deadline returns null — never a negative countdown', () => {
    const deadline = new Date(now.getTime() - 1_000).toISOString();
    assert.equal(countdownLabel(deadline, now), null);
  });
});
