// ENG3: regression test for a real bug found while auditing the client reliability
// checklist — `useGuestRealtime`'s per-live-message `GET /api/v1/guest/session` refetch had
// no request-sequence guard, so an OLDER request that happens to RESOLVE later than a NEWER
// one could overwrite fresher data with stale data. This is the exact bug class
// `vink_lobby_screen.dart`'s `_snapshotRequestId` already guards against on the organizer
// side (PV13-SCREENSHOTS.md) — this test proves the same fix now exists on the guest side.
// Reuses `guest-terminal-states.spec.ts`'s fixture/mocking pattern (seeded localStorage
// session, intercepted `GET /api/v1/guest/session`, a controlled WebSocket via
// `page.routeWebSocket`) rather than driving a real backend.

import { test, expect, type Route } from '@playwright/test';
import type { GuestVinkView } from '../lib/types';

const PUBLIC_CODE = 'RACE0000';
const VINK_ID = 'fixture-race-vink-id';
const GUEST_TOKEN = 'vgt_fixture-race-token-not-a-real-secret';

function viewWithShare(allocatedAmountMinor: number): GuestVinkView {
  return {
    vink: {
      publicCode: PUBLIC_CODE,
      purchaseCategory: 'GROCERY',
      state: 'OPEN',
      requiredAmountMinor: 10_000,
      fundedAmountMinor: 4_000,
      submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
      participantCount: 2,
      joinable: false,
      contributionProgress: {
        confirmedAmountMinor: 4_000,
        totalAmountMinor: 10_000,
        confirmedParticipantCount: 1,
        totalParticipantCount: 2,
      },
      vinkOutcome: 'open',
    },
    participant: {
      id: 'fixture-race-participant-id',
      vinkId: VINK_ID,
      displayName: 'Race Guest',
      status: 'JOINED',
      allocatedAmountMinor,
      maximumApprovedAmountMinor: allocatedAmountMinor,
      contributionStatus: 'not_started',
    },
  };
}

test('ENG3: an older-issued session refetch that resolves later never overwrites a newer one', async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)),
    {
      key: `vinkin.guest.${PUBLIC_CODE}`,
      session: { publicCode: PUBLIC_CODE, guestToken: GUEST_TOKEN, vinkId: VINK_ID },
    },
  );

  // Call 0: JoinExperience's own initial fetch (via useQuery), resolves immediately.
  // Call 1 ("stale"): triggered by the FIRST live message, issued before call 2, but its
  // response is delayed so it resolves AFTER call 2 — the out-of-order arrival this test is
  // about.
  // Call 2 ("fresh"): triggered by the SECOND live message, issued after call 1, and resolves
  // quickly — this is the response that must win.
  let callCount = 0;
  await page.route('**/api/v1/guest/session', async (route: Route) => {
    const index = callCount;
    callCount += 1;
    if (index === 0) {
      await route.fulfill({ json: viewWithShare(4_000) });
      return;
    }
    if (index === 1) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // resolves last, on purpose
      await route.fulfill({ json: viewWithShare(5_000) }); // must be discarded
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50)); // resolves first
    await route.fulfill({ json: viewWithShare(6_000) }); // must be the final rendered value
  });

  let sendState: ((message: unknown) => void) | null = null;
  await page.routeWebSocket(/\/api\/v1\/vinks\/.*\/live/, (ws) => {
    sendState = (message: unknown) => ws.send(JSON.stringify(message));
    ws.send(JSON.stringify({ type: 'snapshot', vinkId: VINK_ID, snapshot: viewWithShare(4_000) }));
  });

  await page.goto(`/join/${PUBLIC_CODE}`);
  await expect(page.getByText('$40.00', { exact: true })).toBeVisible();

  // Two live "state changed" messages, back to back — each triggers its own
  // `GET /api/v1/guest/session` refetch (call 1 then call 2 above).
  sendState!({ type: 'vink_state_changed', state: 'OPEN', fundedAmountMinor: 4_000 });
  sendState!({ type: 'vink_state_changed', state: 'OPEN', fundedAmountMinor: 4_000 });

  // Call 2 ("fresh", $60.00) resolves first — the screen updates to it.
  await expect(page.getByText('$60.00', { exact: true })).toBeVisible();

  // Call 1 ("stale", $50.00) resolves 400ms+ later; without the request-sequence guard this
  // bug's own regression would show here — the screen must still read $60.00, never $50.00.
  await page.waitForTimeout(700);
  await expect(page.getByText('$60.00', { exact: true })).toBeVisible();
  await expect(page.getByText('$50.00', { exact: true })).not.toBeVisible();
});
