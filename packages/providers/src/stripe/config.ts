/**
 * ENG6 Slice 3 — the D46 hard guard (docs/architecture/06-milestone-0-gate.md's
 * Sandbox-only exception, docs/spec/decision-log.md D46): a live-mode Stripe key must fail
 * to boot, in every environment, not just be discouraged by convention. Stripe's own key
 * format makes this enforceable — every secret key is prefixed `sk_test_` (test/sandbox
 * mode) or `sk_live_` (live mode); this is Stripe's documented format, not an assumption.
 */

export class LiveModeStripeKeyRejected extends Error {
  constructor() {
    super(
      'STRIPE_SECRET_KEY must be a sandbox/test-mode key (sk_test_...) — ' +
        'the M0 gate (D46) permits sandbox-only Stripe integration; a live-mode key ' +
        '(sk_live_...) is refused unconditionally, in every environment.',
    );
    this.name = 'LiveModeStripeKeyRejected';
  }
}

/** Throws `LiveModeStripeKeyRejected` for anything that isn't unambiguously a test-mode
 * secret key — including a live key, a malformed value, or a publishable key used by
 * mistake. Never a warning, never a soft default: construction itself must fail. */
export function assertSandboxModeKey(secretKey: string): void {
  if (!secretKey.startsWith('sk_test_')) {
    throw new LiveModeStripeKeyRejected();
  }
}

export interface StripeAdapterConfig {
  secretKey: string;
  webhookSecret: string;
}

/** Reads and validates both required values from the given environment source (defaults to
 * `process.env`, injectable for tests) — fails closed (throws) on anything missing or
 * live-mode-shaped, mirroring this codebase's existing fail-fast config discipline
 * (`apps/api/src/config/env.ts`'s own boot-refusal checks). */
export function loadStripeAdapterConfig(
  source: Record<string, string | undefined> = process.env,
): StripeAdapterConfig {
  const secretKey = source.STRIPE_SECRET_KEY;
  const webhookSecret = source.STRIPE_WEBHOOK_SECRET;
  if (secretKey === undefined || secretKey.length === 0) {
    throw new Error('STRIPE_SECRET_KEY is required to construct StripeFinancialProvider');
  }
  if (webhookSecret === undefined || webhookSecret.length === 0) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required to construct StripeFinancialProvider');
  }
  assertSandboxModeKey(secretKey);
  return { secretKey, webhookSecret };
}
