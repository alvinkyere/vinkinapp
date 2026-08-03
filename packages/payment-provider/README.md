# @vinkin/payment-provider

The provider-neutral financial interface (Spec §43) and the `MockFinancialProvider` — the code
deliverable of **Milestone 0** (`docs/architecture/05-milestone-sequence.md` §2).

## What this package is

- `src/provider.ts` — the frozen `FinancialProvider` interface: §43's method set plus
  `parseWebhookEvent` (additive extension, recorded in `docs/architecture/00` §2.3.4).
  Contract rules every adapter must satisfy are documented on the interface.
- `src/types.ts` — neutral inputs/results. Integer minor units only; no provider SDK types.
- `src/operation-ids.ts` — the §12 stable operation-identity builders. The only legal way to
  mint idempotency keys.
- `src/errors.ts` — neutral error taxonomy (`IDEMPOTENCY_CONFLICT`, `INVALID_STATE`, …).
- `src/mock/` — in-memory adapter implementing the full contribution lifecycle
  (authorize → capture/cancel → refund), issuing substrate (cards, controls, merchant
  auth/capture simulation), async-resolution modeling (`tok_pending`), definitive declines
  (`tok_decline`), HMAC-signed webhook parsing, and duplicate-event simulation (§28).

## Running the tests

Requires Node ≥ 23.6 (native TypeScript type-stripping; this machine runs Node 25). No install
needed:

```bash
cd packages/payment-provider && node --test "src/**/*.test.ts"
```

`npm run typecheck` additionally requires `npm install` (TypeScript ^5.7 for
`erasableSyntaxOnly`).

## Rules

1. **No provider SDK imports outside adapter subdirectories** (§42/§43). The Stripe adapter,
   when it exists, lives in `src/stripe/` and is the only place `stripe` may be imported.
2. Real adapters must pass the same behavioral suite as the mock — when the first real adapter
   lands, extract the lifecycle tests into a shared conformance suite and run it against both.
3. Missing provider capability = `ProviderError('NOT_SUPPORTED')`, surfaced and documented —
   never silently emulated (§9).
