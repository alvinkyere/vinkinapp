import { API_BASE_URL } from './config';

const CLIENT_ID_KEY = 'vinkin.analyticsClientId';

function getClientId(): string {
  if (typeof window === 'undefined') return 'server';
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing !== null) return existing;
  const generated = crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

/**
 * PV12 prep: fire-and-forget funnel event reporting. One event per call rather than a
 * client-side batch queue — simplest thing that satisfies the backend's batch-shaped
 * endpoint, and funnel events here are low-frequency (a handful per guest session), not
 * worth a flush/retry pipeline for a validation build. Failures are swallowed on purpose:
 * analytics must never be able to break the actual join/contribute flow.
 */
export function track(
  eventName: string,
  properties: Record<string, unknown> = {},
  vinkId?: string,
): void {
  if (typeof window === 'undefined') return;
  const body = {
    clientId: getClientId(),
    app: 'guest_web',
    events: [{ eventName, vinkId, properties, occurredAt: new Date().toISOString() }],
  };
  fetch(`${API_BASE_URL}/api/v1/analytics/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Best-effort only — see module doc above.
  });
}
