// Official VinkIn product screenshot capture for the guest experience (website use). Runs a
// real production build of apps/guest-web (see playwright.config.ts for why not `next dev`)
// at the iPhone 16 Pro viewport — matched to the organizer app's own screenshot device
// (integration_test/screenshot_test.dart) — against the REAL local backend. Drives the same
// deterministic showcase Vink shape (Alvin organizer, Ama + Jordan existing members, Nana a
// guest, $120 / 4 = $30.00 each) through Nana's own real journey: redeem her invite link,
// approve her share, watch the group fund live — never a staged screen.

import { test, devices } from '@playwright/test';
import path from 'node:path';

test.use({ ...devices['iPhone 16 Pro'], browserName: 'chromium' });

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT_DIR = path.resolve(__dirname, '../../../artifacts/product-screenshots/raw');

interface RegisterResponse {
  accessToken: string;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

async function registerUser(username: string, displayName: string): Promise<string> {
  const response = await api('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, displayName, password: 'showcase-password-1' }),
  });
  const body = (await response.json()) as RegisterResponse;
  return body.accessToken;
}

test('capture the guest-web product screenshots (10-13)', async ({ page }) => {
  const stamp = Date.now();

  // --- Build the same showcase Vink shape as the organizer screenshots -------------
  const alvinToken = await registerUser(`alvin_web_${stamp}`, 'Alvin');
  const amaToken = await registerUser(`amak_web_${stamp}`, 'Ama');
  const jordanToken = await registerUser(`jordank_web_${stamp}`, 'Jordan');

  const created = await (
    await api('/api/v1/vinks', {
      method: 'POST',
      headers: { authorization: `Bearer ${alvinToken}` },
      body: JSON.stringify({
        purchaseCategory: 'GROCERY',
        subtotalMinor: 12_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Alvin',
      }),
    })
  ).json();
  const vinkId = created.vink.id as string;
  const publicCode = created.vink.publicCode as string;

  await api(`/api/v1/vinks/${vinkId}/participants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alvinToken}` },
    body: JSON.stringify({ username: `amak_web_${stamp}` }),
  });
  await api(`/api/v1/vinks/${vinkId}/participants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alvinToken}` },
    body: JSON.stringify({ username: `jordank_web_${stamp}` }),
  });
  const guestInvite = await (
    await api(`/api/v1/vinks/${vinkId}/guests`, {
      method: 'POST',
      headers: { authorization: `Bearer ${alvinToken}` },
      body: JSON.stringify({ displayName: 'Nana' }),
    })
  ).json();
  const guestToken = guestInvite.guestToken as string;

  await api(`/api/v1/vinks/${vinkId}/split`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${alvinToken}` },
    body: JSON.stringify({ method: 'EQUAL' }),
  });
  await api(`/api/v1/vinks/${vinkId}/open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alvinToken}` },
    body: JSON.stringify({}),
  });

  // --- Nana redeems her real invite link — no account, entirely through the browser -
  await page.goto(`/g/${guestToken}`);
  await page.waitForURL(`**/join/${publicCode}`);
  await page.getByText('Hi, Nana').waitFor();
  await page.waitForTimeout(500); // let the entrance layout settle before capturing

  await page.screenshot({ path: path.join(OUT_DIR, '10-guest-join.png') });
  // The real product shows "view the invitation" and "approve the share" on the SAME
  // screen (no separate confirmation step) — 10 and 11 are deliberately the same real
  // screen, not a capture gap; see milestone-reports/PV13-SCREENSHOTS.md.
  await page.screenshot({ path: path.join(OUT_DIR, '11-guest-contribution.png') });

  // --- Nana approves her own share — the real action, through the real UI -----------
  await page.getByRole('button', { name: 'Approve $30.00' }).click();
  await page.getByText("You're in — your share is approved.").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, '12-guest-live-progress.png') });

  // --- Alvin, Ama, and Jordan approve their own shares — driven directly against the
  // API (their own UI is the organizer app's / their own account's scope, not this
  // guest's browser session) — Nana's page must pick this up live, no reload.
  for (const token of [alvinToken, amaToken, jordanToken]) {
    await api(`/api/v1/vinks/${vinkId}/contributions/authorize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
  }

  await page.getByText('$120.00 of $120.00 funded').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, '13-guest-funded.png') });
});
