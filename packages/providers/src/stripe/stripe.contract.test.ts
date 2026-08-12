/**
 * ENG6 Slice 3 — the Stripe adapter runs the SAME shared conformance suite the mock does
 * (D7), against a REAL Stripe sandbox account (sandbox/test-mode credentials only, per D46).
 * Skipped entirely unless real credentials are configured — this suite makes real network
 * calls to api.stripe.com and cannot run in an offline/CI environment without them.
 *
 * Missing hooks are documented skips (the suite's own established discipline), not silent
 * gaps — see this file's own comments at each hook for why it's present or absent.
 */

import { createHmac, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { runFinancialProviderContractTests } from '../../../payment-provider-contract-tests/src/contract-suite.ts';
import type { ProviderTestKit } from '../../../payment-provider-contract-tests/src/test-kit.ts';
import { StripeFinancialProvider } from './stripe-financial-provider.ts';
import { loadStripeAdapterConfig } from './config.ts';

const RUN = process.env.VINKIN_STRIPE_SANDBOX_TEST === '1';

function makeStripeKit(): ProviderTestKit {
  const config = loadStripeAdapterConfig();
  const provider = new StripeFinancialProvider(config);
  // RM4C's confirmContributionPaymentIntent hook needs `paymentIntents.confirm` directly —
  // not part of the FinancialProvider interface itself (confirming with a specific test
  // payment method is a test-only concern, never something application code does), so this
  // test file constructs its own raw client, same credentials, same package (legal per D7/
  // §42 — `packages/providers` is already an approved provider-SDK home).
  const stripeClient = new Stripe(config.secretKey, { apiVersion: '2026-06-24.dahlia' });

  // Stripe's own documented test PaymentMethod IDs for exercising specific outcomes in test
  // mode (https://docs.stripe.com/testing) — not a VinkIn invention, Stripe's own fixtures.
  const tokenForBehavior: Record<string, string> = {
    ok: 'pm_card_visa',
    decline: 'pm_card_visa_chargeDeclined',
    insufficient_funds: 'pm_card_visa_chargeDeclinedInsufficientFunds',
    compliance_blocked: 'pm_card_visa_chargeDeclinedFraudulent',
    expired_method: 'pm_card_visa_chargeDeclinedExpiredCard',
  };

  return {
    provider,

    async createCustomerAndMethod(behavior) {
      const { providerCustomerId } = await provider.createCustomer({
        idempotencyKey: `cus:kit:${randomUUID()}`,
        externalUserId: `user-${randomUUID()}`,
      });
      const methodToken = tokenForBehavior[behavior];
      if (methodToken === undefined) {
        throw new Error(`stripe kit has no test token for behavior "${behavior}"`);
      }
      // Confirmed against the real sandbox: Stripe's decline-simulation test PaymentMethod
      // IDs (pm_card_visa_chargeDeclined* etc.) fail immediately at `attach()`, not at
      // PaymentIntent confirmation — they're designed for direct one-time use, not saved
      // reuse. This is a real, confirmed Stripe testing-technique constraint, not a flaw in
      // StripeFinancialProvider itself: `authorizeContribution` handles an UNATTACHED test
      // token identically to an attached one (Stripe allows using either as `payment_method`
      // on a PaymentIntent), so the fixture returns the raw token directly for anything
      // other than `'ok'`, skipping the attach step this specific token family can't survive.
      if (behavior !== 'ok') {
        return { providerCustomerId, providerMethodId: methodToken };
      }
      const { providerMethodId } = await provider.setupPaymentMethod({
        idempotencyKey: `pm:kit:${randomUUID()}`,
        providerCustomerId,
        methodToken,
        usage: 'CONTRIBUTION',
      });
      return { providerCustomerId, providerMethodId };
    },

    // No resolvePendingAuthorization/expireAuthorization/simulateTransientFailure/
    // simulateLostResponse/simulateUnknownOutcome hooks: Stripe's sandbox doesn't expose a
    // way to force these specific outcomes on demand the way an in-process mock can — the
    // dependent tests document their own skip via the suite's existing `t.skip(...)` pattern
    // when a kit omits the hook.

    // RM4C — confirming a `createContributionPaymentIntent` result server-side, without a
    // browser, using Stripe's own documented test PaymentMethod IDs
    // (https://docs.stripe.com/testing#cards): this is exactly how Stripe recommends testing
    // a client-confirmed flow from a backend test. `pm_card_visa` always succeeds;
    // `pm_card_visa_chargeDeclined` always declines at confirmation (not at attach, unlike
    // the decline-family tokens above — this family is designed for direct one-time
    // confirmation, which is exactly this call shape).
    async confirmContributionPaymentIntent(providerPaymentId, behavior) {
      const paymentMethod = behavior === 'ok' ? 'pm_card_visa' : 'pm_card_visa_chargeDeclined';
      try {
        await stripeClient.paymentIntents.confirm(providerPaymentId, {
          payment_method: paymentMethod,
        });
      } catch (error) {
        // A card decline surfaces as a thrown StripeCardError from `confirm()` (unlike
        // `authorizeContribution`'s own initial-authorization decline path) — this hook's
        // only job is to drive the PaymentIntent to its real terminal state; the suite's own
        // assertion re-reads that state via `retrievePaymentStatus` afterward rather than
        // trusting this call's own success/failure. Only a genuine card decline is swallowed
        // here — any other error (e.g. a configuration mistake) must fail loudly, a real bug
        // this file's own first sandbox run caught: a missing `allow_redirects: 'never'` on
        // the adapter's own `createContributionPaymentIntent` made Stripe require a
        // `return_url` at confirm time, which is a `StripeInvalidRequestError`, not a decline
        // — the old broad `'payment_intent' in error` check silently swallowed that too.
        if (!(error instanceof Stripe.errors.StripeCardError)) throw error;
      }
    },

    // drainEvents/duplicateLastEvent/swapLastTwoEvents: same reason — no local event log to
    // drain against a real sandbox. signWebhook IS provided (see below): it doesn't need
    // Stripe's own signing internals, only HMAC-SHA256 over a real webhook secret, which
    // Stripe's own `constructEvent` verifies identically regardless of who computed it.
    // ENG6 Slice 3 — a real Stripe adapter's parseWebhookEvent translates STRIPE's own wire
    // shape, not VinkIn's already-normalized vocabulary; the suite's own default rawBody
    // (mock-shaped) would never structurally match. Real event envelope, real Stripe type
    // string, verified against `mapStripeEventType` in stripe-financial-provider.ts.
    buildTestEventRawBody: ({ providerEventId, objectId }) =>
      JSON.stringify({
        id: providerEventId,
        object: 'event',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: objectId, object: 'payment_intent' } },
      }),

    signWebhook: (rawBody, secret) => {
      // Stripe's webhook signature scheme (documented, not internal): `t=<timestamp>,
      // v1=<hex hmac-sha256 of "<timestamp>.<rawBody>" using the endpoint secret>`.
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${rawBody}`;
      const v1 = createHmac('sha256', secret).update(signedPayload).digest('hex');
      return `t=${timestamp},v1=${v1}`;
    },
  };
}

if (RUN) {
  runFinancialProviderContractTests('StripeFinancialProvider (sandbox)', makeStripeKit);
} else {
  console.log(
    'Skipping Stripe sandbox contract suite — set VINKIN_STRIPE_SANDBOX_TEST=1 with real ' +
      'sandbox credentials in apps/api/.env to run it against api.stripe.com.',
  );
}
