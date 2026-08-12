import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paymentModeInfo } from './payment-methods.ts';

describe('paymentModeInfo (RM4C-B, D49)', () => {
  it('mock mode: card is available, publishable key is null', () => {
    const info = paymentModeInfo({ financialProvider: 'mock', stripePublishableKey: null });
    assert.equal(info.mode, 'mock');
    assert.equal(info.publishableKey, null);
    const card = info.methods.find((m) => m.type === 'card')!;
    assert.equal(card.availability, 'available');
    assert.equal(card.unavailableReason, undefined);
  });

  it('stripe_sandbox mode: card is available and the publishable key passes through', () => {
    const info = paymentModeInfo({
      financialProvider: 'stripe_sandbox',
      stripePublishableKey: 'pk_test_abc',
    });
    assert.equal(info.mode, 'stripe_sandbox');
    assert.equal(info.publishableKey, 'pk_test_abc');
    const card = info.methods.find((m) => m.type === 'card')!;
    assert.equal(card.availability, 'available');
  });

  it('a stripePublishableKey is ignored (never leaked) outside stripe_sandbox mode', () => {
    const info = paymentModeInfo({
      financialProvider: 'mock',
      stripePublishableKey: 'pk_test_should_not_appear',
    });
    assert.equal(info.publishableKey, null);
  });

  it('THE REQUIRED INVARIANT: every non-available method carries a truthful, non-empty reason — never a button with no explanation', () => {
    const info = paymentModeInfo({ financialProvider: 'mock', stripePublishableKey: null });
    for (const method of info.methods) {
      if (method.availability !== 'available') {
        assert.ok(
          typeof method.unavailableReason === 'string' && method.unavailableReason.length > 0,
          `${method.type} (${method.availability}) must carry a non-empty unavailableReason`,
        );
      } else {
        assert.equal(method.unavailableReason, undefined);
      }
    }
  });

  it('Apple Pay is requires_configuration (no merchant ID/entitlements exist); Venmo/Cash App Pay are coming_soon (no approved adapter exists)', () => {
    const info = paymentModeInfo({ financialProvider: 'mock', stripePublishableKey: null });
    assert.equal(
      info.methods.find((m) => m.type === 'apple_pay')!.availability,
      'requires_configuration',
    );
    assert.equal(info.methods.find((m) => m.type === 'venmo')!.availability, 'coming_soon');
    assert.equal(info.methods.find((m) => m.type === 'cash_app_pay')!.availability, 'coming_soon');
  });
});
