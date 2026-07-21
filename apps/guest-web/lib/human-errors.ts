import { ApiError } from './api-error';

/**
 * Maps backend error codes to Phase 6 §16's exact customer-facing explanations — mirrors
 * `apps/mobile/lib/core/errors/human_errors.dart`'s pattern (same table, same fallback
 * discipline: an unmapped code never surfaces its raw name). Only covers codes actually
 * reachable from Guest Web's three API calls (`getPublicVinkView`, `joinVink`,
 * `getGuestSession`, `authorizeGuestContribution`) — not the full backend error surface.
 */
export function humanErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Nothing was charged — try again.';
  }
  switch (error.code) {
    case 'VINK_NOT_FOUND':
      return "This link doesn't work. Double-check the link, or ask for a new one.";
    case 'VINK_NOT_JOINABLE':
      return 'This Vink is no longer accepting new participants.';
    case 'GUEST_UNAUTHENTICATED':
      return 'Your session expired. Open the link again to continue.';
    case 'AUTHORIZATION_DECLINED':
      return "That didn't go through. Nothing was charged. Try again.";
    case 'VALIDATION_FAILED':
      return 'Please check the details and try again.';
    case 'RATE_LIMITED':
      return "That's a lot of tries — wait a moment and try again.";
    default:
      return 'Something went wrong. Nothing was charged — try again.';
  }
}
