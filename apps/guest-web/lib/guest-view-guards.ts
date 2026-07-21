import type { GuestVinkView, GuestVinkViewResult, NotOpenYetView, PublicVinkView } from './types';

/** D23 — `PublicVinkView`'s two members are discriminated by `purchaseCategory`, present
 * only on the full `EnrichedPublicVinkSummary`. */
export function isNotOpenYetPublicView(view: PublicVinkView): view is NotOpenYetView {
  return !('purchaseCategory' in view);
}

/** D23 — `GuestVinkViewResult`'s two members are discriminated by `participant`, present
 * only on the full `GuestVinkView` (its `purchaseCategory` is nested under `.vink`, not a
 * top-level field, so this needs its own check rather than reusing the one above). */
export function isFullGuestSession(view: GuestVinkViewResult): view is GuestVinkView {
  return 'participant' in view;
}
