/**
 * ENG6 Slice 3 — Stripe error/decline translation into VinkIn's provider-neutral shapes.
 * Two distinct translations, matching Slice 2's own design (packages/payment-provider/src/
 * errors.ts): a card decline is data (`ContributionDeclineReason`, a typed return value),
 * never a thrown error; an operational failure (bad request, outage, misconfiguration) is a
 * thrown `ProviderError`. Nothing here invents a VinkIn-side meaning Stripe's own
 * documentation doesn't already assign to the underlying `decline_code`/error type.
 */

import Stripe from 'stripe';
import { ProviderError, type ProviderErrorCode } from '../../../payment-provider/src/index.ts';
import type { ContributionDeclineReason } from '../../../payment-provider/src/index.ts';

/** Stripe's own documented decline-code vocabulary (a subset — only the codes this mapping
 * assigns a distinct VinkIn meaning to). https://docs.stripe.com/declines/codes */
const RISK_BLOCK_DECLINE_CODES = new Set([
  'fraudulent',
  'stolen_card',
  'lost_card',
  'pickup_card',
  'restricted_card',
  'security_violation',
]);

export function stripeDeclineReason(
  declineCode: string | null | undefined,
): ContributionDeclineReason {
  if (declineCode === 'insufficient_funds') return 'INSUFFICIENT_FUNDS';
  if (declineCode === 'expired_card') return 'EXPIRED_METHOD';
  if (
    declineCode !== null &&
    declineCode !== undefined &&
    RISK_BLOCK_DECLINE_CODES.has(declineCode)
  ) {
    return 'COMPLIANCE_BLOCKED';
  }
  if (declineCode === 'generic_decline' || declineCode === null || declineCode === undefined) {
    return 'GENERIC';
  }
  return 'CARD_DECLINED';
}

/**
 * Translates a thrown Stripe SDK error into a `ProviderError`. A `StripeCardError` reaching
 * here means it happened somewhere OTHER than `authorizeContribution` (capture/refund/cancel
 * declining is genuinely exceptional, unlike an initial authorization decline, which
 * `authorizeContribution` catches and returns as data before this function ever runs) —
 * surfaced as `PERMANENTLY_DECLINED`, matching `errors.ts`'s own documented meaning for that
 * code ("definitive decline surfaced as error in non-authorize calls").
 *
 * Errors this function does NOT wrap (rethrown as-is): `StripeAuthenticationError` and
 * `StripePermissionError` indicate the adapter itself is misconfigured (bad key, insufficient
 * API permissions) — a real bug to crash loudly on, not an operational outcome the
 * orchestrator should classify or retry.
 */
export function translateStripeError(error: unknown): never {
  if (!(error instanceof Stripe.errors.StripeError)) {
    throw error;
  }
  if (error instanceof Stripe.errors.StripeAuthenticationError) throw error;
  if (error instanceof Stripe.errors.StripePermissionError) throw error;

  if (error instanceof Stripe.errors.StripeIdempotencyError) {
    throw new ProviderError('IDEMPOTENCY_CONFLICT', error.message, error.code ?? undefined);
  }
  if (error instanceof Stripe.errors.StripeCardError) {
    throw new ProviderError(
      'PERMANENTLY_DECLINED',
      error.message,
      error.decline_code ?? error.code ?? undefined,
    );
  }
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    // Codes confirmed against the real sandbox (not guessed): capturing/refunding above
    // what's actually available on the charge, and re-capturing an already-captured
    // PaymentIntent, are the two "shape" errors this codebase's own hard rule (§4.7) and
    // capability declaration (multipleCapture: false) need distinguishable, not folded into
    // a generic INVALID_REQUEST.
    if (error.code === 'resource_missing') {
      throw new ProviderError('OBJECT_NOT_FOUND', error.message, error.code);
    }
    if (error.code === 'amount_too_large') {
      throw new ProviderError('AMOUNT_EXCEEDS_AUTHORIZATION', error.message, error.code);
    }
    if (error.code === 'payment_intent_unexpected_state') {
      throw new ProviderError('INVALID_STATE', error.message, error.code);
    }
    // Refunds: Stripe gives no distinct `.code` for "amount exceeds what's refundable" (only
    // `param: 'amount'` + a message naming the charge amount) — confirmed against the real
    // sandbox, not assumed from a `.code` that doesn't exist for this specific case.
    if (error.param === 'amount' && error.message.includes('greater than charge amount')) {
      throw new ProviderError('AMOUNT_EXCEEDS_AUTHORIZATION', error.message, error.param);
    }
    throw new ProviderError('INVALID_REQUEST', error.message, error.code ?? undefined);
  }
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  ) {
    const code: ProviderErrorCode = 'PROVIDER_UNAVAILABLE';
    throw new ProviderError(code, error.message, error.code ?? undefined);
  }

  // An SDK error type not explicitly named above (Stripe adds new subclasses over time) —
  // UNKNOWN_OUTCOME, not a silent fallback to any of the more specific codes above: the
  // caller genuinely cannot tell what happened, and §12's "retry with the same idempotency
  // key is always safe" applies regardless of which unnamed condition this turns out to be.
  throw new ProviderError('UNKNOWN_OUTCOME', error.message, error.code ?? undefined);
}
