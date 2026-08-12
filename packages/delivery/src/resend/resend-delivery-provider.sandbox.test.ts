/**
 * RM4D — proves `ResendDeliveryProvider` actually delivers through the real Resend API, not
 * just that it compiles against a fake client (see `resend-delivery-provider.test.ts` for the
 * offline suite CI runs). Mirrors `packages/providers/src/stripe/stripe.contract.test.ts`'s
 * own `VINKIN_STRIPE_SANDBOX_TEST`-gated pattern: skipped entirely unless explicitly opted in,
 * since this makes a real network call to api.resend.com and cannot run offline/CI without
 * real credentials.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadResendAdapterConfig } from './config.ts';
import { ResendDeliveryProvider } from './resend-delivery-provider.ts';

const RUN = process.env.VINKIN_RESEND_SANDBOX_TEST === '1';

describe('ResendDeliveryProvider (real Resend API)', { skip: !RUN }, () => {
  it('delivers a real guest-invite email and the API accepts it with a real message id', async () => {
    const config = loadResendAdapterConfig();
    const recipient = process.env.VINKIN_RESEND_TEST_RECIPIENT;
    if (recipient === undefined || recipient.length === 0) {
      throw new Error('VINKIN_RESEND_TEST_RECIPIENT is required when VINKIN_RESEND_SANDBOX_TEST=1');
    }
    const provider = new ResendDeliveryProvider(config, { isProduction: false });

    const result = await provider.send({
      destination: recipient,
      method: 'EMAIL',
      template: {
        kind: 'guest_invite',
        organizerName: 'Alvin (RM4D real-delivery proof)',
        purpose: 'RM4D real-delivery verification',
        yourShareMinor: 4_200,
        deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        link: 'https://join.vinkin.org/g/rm4d-real-delivery-proof',
      },
    });

    assert.equal(result.accepted, true, `expected acceptance, got: ${result.failureReason}`);
    assert.ok(result.providerMessageId, 'a real Resend send returns a provider message id');
    console.log(
      'RM4D real-delivery proof: accepted, providerMessageId =',
      result.providerMessageId,
    );
  });
});
