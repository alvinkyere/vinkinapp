// PV11 exit-gate proof: "Every mock financial event can be inspected and explained by an
// operator." Runs a real production build of apps/operations-console against the REAL
// local backend (Postgres + Redis + apps/api/src/server.ts) — no mocks. Vink setup (create,
// split, open, fund) is the organizer's own app's scope (PV9) and is driven directly
// against the API here, exactly as PV9's and PV10's own exit-gate tests drive out-of-scope
// actions. Everything from login onward goes through the console's real UI.

import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD ?? 'dev-only-operator-password';

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

test('PV11 EXIT GATE: an operator finds, inspects, and completes a mock financial event entirely through the console', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const organizerToken = await registerUser(`pv11_org_${stamp}`);
  const memberUsername = `pv11_mem_${stamp}`;
  await registerUser(memberUsername);

  // --- Organizer app's own scope (PV9), driven directly ---------------------------
  const created = await (
    await api('/api/v1/vinks', {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        purchaseCategory: 'GROCERY',
        subtotalMinor: 6_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'PV11 Organizer',
      }),
    })
  ).json();
  const vinkId = created.vink.id as string;
  const publicCode = created.vink.publicCode as string;
  const organizerPid = created.participants[0].id as string;

  const added = await (
    await api(`/api/v1/vinks/${vinkId}/participants`, {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({ username: memberUsername }),
    })
  ).json();
  const memberPid = added.id as string;

  await api(`/api/v1/vinks/${vinkId}/split`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({
      method: 'CUSTOM_AMOUNT',
      amounts: [
        { participantId: organizerPid, amountMinor: 0 },
        { participantId: memberPid, amountMinor: 6_000 },
      ],
    }),
  });
  await api(`/api/v1/vinks/${vinkId}/open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${organizerToken}` },
    body: JSON.stringify({}),
  });
  const memberToken = await (
    await api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: memberUsername, password: 'integration-password-1' }),
    })
  )
    .json()
    .then((body: { accessToken: string }) => body.accessToken);
  await api(`/api/v1/vinks/${vinkId}/contributions/authorize`, {
    method: 'POST',
    headers: { authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({}),
  });

  // Wait for the real deadline sweep to provision the card (Plan §10) — no simulator
  // shortcut, matching PV9's e1_test.dart precedent.
  await expect
    .poll(
      async () => {
        const response = await api(`/api/v1/vinks/${vinkId}`, {
          headers: { authorization: `Bearer ${organizerToken}` },
        });
        const body = await response.json();
        return body.vink.state as string;
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe('CARD_READY');

  // --- Everything from here is the operator, entirely through the console's UI ------
  await page.goto('/');
  await expect(page.getByText('VinkIn Operations Console')).toBeVisible();

  await page.getByLabel('Your name').fill('E2E Operator');
  await page.locator('#password').fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Vink search' })).toBeVisible();

  await page.locator('#publicCode').fill(publicCode);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: publicCode })).toBeVisible();

  await page.getByRole('link', { name: publicCode }).click();
  await expect(page.getByText('Simulation controls')).toBeVisible();
  await expect(page.getByText('Card').first()).toBeVisible();

  // Action 1: merchant authorization (the "swipe").
  await page.getByLabel('Amount (dollars)', { exact: true }).fill('60.00');
  await page.getByRole('button', { name: 'Authorize' }).click();
  await expect(page.getByText('Outcome: APPROVED')).toBeVisible({ timeout: 10_000 });

  // Action 2: capture (settlement) — prefilled from the authorization the console just read.
  await expect(page.getByRole('button', { name: 'Capture' })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByText('Settlement: MATCHED')).toBeVisible({ timeout: 10_000 });

  // The vink itself is now COMPLETED, visible live in the header — no reload.
  await expect(page.getByText('COMPLETED').first()).toBeVisible();

  // Every table a completed vink touches is inspectable on this one page.
  await expect(page.getByText('Participants (2)')).toBeVisible();
  await expect(page.getByText('Contributions (1)')).toBeVisible();
  await expect(page.getByText(/Purchase authorizations \(1\)/)).toBeVisible();
  await expect(page.getByText('Settlements (1)')).toBeVisible();
  await expect(page.getByText(/Ledger entries \(\d+\)/)).toBeVisible();
  await expect(page.getByText(/Outbox \/ realtime delivery \(\d+\)/)).toBeVisible();
  await expect(page.getByText(/State history \(\d+\)/)).toBeVisible();

  // Every action taken through this console is attributed to the operator who took it.
  await expect(page.getByText('E2E Operator').first()).toBeVisible();
  await expect(page.getByText('MERCHANT_AUTHORIZATION').first()).toBeVisible();
  await expect(page.getByText('CAPTURE', { exact: true }).first()).toBeVisible();

  await page.screenshot({ path: 'test-results/pv11-exit-gate-completed.png', fullPage: true });
});
