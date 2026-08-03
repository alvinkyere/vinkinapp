// PV10 exit-gate proof: "A guest completes E9 on a mobile browser without installing the
// app" (master plan). Runs a real production build of apps/guest-web (see
// playwright.config.ts for why not `next dev`) at a real mobile viewport (iPhone 13),
// against the REAL local backend (Postgres + Redis + apps/api/src/server.ts) — no mocks.
// Only the guest's own actions (join, approve their contribution) go through this app's UI;
// setting up the vink and re-splitting to include the guest are the ORGANIZER's own app's
// scope (PV9, Flutter) and are driven directly against the API here, exactly as PV9's own
// e1_test.dart drives participant/merchant actions outside the organizer app's UI.

import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';

interface Participant {
  id: string;
  role: string;
  displayName: string;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

async function registerUser(username: string): Promise<string> {
  const response = await api('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, displayName: username, password: 'integration-password-1' }),
  });
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

test('E9: a guest joins and funds their share entirely from a mobile browser, no app install', async ({
  page,
}) => {
  const stamp = Date.now();
  const organizerToken = await registerUser(`pv10_org_${stamp}`);
  const memberUsername = `pv10_mem_${stamp}`;
  await registerUser(memberUsername);

  // --- Organizer app's own scope (PV9), driven directly — same split as PV9's E1 test ---
  const created = await (
    await api('/api/v1/vinks', {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        purchaseCategory: 'GROCERY',
        subtotalMinor: 6_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'PV10 Organizer',
      }),
    })
  ).json();
  const vinkId = created.vink.id as string;
  const publicCode = created.vink.publicCode as string;

  await api(`/api/v1/vinks/${vinkId}/participants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({ username: memberUsername }),
  });
  await api(`/api/v1/vinks/${vinkId}/split`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({ method: 'EQUAL' }),
  });
  await api(`/api/v1/vinks/${vinkId}/open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({}),
  });

  // --- Everything from here is the guest, entirely through the mobile browser UI ---
  await page.goto(`/join/${publicCode}`);
  await expect(page.locator('h1')).toHaveText('Grocery run');
  await expect(page.getByText('$60.00')).toBeVisible();
  await page.screenshot({ path: 'test-results/e9-01-prejoin.png' });

  await page.getByLabel('Your name').fill('E9 Guest');
  await page.getByRole('button', { name: 'Join this Vink' }).click();
  await expect(page.getByText('Hi, E9 Guest')).toBeVisible();
  await expect(page.getByText("The organizer hasn't assigned you a share yet.")).toBeVisible();
  await page.screenshot({ path: 'test-results/e9-02-joined-zero-share.png' });

  // Organizer re-splits to include the guest (their own app's scope) — the guest's
  // already-open live session must pick this up on its own, no reload (PV10's realtime fix).
  const snapshot = await (
    await api(`/api/v1/vinks/${vinkId}`, { headers: { authorization: `Bearer ${organizerToken}` } })
  ).json();
  const participants = snapshot.participants as Participant[];
  const guest = participants.find((p) => p.displayName === 'E9 Guest')!;
  const organizer = participants.find((p) => p.role === 'ORGANIZER')!;
  const member = participants.find((p) => p.role === 'MEMBER' && p.id !== guest.id)!;

  const resplit = await api(`/api/v1/vinks/${vinkId}/split`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({
      method: 'CUSTOM_AMOUNT',
      amounts: [
        { participantId: organizer.id, amountMinor: 0 },
        { participantId: member.id, amountMinor: 0 },
        { participantId: guest.id, amountMinor: 6_000 },
      ],
    }),
  });
  expect(resplit.status).toBe(200);

  await expect(page.getByRole('button', { name: 'Approve $60.00' })).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({ path: 'test-results/e9-03-live-share-update.png' });

  await page.getByRole('button', { name: 'Approve $60.00' }).click();
  await expect(page.getByText("You're in — your share is approved.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('$60.00 of $60.00 funded')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'test-results/e9-04-funded-live.png' });

  // The "optional signup conversion" deliverable — informational, dismissible, never a
  // functional requirement to keep using the guest link (no account created anywhere here).
  await expect(page.getByText('Liked splitting the bill this way?')).toBeVisible();
});

// ---------------------------------------------------------------------------------------
// Slice I3 (docs/design/phase-10-implementation-readiness.md) — D23/D24/D25/D34 correctness.
// These tests only assert the FLAG-ON composition and must be run against a build with
// NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI=1 baked in (a separate build from the one the E9
// test above runs against, which is deliberately the default flag-off build — see the I3
// milestone report for exactly how both builds were verified). Prefixed "I3:" so they can be
// selected with `--grep`/excluded with `--grep-invert` independently of the E9 test above.
// ---------------------------------------------------------------------------------------

interface CreatedVink {
  organizerToken: string;
  vinkId: string;
  publicCode: string;
}

async function createDraftVink(
  stamp: number,
  suffix: string,
  subtotalMinor: number,
  deadlineMs: number,
): Promise<CreatedVink> {
  const organizerToken = await registerUser(`i3_${suffix}_org_${stamp}`);
  const created = await (
    await api('/api/v1/vinks', {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        purchaseCategory: 'GROCERY',
        subtotalMinor,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + deadlineMs).toISOString(),
        organizerDisplayName: 'I3 Organizer',
      }),
    })
  ).json();
  const vinkId = created.vink.id as string;
  // openVinkCommand requires at least one participant besides the organizer — a registered
  // member, exactly like the E9 test's own setup (the guest joins separately, afterward).
  const memberUsername = `i3_${suffix}_mem_${stamp}`;
  await registerUser(memberUsername);
  await api(`/api/v1/vinks/${vinkId}/participants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({ username: memberUsername }),
  });
  return { organizerToken, vinkId, publicCode: created.vink.publicCode as string };
}

/** EQUAL split between organizer and member, then open — the same minimal precondition
 * `openVinkCommand` needs (at least one non-organizer participant, fully allocated). The
 * guest (once they join) starts at $0 and is reallocated the full amount afterward via
 * `reallocateFullShareToGuest`, exactly the E9 test's own established pattern (a guest is
 * never allocated anything before joining). */
async function openWithEqualSplit(vink: CreatedVink): Promise<void> {
  await api(`/api/v1/vinks/${vink.vinkId}/split`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${vink.organizerToken}` },
    body: JSON.stringify({ method: 'EQUAL' }),
  });
  await api(`/api/v1/vinks/${vink.vinkId}/open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${vink.organizerToken}` },
    body: JSON.stringify({}),
  });
}

async function reallocateFullShareToGuest(
  vink: CreatedVink,
  guestDisplayName: string,
  amountMinor: number,
): Promise<void> {
  const snapshot = await (
    await api(`/api/v1/vinks/${vink.vinkId}`, {
      headers: { authorization: `Bearer ${vink.organizerToken}` },
    })
  ).json();
  const participants = snapshot.participants as Participant[];
  const guest = participants.find((p) => p.displayName === guestDisplayName)!;
  const others = participants.filter((p) => p.id !== guest.id);
  const resplit = await api(`/api/v1/vinks/${vink.vinkId}/split`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${vink.organizerToken}` },
    body: JSON.stringify({
      method: 'CUSTOM_AMOUNT',
      amounts: [
        ...others.map((p) => ({ participantId: p.id, amountMinor: 0 })),
        { participantId: guest.id, amountMinor },
      ],
    }),
  });
  expect(resplit.status).toBe(200);
}

test("I3 D23: a link to a not-yet-opened Vink shows 'Not open yet' — never the amount, split, or 'Draft'", async ({
  page,
}) => {
  const stamp = Date.now();
  const vink = await createDraftVink(stamp, 'preopen', 4_000, 3_600_000);
  // Deliberately left in DRAFT — never opened.

  await page.goto(`/join/${vink.publicCode}`);
  await expect(page.getByRole('heading', { name: 'Not open yet' })).toBeVisible();
  await expect(page.getByText('Check back soon.')).toBeVisible();
  await expect(page.getByText('Draft')).not.toBeVisible();
  await expect(page.getByText('$40.00')).not.toBeVisible();
});

test('I3 reload-safety: a confirmed contribution survives reload — the action never re-offers itself', async ({
  page,
}) => {
  const stamp = Date.now();
  const vink = await createDraftVink(stamp, 'reload', 5_000, 3_600_000);
  await openWithEqualSplit(vink);

  await page.goto(`/join/${vink.publicCode}`);
  await page.getByLabel('Your name').fill('Reload Guest');
  await page.getByRole('button', { name: 'Join this Vink' }).click();
  await expect(page.getByText('Hi, Reload Guest')).toBeVisible();

  await reallocateFullShareToGuest(vink, 'Reload Guest', 5_000);
  await expect(page.getByRole('button', { name: 'Approve $50.00' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Approve $50.00' }).click();
  await expect(page.getByText("You're in.")).toBeVisible({ timeout: 10_000 });

  // The actual regression proof: reload wipes any local component state (`hasAuthorized`
  // no longer exists on this path at all) — the confirmed status must come back from the
  // server, and the pay button must never reappear.
  await page.reload();
  await expect(page.getByText("You're in.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Approve \$/ })).not.toBeVisible();
});

test('I3 D25 completed: a fully settled Vink shows the exact D34 completed sentence', async ({
  page,
}) => {
  const stamp = Date.now();
  const vink = await createDraftVink(stamp, 'completed', 3_000, 3_600_000);
  await openWithEqualSplit(vink);

  await page.goto(`/join/${vink.publicCode}`);
  await page.getByLabel('Your name').fill('Completed Guest');
  await page.getByRole('button', { name: 'Join this Vink' }).click();
  await expect(page.getByText('Hi, Completed Guest')).toBeVisible();
  await reallocateFullShareToGuest(vink, 'Completed Guest', 3_000);
  await expect(page.getByRole('button', { name: 'Approve $30.00' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Approve $30.00' }).click();
  await expect(page.getByText("You're in.")).toBeVisible({ timeout: 10_000 });

  const cardResponse = await api(`/internal/simulator/vinks/${vink.vinkId}/provision-card`, {
    method: 'POST',
    headers: { authorization: `Bearer ${vink.organizerToken}` },
    body: JSON.stringify({}),
  });
  expect(cardResponse.status).toBe(201);
  const authResponse = await api(
    `/internal/simulator/vinks/${vink.vinkId}/merchant-authorizations`,
    {
      method: 'POST',
      body: JSON.stringify({ amountMinor: 3_000 }),
    },
  );
  const auth = (await authResponse.json()) as { authorizationId: string };
  expect(authResponse.status).toBe(201);
  const captureResponse = await api(
    `/internal/simulator/authorizations/${auth.authorizationId}/capture`,
    {
      method: 'POST',
      body: JSON.stringify({ vinkId: vink.vinkId, settledAmountMinor: 3_000 }),
    },
  );
  expect(captureResponse.status).toBe(200);
  expect((await captureResponse.json()).vinkState).toBe('COMPLETED');

  await expect(page.getByText('Payment complete. Your part helped pay Grocery run.')).toBeVisible({
    timeout: 15_000,
  });
});

test('I3 D25 cancelled: an organizer cancellation shows the exact D34 cancelled sentence', async ({
  page,
}) => {
  const stamp = Date.now();
  const vink = await createDraftVink(stamp, 'cancelled', 4_000, 3_600_000);
  await openWithEqualSplit(vink);

  await page.goto(`/join/${vink.publicCode}`);
  await page.getByLabel('Your name').fill('Cancelled Guest');
  await page.getByRole('button', { name: 'Join this Vink' }).click();
  await expect(page.getByText('Hi, Cancelled Guest')).toBeVisible();

  const cancelResponse = await api(`/api/v1/vinks/${vink.vinkId}/cancel`, {
    method: 'POST',
    headers: { authorization: `Bearer ${vink.organizerToken}` },
    body: JSON.stringify({}),
  });
  expect(cancelResponse.status).toBe(200);

  await expect(page.getByText("The organizer cancelled. You weren't charged.")).toBeVisible({
    timeout: 15_000,
  });
});

test('I3 D25 expired: a Vink that closes before this guest pays shows the exact D34 expired sentence', async ({
  page,
}) => {
  // Real wall-clock wait: OPEN -deadline-> SUBMISSIONS_CLOSED -PROCESSING_GRACE(60s default)->
  // FUNDING_FAILED -> FUNDING_REVERSAL -> EXPIRED. No mocked clock exists here (Guest Web
  // has none), so this genuinely waits out the full cycle — matching this codebase's own
  // established pattern for deadline-dependent integration tests, not a shortcut.
  test.setTimeout(150_000);
  const stamp = Date.now();
  const vink = await createDraftVink(stamp, 'expired', 4_000, 5_000);
  await openWithEqualSplit(vink);

  await page.goto(`/join/${vink.publicCode}`);
  await page.getByLabel('Your name').fill('Expired Guest');
  await page.getByRole('button', { name: 'Join this Vink' }).click();
  await expect(page.getByText('Hi, Expired Guest')).toBeVisible();
  // Deliberately never approves a contribution — the deadline passes with this guest
  // still unpaid, which is exactly the FUNDING_FAILED -> FUNDING_REVERSAL -> EXPIRED path.

  await expect(page.getByText("You weren't charged.")).toBeVisible({ timeout: 120_000 });
});
