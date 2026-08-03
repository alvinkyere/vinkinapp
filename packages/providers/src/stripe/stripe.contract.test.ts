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
import { runFinancialProviderContractTests } from '../../../payment-provider-contract-tests/src/contract-suite.ts';
import type { ProviderTestKit } from '../../../payment-provider-contract-tests/src/test-kit.ts';
import { StripeFinancialProvider } from './stripe-financial-provider.ts';
import { loadStripeAdapterConfig } from './config.ts';

const RUN = process.env.VINKIN_STRIPE_SANDBOX_TEST === '1';

function makeStripeKit(): ProviderTestKit {
  const config = loadStripeAdapterConfig();
  const provider = new StripeFinancialProvider(config);

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
