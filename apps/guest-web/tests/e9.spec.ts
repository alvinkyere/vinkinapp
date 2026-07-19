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
