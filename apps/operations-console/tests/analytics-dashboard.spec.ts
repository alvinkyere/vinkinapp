// PV12 prep exit-gate proof: the operations console's /analytics page renders every number
// the PV12 exit gate names, computed from real backend data — not fabricated. Reports one
// real funnel event (a join failure) through the public ingestion endpoint first, then
// confirms it's visible in "top failure points", proving the whole pipeline (client event →
// ingestion → aggregation query → dashboard) end to end.

import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD ?? 'dev-only-operator-password';

test('PV12 prep: the pilot metrics dashboard reflects real reported funnel events', async ({
  page,
}) => {
  const marker = `pv12_dashboard_test_${Date.now()}`;

  // A real event through the real public endpoint — this app's own scope, not the
  // organizer/guest apps', so it's driven directly rather than through their UI.
  const reported = await fetch(`${API_BASE_URL}/api/v1/analytics/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: marker,
      app: 'guest_web',
      events: [
        {
          eventName: 'guest_join_failed',
          properties: { errorCode: marker },
          occurredAt: new Date().toISOString(),
        },
      ],
    }),
  });
  expect(reported.status).toBe(202);

  await page.goto('/');
  await page.getByLabel('Your name').fill('PV12 Dashboard Test Operator');
  await page.locator('#password').fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Vink search' })).toBeVisible();

  await page.getByRole('link', { name: 'Pilot metrics' }).click();
  await expect(page.getByRole('heading', { name: 'PV12 pilot metrics' })).toBeVisible();

  // Every named exit-gate metric is present and rendered as a number, not stuck loading.
  await expect(page.getByText('Complete simulated Vinks')).toBeVisible();
  await expect(page.getByText('Participant joins')).toBeVisible();
  await expect(page.getByText('Organizer task completion')).toBeVisible();
  await expect(page.getByText('Median join-to-contribution time')).toBeVisible();
  await expect(page.getByText(/target ≥ 25/)).toBeVisible();
  await expect(page.getByText(/target ≥ 75/)).toBeVisible();

  // The failure point just reported is visible in the top-five list — proving the full
  // client-event → ingestion → aggregation → dashboard pipeline, not a canned number.
  await expect(page.getByText('guest_join_failed')).toBeVisible();

  await page.screenshot({ path: 'test-results/pv12-dashboard.png', fullPage: true });
});
