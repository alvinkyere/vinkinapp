# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/operations-console/tests/pv11-exit-gate.spec.ts >> PV11 EXIT GATE: an operator finds, inspects, and completes a mock financial event entirely through the console
- Location: apps/operations-console/tests/pv11-exit-gate.spec.ts:29:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "CARD_READY"
Received: "FUNDED"

Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
```

# Test source

```ts
  8   | import { test, expect } from '@playwright/test';
  9   | 
  10  | const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
  11  | const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD ?? 'dev-only-operator-password';
  12  | 
  13  | async function api(path: string, init: RequestInit = {}): Promise<Response> {
  14  |   return fetch(`${API_BASE_URL}${path}`, {
  15  |     ...init,
  16  |     headers: { 'content-type': 'application/json', ...init.headers },
  17  |   });
  18  | }
  19  | 
  20  | async function registerUser(username: string): Promise<string> {
  21  |   const response = await api('/api/v1/auth/register', {
  22  |     method: 'POST',
  23  |     body: JSON.stringify({ username, displayName: username, password: 'integration-password-1' }),
  24  |   });
  25  |   const body = (await response.json()) as { accessToken: string };
  26  |   return body.accessToken;
  27  | }
  28  | 
  29  | test('PV11 EXIT GATE: an operator finds, inspects, and completes a mock financial event entirely through the console', async ({
  30  |   page,
  31  | }) => {
  32  |   test.setTimeout(60_000);
  33  |   const stamp = Date.now();
  34  |   const organizerToken = await registerUser(`pv11_org_${stamp}`);
  35  |   const memberUsername = `pv11_mem_${stamp}`;
  36  |   await registerUser(memberUsername);
  37  | 
  38  |   // --- Organizer app's own scope (PV9), driven directly ---------------------------
  39  |   const created = await (
  40  |     await api('/api/v1/vinks', {
  41  |       method: 'POST',
  42  |       headers: { authorization: `Bearer ${organizerToken}` },
  43  |       body: JSON.stringify({
  44  |         purchaseCategory: 'GROCERY',
  45  |         subtotalMinor: 6_000,
  46  |         tipMinor: 0,
  47  |         submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
  48  |         organizerDisplayName: 'PV11 Organizer',
  49  |       }),
  50  |     })
  51  |   ).json();
  52  |   const vinkId = created.vink.id as string;
  53  |   const publicCode = created.vink.publicCode as string;
  54  |   const organizerPid = created.participants[0].id as string;
  55  | 
  56  |   const added = await (
  57  |     await api(`/api/v1/vinks/${vinkId}/participants`, {
  58  |       method: 'POST',
  59  |       headers: { authorization: `Bearer ${organizerToken}` },
  60  |       body: JSON.stringify({ username: memberUsername }),
  61  |     })
  62  |   ).json();
  63  |   const memberPid = added.id as string;
  64  | 
  65  |   await api(`/api/v1/vinks/${vinkId}/split`, {
  66  |     method: 'PUT',
  67  |     headers: { authorization: `Bearer ${organizerToken}` },
  68  |     body: JSON.stringify({
  69  |       method: 'CUSTOM_AMOUNT',
  70  |       amounts: [
  71  |         { participantId: organizerPid, amountMinor: 0 },
  72  |         { participantId: memberPid, amountMinor: 6_000 },
  73  |       ],
  74  |     }),
  75  |   });
  76  |   await api(`/api/v1/vinks/${vinkId}/open`, {
  77  |     method: 'POST',
  78  |     headers: { authorization: `Bearer ${organizerToken}` },
  79  |     body: JSON.stringify({}),
  80  |   });
  81  |   const memberToken = await (
  82  |     await api('/api/v1/auth/login', {
  83  |       method: 'POST',
  84  |       body: JSON.stringify({ username: memberUsername, password: 'integration-password-1' }),
  85  |     })
  86  |   )
  87  |     .json()
  88  |     .then((body: { accessToken: string }) => body.accessToken);
  89  |   await api(`/api/v1/vinks/${vinkId}/contributions/authorize`, {
  90  |     method: 'POST',
  91  |     headers: { authorization: `Bearer ${memberToken}` },
  92  |     body: JSON.stringify({}),
  93  |   });
  94  | 
  95  |   // Wait for the real deadline sweep to provision the card (Plan §10) — no simulator
  96  |   // shortcut, matching PV9's e1_test.dart precedent.
  97  |   await expect
  98  |     .poll(
  99  |       async () => {
  100 |         const response = await api(`/api/v1/vinks/${vinkId}`, {
  101 |           headers: { authorization: `Bearer ${organizerToken}` },
  102 |         });
  103 |         const body = await response.json();
  104 |         return body.vink.state as string;
  105 |       },
  106 |       { timeout: 30_000, intervals: [1_000] },
  107 |     )
> 108 |     .toBe('CARD_READY');
      |      ^ Error: expect(received).toBe(expected) // Object.is equality
  109 | 
  110 |   // --- Everything from here is the operator, entirely through the console's UI ------
  111 |   await page.goto('/');
  112 |   await expect(page.getByText('VinkIn Operations Console')).toBeVisible();
  113 | 
  114 |   await page.getByLabel('Your name').fill('E2E Operator');
  115 |   await page.locator('#password').fill(OPERATOR_PASSWORD);
  116 |   await page.getByRole('button', { name: 'Sign in' }).click();
  117 |   await expect(page.getByRole('heading', { name: 'Vink search' })).toBeVisible();
  118 | 
  119 |   await page.locator('#publicCode').fill(publicCode);
  120 |   await page.getByRole('button', { name: 'Search' }).click();
  121 |   await expect(page.getByRole('link', { name: publicCode })).toBeVisible();
  122 | 
  123 |   await page.getByRole('link', { name: publicCode }).click();
  124 |   await expect(page.getByText('Simulation controls')).toBeVisible();
  125 |   await expect(page.getByText('Card').first()).toBeVisible();
  126 | 
  127 |   // Action 1: merchant authorization (the "swipe").
  128 |   await page.getByLabel('Amount (dollars)', { exact: true }).fill('60.00');
  129 |   await page.getByRole('button', { name: 'Authorize' }).click();
  130 |   await expect(page.getByText('Outcome: APPROVED')).toBeVisible({ timeout: 10_000 });
  131 | 
  132 |   // Action 2: capture (settlement) — prefilled from the authorization the console just read.
  133 |   await expect(page.getByRole('button', { name: 'Capture' })).toBeEnabled({ timeout: 10_000 });
  134 |   await page.getByRole('button', { name: 'Capture' }).click();
  135 |   await expect(page.getByText('Settlement: MATCHED')).toBeVisible({ timeout: 10_000 });
  136 | 
  137 |   // The vink itself is now COMPLETED, visible live in the header — no reload.
  138 |   await expect(page.getByText('COMPLETED').first()).toBeVisible();
  139 | 
  140 |   // Every table a completed vink touches is inspectable on this one page.
  141 |   await expect(page.getByText('Participants (2)')).toBeVisible();
  142 |   await expect(page.getByText('Contributions (1)')).toBeVisible();
  143 |   await expect(page.getByText(/Purchase authorizations \(1\)/)).toBeVisible();
  144 |   await expect(page.getByText('Settlements (1)')).toBeVisible();
  145 |   await expect(page.getByText(/Ledger entries \(\d+\)/)).toBeVisible();
  146 |   await expect(page.getByText(/Outbox \/ realtime delivery \(\d+\)/)).toBeVisible();
  147 |   await expect(page.getByText(/State history \(\d+\)/)).toBeVisible();
  148 | 
  149 |   // Every action taken through this console is attributed to the operator who took it.
  150 |   await expect(page.getByText('E2E Operator').first()).toBeVisible();
  151 |   await expect(page.getByText('MERCHANT_AUTHORIZATION').first()).toBeVisible();
  152 |   await expect(page.getByText('CAPTURE', { exact: true }).first()).toBeVisible();
  153 | 
  154 |   await page.screenshot({ path: 'test-results/pv11-exit-gate-completed.png', fullPage: true });
  155 | });
  156 | 
```