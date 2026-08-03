// ENG3 Slice 5 ("expired and revoked token handling"): the audit found a real inconsistency
// — a guest whose token expires/is revoked *during initial redemption* (`/g/:token`) already
// sees a clear message (`app/g/[token]/page.tsx`), but a *returning* guest whose already-
// stored token later expires silently fell through to a bare join form with no explanation at
// all. This proves the fix: the exact same `GUEST_UNAUTHENTICATED` copy now appears on this
// path too.
//
// The public-view fetch (`app/join/[publicCode]/page.tsx`'s own Server Component fetch) goes
// to the real local backend — Playwright's `page.route` only intercepts browser-side network
// calls, not the Next.js server process's own outbound fetch — so this still needs a real
// Vink to exist. Only the guest's own stale-session check (`GET /api/v1/guest/session`, a
// browser-side call) is mocked, since that's the one piece this test is actually about.

import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const GUEST_TOKEN = 'vgt_expired-fixture-token-not-real';

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

async function registerOrganizer(username: string): Promise<string> {
  const response = await api('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, displayName: username, password: 'integration-password-1' }),
  });
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

test('a returning guest with an expired/invalid stored token sees the same explanation the initial-redemption path already shows, not a bare join form', async ({
  page,
}) => {
  const stamp = Date.now();
  const organizerToken = await registerOrganizer(`eng3_expired_org_${stamp}`);
  const memberUsername = `eng3_expired_mem_${stamp}`;
  await registerOrganizer(memberUsername);

  const created = await (
    await api('/api/v1/vinks', {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        purchaseCategory: 'GROCERY',
        subtotalMinor: 4_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Expired-Token Organizer',
      }),
    })
  ).json();
  const publicCode = created.vink.publicCode as string;
  const vinkId = created.vink.id as string;

  // Needs a second participant first — `open` rejects an organizer-only Vink.
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

  await page.addInitScript(
    ({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)),
    {
      key: `vinkin.guest.${publicCode}`,
      session: { publicCode, guestToken: GUEST_TOKEN, vinkId },
    },
  );
  await page.route('**/api/v1/guest/session', (route) =>
    route.fulfill({ status: 401, json: { error: 'GUEST_UNAUTHENTICATED' } }),
  );

  await page.goto(`/join/${publicCode}`);

  await expect(
    page.getByText('Your session expired. Open the link again to continue.'),
  ).toBeVisible();
  // The join form is still reachable right alongside the notice — never a dead end.
  await expect(page.getByLabel('Your name')).toBeVisible();
});
