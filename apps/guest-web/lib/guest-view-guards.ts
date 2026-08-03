import type { GuestVinkView, GuestVinkViewResult, NotOpenYetView, PublicVinkView } from './types';

/** D23 — decided by `vinkOutcome`, not by structural shape: when the backend's own
 * `VINKIN_CONTRIBUTION_PROJECTION_ENABLED` is off, a DRAFT vink still returns the full
 * (leaked) `EnrichedPublicVinkSummary` shape — but its `vinkOutcome` is still correctly
 * computed as `'not_open_yet'`. Checking `vinkOutcome` first means this app's own D23 UI
 * fix is never silently defeated by the backend flag being off — see lib/config.ts's
 * `GUEST_CONTRIBUTION_STATUS_UI_ENABLED` doc comment for the full two-flag interaction. */
export function isNotOpenYetPublicView(view: PublicVinkView): view is NotOpenYetView {
  return view.vinkOutcome === 'not_open_yet';
}

/** D23 — `GuestVinkViewResult`'s two members are discriminated by `participant`, present
 * only on the full `GuestVinkView` (its `purchaseCategory` is nested under `.vink`, not a
 * top-level field, so this needs its own check rather than reusing the one above). */
export function isFullGuestSession(view: GuestVinkViewResult): view is GuestVinkView {
  return 'participant' in view;
}
