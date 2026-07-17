# @vinkin/payment-provider-contract-tests

The shared conformance suite that **every** `FinancialProvider` adapter must run: Mock today;
Stripe, Lithic, and any future adapter when they exist. One suite, many adapters — an adapter
that hasn't passed this suite is not eligible to sit behind the orchestrator.

## What it verifies

Idempotent authorization (replay + conflict + transient-failure retry + lost-response retry),
decline normalization, cancel-before-capture, partial capture, capture-over-authorization
rejection, multiple-capture capability honesty, refund limits, authorization expiry, delayed
resolution with provider-truth reads, duplicate webhook identity, out-of-order event
recoverability, webhook signature verification, card spend-limit and duplicate-authorization
enforcement, MCC blocks, and freeze/close behavior. Each test names the Spec section it
enforces.

## How adapters plug in

An adapter provides a `ProviderTestKit` (see `src/test-kit.ts`): the provider instance, a
fixture factory, and whichever simulation hooks its environment can support. Missing hooks
**skip** the dependent tests — skips are visible coverage gaps and must be justified in the
adapter's README, never ignored.

```ts
runFinancialProviderContractTests('StripeFinancialProvider', makeStripeSandboxKit);
```

Capability-dependent tests gate on `provider.capabilities` — the application never assumes a
capability because one provider has it (Spec §21).

## Running

```bash
cd packages/payment-provider-contract-tests && npm test   # Node ≥ 23.6, no install needed
```

Note: source files import `@vinkin/payment-provider` by relative path
(`../../payment-provider/src/...`) until the pnpm workspace lands in Milestone 1; switch the
imports to the package specifier then.
