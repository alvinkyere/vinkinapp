import { CATEGORY_LABELS } from './purchase-category';
import type { GuestContributionStatus, GuestVinkOutcome, PurchaseCategory } from './types';

/**
 * D24/D25/D34 guest-facing copy — verbatim from `docs/design/phase-6-copy-system.md` §10
 * (contribution-status vocabulary) and §18 (return/recovery language, D34-amended: the
 * individual no-charge phrase is identical for guest/member/organizer, never softened).
 * Never a raw backend state or status name.
 */

/** §10's compact row/badge word, keyed by the viewer's own `GuestContributionStatus`. */
export function contributionStatusWord(status: GuestContributionStatus): string {
  switch (status) {
    case 'not_started':
      return 'Waiting';
    case 'processing':
      return 'Processing';
    case 'declined_retryable':
      return 'Needs another try';
    case 'declined_final':
      return 'Not charged';
    // §18's continuity rule: a guest whose money is already settled stays "Paid"/"You're
    // in" through a recovery event — recovery is an organizer-only concern (§11), never a
    // newly-announced distinct state for a participant/guest.
    case 'confirmed':
    case 'recovery_required':
      return 'Paid';
    case 'return_pending':
      return 'Being returned';
    case 'returned':
      return 'Returned';
  }
}

/** §10's narrative sentence, keyed by the viewer's own `GuestContributionStatus`. */
export function contributionStatusSentence(
  status: GuestContributionStatus,
  ownShareLabel: string,
): string {
  switch (status) {
    case 'not_started':
      return `Your part is ${ownShareLabel}.`;
    case 'processing':
      return "We're confirming your payment.";
    case 'declined_retryable':
      return "That didn't go through. Nothing was charged.";
    case 'declined_final':
      return 'Nothing was charged.';
    case 'confirmed':
    case 'recovery_required':
      return "You're in.";
    case 'return_pending':
      return 'Your payment is being returned.';
    case 'returned':
      return 'Your payment was returned.';
  }
}

/**
 * §18's individual (D34) money-outcome sentence for the whole vink, keyed by
 * `GuestVinkOutcome`. Returns `null` for `'open'`/`'not_open_yet'` (no terminal outcome yet)
 * and for `'recovery_required'` — per §18's own note, that sentence is shown **only to the
 * organizer**; a participant/guest's own status stays whatever `contributionStatusSentence`
 * already says (never re-described as a distinct state, §8's continuity rule).
 */
export function terminalOutcomeSentence(
  outcome: GuestVinkOutcome,
  purchaseCategory: PurchaseCategory,
): string | null {
  const purpose = CATEGORY_LABELS[purchaseCategory] ?? purchaseCategory;
  switch (outcome) {
    case 'completed':
      return `Payment complete. Your part helped pay ${purpose}.`;
    case 'expired':
      return "You weren't charged.";
    case 'cancelled':
      return "The organizer cancelled. You weren't charged.";
    case 'return_pending':
      return 'Your payment is being returned.';
    case 'returned':
      return 'Your payment was returned.';
    case 'recovery_required':
    case 'open':
    case 'not_open_yet':
      return null;
  }
}

/** §13's countdown language — never raw ISO timestamps, never internal-process names
 * ("processing grace," "deadline sweep") shown to a guest. */
export function countdownLabel(deadline: string, now: Date = new Date()): string | null {
  const diffMs = new Date(deadline).getTime() - now.getTime();
  if (diffMs <= 0) return null;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Closes in under a minute';
  return `Closes in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
