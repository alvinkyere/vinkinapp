import type { GuestSession } from './types';

// The guest token lives in localStorage, scoped per publicCode, not an httpOnly cookie —
// a deliberate PV10 simplification (flagged in the milestone report): this is a
// mock-money validation build with no session-hijacking-sensitive value at stake, and a
// guest link with no account has nowhere else to keep client-held state. Revisit before
// real money (same G4-adjacent territory as the organizer app's JWT-in-URL flag on the
// realtime channel).
const KEY_PREFIX = 'vinkin.guest.';

function key(publicCode: string): string {
  return `${KEY_PREFIX}${publicCode}`;
}

export function loadGuestSession(publicCode: string): GuestSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(key(publicCode));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as GuestSession;
  } catch {
    return null;
  }
}

export function saveGuestSession(session: GuestSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key(session.publicCode), JSON.stringify(session));
}

export function clearGuestSession(publicCode: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(key(publicCode));
}
