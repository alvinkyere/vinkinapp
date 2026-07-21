// Slice I3's own required test type ("Unit tests: copy-mapping function — state -> exact
// D25/D34 phrase"). Guest Web has no separate unit-test runner (its only test tool is
// Playwright — see playwright.config.ts / e9.spec.ts), so this runs as a pure-logic
// Playwright test: no `page` fixture, no browser interaction, just the exported functions
// under the project's own module resolution (avoids the Node-native-ESM-vs-Next-bundler
// extension mismatch a standalone `node --test` file would hit).

import { test, expect } from '@playwright/test';
import {
  contributionStatusSentence,
  contributionStatusWord,
  countdownLabel,
  guestTerminalSentence,
  terminalOutcomeSentence,
} from '../lib/guest-copy';
import type { GuestContributionStatus, GuestVinkOutcome } from '../lib/types';

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

test.describe('contributionStatusWord (Phase 6 §10 — exhaustive)', () => {
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
    test(`${status} -> "${expected[status]}"`, () => {
      expect(contributionStatusWord(status)).toBe(expected[status]);
    });
  }
});

test.describe('contributionStatusSentence (Phase 6 §10 — exhaustive)', () => {
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
    test(`${status} -> "${expected[status]}"`, () => {
      expect(contributionStatusSentence(status, '$10.00')).toBe(expected[status]);
    });
  }
});

test.describe('terminalOutcomeSentence (Phase 6 §18, D34, D37 — exhaustive)', () => {
  const expected: Record<GuestVinkOutcome, string | null> = {
    not_open_yet: null,
    open: null,
    completed: 'Payment complete. Your part helped pay Grocery run.',
    expired: "You weren't charged.",
    cancelled: "The organizer cancelled. You weren't charged.",
    return_pending: 'Your payment is being returned.',
    returned: 'Your payment was returned.',
    // D37 (2026-07-21, Slice I3A): corrects §16/§18's original "organizer-only" annotation —
    // this canonical sentence is now shown to the guest too.
    recovery_required: "We're resolving your payment. You don't need to pay again.",
  };
  for (const outcome of ALL_VINK_OUTCOMES) {
    test(`${outcome} -> ${JSON.stringify(expected[outcome])}`, () => {
      expect(terminalOutcomeSentence(outcome, 'GROCERY')).toBe(expected[outcome]);
    });
  }
});

test.describe('guestTerminalSentence (Slice I3A — contributionStatus priority over vinkOutcome)', () => {
  test("a guest's own return_pending wins even when the vink-level outcome reads 'expired'", () => {
    // The real reachable combination: a captured contribution being refunded while the vink
    // itself is in FUNDING_REVERSAL/EXPIRED overall — "You weren't charged" would be wrong.
    expect(guestTerminalSentence('return_pending', 'expired', 'GROCERY')).toBe(
      'Your payment is being returned.',
    );
  });

  test("a guest's own returned status wins even when the vink-level outcome reads 'expired'", () => {
    expect(guestTerminalSentence('returned', 'expired', 'GROCERY')).toBe(
      'Your payment was returned.',
    );
  });

  test('recovery_required wins regardless of the vink-level outcome value passed', () => {
    expect(guestTerminalSentence('recovery_required', 'open', 'GROCERY')).toBe(
      "We're resolving your payment. You don't need to pay again.",
    );
  });

  test('falls back to the vink-level sentence for every other contributionStatus', () => {
    expect(guestTerminalSentence('confirmed', 'completed', 'GROCERY')).toBe(
      'Payment complete. Your part helped pay Grocery run.',
    );
    expect(guestTerminalSentence('not_started', 'cancelled', 'GROCERY')).toBe(
      "The organizer cancelled. You weren't charged.",
    );
    expect(guestTerminalSentence('not_started', 'open', 'GROCERY')).toBe(null);
  });
});

test.describe('countdownLabel (Phase 6 §13)', () => {
  const now = new Date('2026-07-21T10:00:00Z');

  test('more than a minute remaining rounds down to the minute', () => {
    const deadline = new Date(now.getTime() + 4 * 60_000 + 30_000).toISOString();
    expect(countdownLabel(deadline, now)).toBe('Closes in 4 minutes');
  });

  test('exactly one minute remaining uses the singular', () => {
    const deadline = new Date(now.getTime() + 60_000).toISOString();
    expect(countdownLabel(deadline, now)).toBe('Closes in 1 minute');
  });

  test('under a minute remaining', () => {
    const deadline = new Date(now.getTime() + 30_000).toISOString();
    expect(countdownLabel(deadline, now)).toBe('Closes in under a minute');
  });

  test('already past the deadline returns null — never a negative countdown', () => {
    const deadline = new Date(now.getTime() - 1_000).toISOString();
    expect(countdownLabel(deadline, now)).toBe(null);
  });
});
