// ENG3 Slice 5 ("server-rendered invite context," "immediate first render"): proves the
// anonymous-visitor invite context (organizer's purpose/amount) is genuinely present in the
// server-rendered HTML, not just "resolved quickly after hydration" — the canonical way to
// prove real SSR is disabling JavaScript entirely and confirming the content still renders,
// since nothing client-side (React, TanStack Query, hydration) can have run at all.
//
// This Server Component fetch (app/join/[publicCode]/page.tsx) happens on the Next.js SERVER
// process itself, not in the browser — Playwright's `page.route` only intercepts browser-side
// network calls, so this test needs the real local backend running (same requirement as
// e9.spec.ts), not a mocked fixture.

import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';

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

test('ENG3 Slice 5: the invite context renders in server HTML with JavaScript disabled', async ({
  browser,
}) => {
  const stamp = Date.now();
  const organizerToken = await registerOrganizer(`eng3_ssr_org_${stamp}`);
  const memberUsername = `eng3_ssr_mem_${stamp}`;
  await registerOrganizer(memberUsername);

  const created = await (
    await api('/api/v1/vinks', {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        purchaseCategory: 'GROCERY',
        subtotalMinor: 6_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'SSR Organizer',
      }),
    })
  ).json();
  const publicCode = created.vink.publicCode as string;

  // Open the Vink (DRAFT → OPEN) so the public join view is actually the full,
  // amount-bearing shape rather than the deliberately-withheld "not open yet" one (D23) —
  // this test is about proving SSR of real content, not exercising the D23 gate itself. Needs
  // a second participant first — `open` rejects an organizer-only Vink (INVALID_COMMAND).
  await api(`/api/v1/vinks/${created.vink.id}/participants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({ username: memberUsername }),
  });
  await api(`/api/v1/vinks/${created.vink.id}/split`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({ method: 'EQUAL' }),
  });
  await api(`/api/v1/vinks/${created.vink.id}/open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({}),
  });

  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`/join/${publicCode}`);

  // Real invite content, not a loading placeholder — and specifically NOT achievable without
  // genuine server rendering, since no client JS ran at all in this context.
  await expect(page.getByText('Grocery run')).toBeVisible();
  await expect(page.getByText('$60.00')).toBeVisible();
  await expect(page.getByText('Loading…')).not.toBeVisible();

  await context.close();
});
