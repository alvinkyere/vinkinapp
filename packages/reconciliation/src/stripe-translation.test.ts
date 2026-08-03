/**
 * ENG6 Slice 5 — "Stripe-specific translation fixtures where appropriate." Proves the
 * classification rules work correctly against events as STRIPE's own adapter actually
 * produces them (real field names, real `mapStripeEventType` translation from Slice 3), not
 * just against hand-written provider-neutral fixtures.
 *
 * Deliberately fully offline: `Stripe.webhooks.constructEvent` verification is pure local
 * HMAC-SHA256 (confirmed in Slice 3/4 — no network call), so a throwaway sandbox-shaped key
 * pair and a locally-computed signature exercise the REAL translation code with no live
 * credentials, no network, and no `VINKIN_STRIPE_SANDBOX_TEST` gating required. This is not
 * live-mode use of any kind (D46) — nothing here ever calls api.stripe.com.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { classify } from './classify.ts';
import { StripeFinancialProvider } from '../../providers/src/index.ts';

const WEBHOOK_SECRET = 'whsec_offline_test_only';
const provider = new StripeFinancialProvider({
  secretKey: 'sk_test_offline_dummy_key_never_sent_over_network',
  webhookSecret: WEBHOOK_SECRET,
});

function signedStripeEvent(
  stripeType: string,
  objectId: string,
  extra: Record<string, unknown> = {},
) {
  const rawBody = JSON.stringify({
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    object: 'event',
    type: stripeType,
    created: Math.floor(new Date('2026-02-01T00:00:00.000Z').getTime() / 1000),
    data: { object: { id: objectId, object: 'payment_intent', ...extra } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  return { rawBody, signatureHeader: `t=${timestamp},v1=${v1}` };
}

test('a real Stripe payment_intent.succeeded translates to payment.captured and classifies EXPECTED', () => {
  const { rawBody, signatureHeader } = signedStripeEvent('payment_intent.succeeded', 'pi_test_1');
  const parsed = provider.parseWebhookEvent({
    rawBody,
    signatureHeader,
    webhookSecret: WEBHOOK_SECRET,
  });

  assert.equal(parsed.type, 'payment.captured');
  assert.equal(parsed.objectId, 'pi_test_1');
  assert.equal(parsed.provider, 'stripe');

  const result = classify(parsed, {
    targetKind: 'contribution',
    found: true,
    entityId: 'contrib-stripe-1',
    entityStatus: 'CAPTURED',
  });
  assert.equal(result.classification, 'EXPECTED');
});

test('a real Stripe charge.dispute.created translates to dispute.created and is UNRECOGNIZED, not silently dropped', () => {
  const { rawBody, signatureHeader } = signedStripeEvent('charge.dispute.created', 'dp_test_1');
  const parsed = provider.parseWebhookEvent({
    rawBody,
    signatureHeader,
    webhookSecret: WEBHOOK_SECRET,
  });

  assert.equal(parsed.type, 'dispute.created');
  const result = classify(parsed, { targetKind: 'none', found: false });
  assert.equal(result.classification, 'UNRECOGNIZED');
});

test('a real Stripe event with an unmapped type throws (Slice 3 behavior) — reconciliation never sees it, Slice 4 dead-letters it', () => {
  const { rawBody, signatureHeader } = signedStripeEvent('customer.created', 'cus_test_1');
  assert.throws(() => {
    provider.parseWebhookEvent({ rawBody, signatureHeader, webhookSecret: WEBHOOK_SECRET });
  });
});

test('a tampered Stripe signature is rejected — the same guard Slice 3/4 already prove, reconfirmed at the translation boundary', () => {
  const { rawBody } = signedStripeEvent('payment_intent.succeeded', 'pi_test_2');
  assert.throws(() => {
    provider.parseWebhookEvent({
      rawBody,
      signatureHeader: 't=1,v1=deadbeef',
      webhookSecret: WEBHOOK_SECRET,
    });
  });
});
