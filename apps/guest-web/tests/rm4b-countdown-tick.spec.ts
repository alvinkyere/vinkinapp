// RM4B (D47): the pre-existing `countdownLabel(summary.submissionDeadline)` call in
// `JoinForm.tsx` was computed once, at initial render, with no periodic re-render — invisible
// at the pre-RM4A 24h granularity, a real, visibly frozen problem at RM4A's shortened
// (7-minute) window. This proves the fix (`useNow()`, a ticking hook) genuinely re-renders the
// countdown live, in the real browser, without a page reload — using Playwright's `page.clock`
// to fast-forward the BROWSER's own notion of time deterministically, rather than a real
// multi-minute wall-clock wait. The underlying `submissionDeadline` itself is real (RM4A's
// actual server-computed 7-minute value) — only the browser's perception of "now" is faked.

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

test('RM4B: the countdown label genuinely ticks live — from "Closes in 1 minute" to "under a minute" to gone — with no page reload', async ({
  page,
}) => {
  const stamp = Date.now();
  const organizerToken = await registerOrganizer(`rm4b_org_${stamp}`);
  const memberUsername = `rm4b_mem_${stamp}`;
  await registerOrganizer(memberUsername);

  const created = await (
    await api('/api/v1/vinks', {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        purchaseCategory: 'GROCERY',
        subtotalMinor: 6_000,
        tipMinor: 0,
        organizerDisplayName: 'RM4B Organizer',
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
  // RM4A (D47): the real, server-authoritative deadline is recomputed HERE, at open — a fixed
  // ~7 minutes out. Whatever was (or wasn't) sent at creation is irrelevant.
  const opened = await (
    await api(`/api/v1/vinks/${vinkId}/open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({}),
    })
  ).json();
  const deadline = new Date(opened.submissionDeadline as string);

  // Pause the BROWSER's clock 90 real seconds before the real deadline, before any navigation,
  // so the very first render already reflects a controlled, deterministic remaining time.
  await page.clock.install({ time: new Date(deadline.getTime() - 90_000) });
  await page.goto(`/join/${publicCode}`);

  await expect(page.getByText('Closes in 1 minute')).toBeVisible();

  // Advance 35s (55s now remain) — the interval tick itself must be what updates this; nothing
  // else on the page changes to force a re-render.
  await page.clock.fastForward(35_000);
  await expect(page.getByText('Closes in under a minute')).toBeVisible();
  await expect(page.getByText('Closes in 1 minute')).not.toBeVisible();

  // Advance past the real deadline entirely — the countdown row disappears (JoinForm renders
  // nothing for a null `countdownLabel`), still with no reload.
  await page.clock.fastForward(120_000);
  await expect(page.getByText('Closes in under a minute')).not.toBeVisible();
});
