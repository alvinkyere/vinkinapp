// Slice I3A — deterministic, browser-level proof of the three terminal states I3 left
// unverified live: return_pending, returned, recovery_required. Per the brief's own explicit
// instruction, these use controlled API interception + a seeded localStorage session rather
// than driving real refund/recovery workflows through the backend (no new financial
// machinery is built to manufacture these states — see the I3A milestone report for why:
// reaching them for real requires either a multi-participant partial-refund flow or the full
// recovery ladder, both disproportionate to build solely to prove client-side rendering).
// Must run against a build with NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI=1 baked in — see
// e9.spec.ts's own "I3 " tests for the two-build verification pattern this reuses.

import { test, expect, type Page } from '@playwright/test';
import type { GuestVinkView } from '../lib/types';

const PUBLIC_CODE = 'FIX00000';
const VINK_ID = 'fixture-vink-id';
const GUEST_TOKEN = 'vgt_fixture-token-not-a-real-secret';
const SUPPORT_URL_BAKED_IN = process.env.TEST_SUPPORT_URL_BAKED_IN === '1';

function baseView(overrides: {
  vinkState: string;
  vinkOutcome: GuestVinkView['vink']['vinkOutcome'];
  contributionStatus: GuestVinkView['participant']['contributionStatus'];
}): GuestVinkView {
  return {
    vink: {
      publicCode: PUBLIC_CODE,
      purchaseCategory: 'GROCERY',
      state: overrides.vinkState,
      requiredAmountMinor: 4_000,
      fundedAmountMinor: 4_000,
      submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
      participantCount: 2,
      joinable: false,
      contributionProgress: {
        confirmedAmountMinor: 4_000,
        totalAmountMinor: 4_000,
        confirmedParticipantCount: 2,
        totalParticipantCount: 2,
      },
      vinkOutcome: overrides.vinkOutcome,
    },
    participant: {
      id: 'fixture-participant-id',
      vinkId: VINK_ID,
      displayName: 'Fixture Guest',
      status: 'JOINED',
      allocatedAmountMinor: 4_000,
      maximumApprovedAmountMinor: 4_000,
      contributionStatus: overrides.contributionStatus,
    },
  };
}

/** Seeds the exact localStorage shape `lib/session-storage.ts` reads (before any page script
 * runs, so `JoinExperience` takes the "already has a session" branch on first render — no
 * join form, straight to `SessionView`), intercepts `GET /api/v1/guest/session` with the
 * fixture, and blocks the realtime WebSocket entirely (deterministic: no real backend
 * involved at all, matching the brief's own "controlled API interception" instruction). */
async function gotoWithFixture(page: Page, view: GuestVinkView): Promise<void> {
  await page.addInitScript(
    ({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)),
    {
      key: `vinkin.guest.${PUBLIC_CODE}`,
      session: { publicCode: PUBLIC_CODE, guestToken: GUEST_TOKEN, vinkId: VINK_ID },
    },
  );
  await page.route('**/api/v1/guest/session', (route) => route.fulfill({ json: view }));
  await page.routeWebSocket(/\/api\/v1\/vinks\/.*\/live/, (ws) => ws.close());
  await page.goto(`/join/${PUBLIC_CODE}`);
}

const FORBIDDEN_TERMS = [
  /provider/i,
  /recovery/i,
  /ledger/i,
  /shortfall/i,
  /RECOVERY_REQUIRED/,
  /RECOVERY_PENDING/,
  /FUNDING_REVERSAL/,
  /REFUND_PENDING/,
  /REFUNDED/,
  /state machine/i,
  /authorization/i,
  /capture/i,
];

async function assertNoForbiddenTerminology(page: Page): Promise<void> {
  const bodyText = (await page.locator('body').innerText()) ?? '';
  for (const term of FORBIDDEN_TERMS) {
    expect(bodyText, `body text must not match ${term}`).not.toMatch(term);
  }
}

async function assertNoContributionControls(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /Approve/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pay/i })).toHaveCount(0);
}

async function assertNoPromotionalContent(page: Page): Promise<void> {
  await expect(page.getByText('Liked splitting the bill this way?')).toHaveCount(0);
}

async function assertAccessibleHeadingOrder(page: Page, terminalMessage: string): Promise<void> {
  // Exactly one h1 ("Hi, {name}"), and the terminal message itself comes after it in actual
  // DOM order — never buried, never duplicated. Compares DOM position directly
  // (`compareDocumentPosition`) rather than pixel coordinates, which would false-positive
  // on same-row inline elements (e.g. a header badge sitting beside the h1).
  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText(/^Hi, /);
  const message = page.getByText(terminalMessage);
  await expect(message).toBeVisible();
  const order = await h1.evaluate((h1Node, text) => {
    const messageNode = Array.from(document.querySelectorAll('body *')).find(
      (el) => el.textContent?.trim() === text && el.children.length === 0,
    );
    if (messageNode === undefined) return null;
    // DOCUMENT_POSITION_FOLLOWING (4): h1 precedes the message node in the DOM.
    return Boolean(h1Node.compareDocumentPosition(messageNode) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, terminalMessage);
  expect(order).toBe(true);
}

test.describe('Slice I3A — guest terminal-state closure (deterministic, fixture-driven)', () => {
  test('return_pending: exact canonical copy, no controls, no promotion, no internal terms', async ({
    page,
  }) => {
    await gotoWithFixture(
      page,
      baseView({
        vinkState: 'FUNDING_REVERSAL',
        vinkOutcome: 'expired',
        contributionStatus: 'return_pending',
      }),
    );

    await expect(page.getByText('Your payment is being returned.')).toBeVisible();
    await assertNoContributionControls(page);
    await assertNoPromotionalContent(page);
    await assertNoForbiddenTerminology(page);
    await assertAccessibleHeadingOrder(page, 'Your payment is being returned.');
  });

  test('returned: exact canonical copy, no controls, no promotion, no internal terms', async ({
    page,
  }) => {
    await gotoWithFixture(
      page,
      baseView({ vinkState: 'EXPIRED', vinkOutcome: 'expired', contributionStatus: 'returned' }),
    );

    await expect(page.getByText('Your payment was returned.')).toBeVisible();
    await assertNoContributionControls(page);
    await assertNoPromotionalContent(page);
    await assertNoForbiddenTerminology(page);
    await assertAccessibleHeadingOrder(page, 'Your payment was returned.');
  });

  test('recovery_required: exact canonical copy, no controls, no promotion, no internal terms', async ({
    page,
  }) => {
    await gotoWithFixture(
      page,
      baseView({
        vinkState: 'RECOVERY_REQUIRED',
        vinkOutcome: 'recovery_required',
        contributionStatus: 'recovery_required',
      }),
    );

    const canonicalSentence = "We're resolving your payment. You don't need to pay again.";
    await expect(page.getByText(canonicalSentence)).toBeVisible();
    await assertNoContributionControls(page);
    await assertNoPromotionalContent(page);
    await assertNoForbiddenTerminology(page);
    await assertAccessibleHeadingOrder(page, canonicalSentence);
    // recovery_required's own additional constraint: no status badge either (its raw-state
    // label, "Resolving a shortfall," is organizer-facing recovery language) — checked via
    // "shortfall" specifically, since the canonical sentence itself legitimately contains
    // the word "resolving" and would false-positive on a broader match.
    await expect(page.getByText(/shortfall/i)).toHaveCount(0);
  });

  test('recovery_required: no support link when no support channel is configured (default)', async ({
    page,
  }) => {
    test.skip(
      SUPPORT_URL_BAKED_IN,
      'this run\'s build has NEXT_PUBLIC_SUPPORT_CONTACT_URL set — see the paired "appears when configured" test',
    );
    await gotoWithFixture(
      page,
      baseView({
        vinkState: 'RECOVERY_REQUIRED',
        vinkOutcome: 'recovery_required',
        contributionStatus: 'recovery_required',
      }),
    );
    await expect(page.getByRole('link', { name: 'Contact support' })).toHaveCount(0);
  });

  // Two-build pair (mirrors e9.spec.ts's own I3 flag-on/flag-off verification pattern):
  // `NEXT_PUBLIC_SUPPORT_CONTACT_URL` is a build-time constant, so proving both the
  // "withheld by default" and "shown once configured" branches genuinely render requires two
  // separate builds. `TEST_SUPPORT_URL_BAKED_IN` is a test-only signal (never baked into the
  // app itself) telling this file which build it's currently running against.
  test('recovery_required: support link appears once a real support channel IS configured', async ({
    page,
  }) => {
    test.skip(
      !SUPPORT_URL_BAKED_IN,
      'run against a build with NEXT_PUBLIC_SUPPORT_CONTACT_URL set',
    );
    await gotoWithFixture(
      page,
      baseView({
        vinkState: 'RECOVERY_REQUIRED',
        vinkOutcome: 'recovery_required',
        contributionStatus: 'recovery_required',
      }),
    );
    const link = page.getByRole('link', { name: 'Contact support' });
    await expect(link).toBeVisible();
    // .invalid is an IANA-reserved test TLD, guaranteed never to resolve — a placeholder for
    // proving the code path works, never a real destination (Phase 6 §21's own rule).
    await expect(link).toHaveAttribute('href', 'https://support.example.invalid/contact');
  });
});
