/**
 * ENG6 Slice 3 — unconditional unit tests for the D46 hard guard. Unlike
 * stripe.contract.test.ts (real network calls, skipped without sandbox credentials), this
 * file needs no credentials and no network — it must run in every environment, including CI,
 * because the guard it proves (a live-mode key is refused unconditionally) is the one thing
 * D46 requires to never depend on remembering to set VINKIN_STRIPE_SANDBOX_TEST.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSandboxModeKey,
  LiveModeStripeKeyRejected,
  loadStripeAdapterConfig,
} from './config.ts';

test('assertSandboxModeKey accepts a well-formed test-mode key', () => {
  assert.doesNotThrow(() => assertSandboxModeKey('sk_test_abc123'));
});

test('assertSandboxModeKey rejects a live-mode key', () => {
  assert.throws(() => assertSandboxModeKey('sk_live_abc123'), LiveModeStripeKeyRejected);
});

test('assertSandboxModeKey rejects a publishable key used by mistake', () => {
  assert.throws(() => assertSandboxModeKey('pk_test_abc123'), LiveModeStripeKeyRejected);
});

test('assertSandboxModeKey rejects a malformed/empty value', () => {
  assert.throws(() => assertSandboxModeKey(''), LiveModeStripeKeyRejected);
  assert.throws(() => assertSandboxModeKey('not-a-stripe-key'), LiveModeStripeKeyRejected);
});

test('loadStripeAdapterConfig throws when STRIPE_SECRET_KEY is missing', () => {
  assert.throws(
    () => loadStripeAdapterConfig({ STRIPE_WEBHOOK_SECRET: 'whsec_x' }),
    /STRIPE_SECRET_KEY is required/,
  );
});

test('loadStripeAdapterConfig throws when STRIPE_WEBHOOK_SECRET is missing', () => {
  assert.throws(
    () => loadStripeAdapterConfig({ STRIPE_SECRET_KEY: 'sk_test_abc123' }),
    /STRIPE_WEBHOOK_SECRET is required/,
  );
});

test('loadStripeAdapterConfig rejects a live-mode key even with a valid webhook secret', () => {
  assert.throws(
    () =>
      loadStripeAdapterConfig({
        STRIPE_SECRET_KEY: 'sk_live_abc123',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
      }),
    LiveModeStripeKeyRejected,
  );
});

test('loadStripeAdapterConfig returns both values for a valid sandbox config', () => {
  const config = loadStripeAdapterConfig({
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  });
  assert.deepEqual(config, { secretKey: 'sk_test_abc123', webhookSecret: 'whsec_x' });
});
