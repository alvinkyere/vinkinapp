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
 * `GuestVinkOutcome`. Returns `null` for `'open'`/`'not_open_yet'` (no terminal outcome yet).
 *
 * `'recovery_required'` — **D37 (2026-07-21) corrects §16/§18's original "organizer-only"
 * annotation**: the canonical sentence is now shown to the guest too. See
 * `docs/spec/decision-log.md` D37 for the full reasoning. Prefer `guestTerminalSentence`
 * below over calling this directly for a guest's own screen — it additionally prioritizes
 * the guest's own `contributionStatus` for `return_pending`/`returned`, which this
 * vink-level function alone cannot distinguish from `expired`/`cancelled`.
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
      return "We're resolving your payment. You don't need to pay again.";
    case 'open':
    case 'not_open_yet':
      return null;
  }
}

/**
 * Slice I3A — the actual composition-selection priority for a guest's own screen: the
 * guest's own `contributionStatus` takes priority over the vink-level `vinkOutcome`
 * whenever it is itself `return_pending`/`returned`/`recovery_required`, because those three
 * describe *this guest's own money* specifically and can genuinely diverge from the vink's
 * overall outcome — e.g. a guest whose own captured contribution is being refunded
 * (`return_pending`) typically sits on a vink whose own `vinkOutcome` reads `expired`
 * (`FUNDING_REVERSAL`/`EXPIRED`); showing `terminalOutcomeSentence('expired', ...)` —
 * "You weren't charged." — would be factually wrong for a guest who *was* charged and is
 * now being refunded. Falls back to the vink-level sentence for every other case.
 */
export function guestTerminalSentence(
  contributionStatus: GuestContributionStatus,
  vinkOutcome: GuestVinkOutcome,
  purchaseCategory: PurchaseCategory,
): string | null {
  switch (contributionStatus) {
    case 'return_pending':
      return 'Your payment is being returned.';
    case 'returned':
      return 'Your payment was returned.';
    case 'recovery_required':
      return "We're resolving your payment. You don't need to pay again.";
    default:
      return terminalOutcomeSentence(vinkOutcome, purchaseCategory);
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
