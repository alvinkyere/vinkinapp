# ENG6 Slice 2 — Adapter Contract Hardening (+ M0 Gate Amendment)

**Date:** 2026-07-26
**Scope:** Provider error classification and typed decline reasons, as scoped by D45 (then
D46). Bundled with this slice: a real M0 gate amendment the owner directed mid-session,
reversing D45's original "do not amend" position after weighing a real distinction between
sandbox and live credentials.

## What Slice 1's audit already found true, re-confirmed here

Typed inputs/results and "no leaked provider shapes" were already fully met before this
slice — the `check-provider-imports.mjs` guard has passed clean every single time it's run
this entire session, across every prior milestone. This slice's real work was narrower than
its own name suggests: complete the error-classification vocabulary, which Slice 1 identified
as the one real gap.

## What was built

**`packages/payment-provider/src/errors.ts`**: three new `ProviderErrorCode` values —
`INVALID_REQUEST`, `COMPLIANCE_BLOCKED`, `UNKNOWN_OUTCOME` — with a doc comment explaining a
design choice made explicit, not assumed: a normal per-transaction decline ("this card was
declined for insufficient funds") is deliberately **not** modeled as a thrown `ProviderError`.
It's `AuthorizationResult.declineReason`, a typed return value — conflating "this transaction
was declined" with "this call itself failed" would make ordinary business outcomes look like
operational failures. `UNKNOWN_OUTCOME` is marked `retryable: true`, for the same reason
`PROVIDER_UNAVAILABLE` already is: retrying with the same idempotency key (§12) is always safe
regardless of which of the two actually happened.

**`packages/payment-provider/src/types.ts`**: `AuthorizationResult.declineReason` changed from
a bare `string` to a new typed `ContributionDeclineReason` union (`CARD_DECLINED` |
`INSUFFICIENT_FUNDS` | `COMPLIANCE_BLOCKED` | `EXPIRED_METHOD` | `GENERIC`) — confirmed safe by
grep before changing it: the field was never read anywhere outside the mock's own assignment,
so this was a pure hardening with zero real blast radius.

**`MockFinancialProvider`**: three new magic decline tokens (`tok_insufficient_funds`,
`tok_compliance_blocked`, `tok_expired_method`) alongside the existing `tok_decline`, so host
code and the conformance suite can exercise each `ContributionDeclineReason` distinctly, not
just "declined vs. not." A new `INVALID_REQUEST` check on `authorizeContribution` — the
interface's own doc comment on `metadata` already named `vinkId` as required; a real provider's
own request validation would reject a call missing it the same way. A new
`simulateUnknownOutcome(sideEffectHappened: boolean)` chaos hook, deliberately taking the
ground truth as a parameter rather than deciding it internally — real ambiguity has real ground
truth the caller just doesn't know yet, not a coin flip a test double gets to invent.

**Shared conformance suite** (`packages/payment-provider-contract-tests`): `ProviderTestKit`'s
`createCustomerAndMethod` behavior union grew the three new decline behaviors plus an optional
`simulateUnknownOutcome` hook (missing hook → skip, the suite's existing, established
discipline — never silently treated as equivalent to a plain decline). Five new tests, all
passing against the mock: each named decline reason exercised distinctly, `INVALID_REQUEST` on
missing metadata, and — the most involved — `UNKNOWN_OUTCOME` proven in both directions (side
effect didn't happen → same-key retry succeeds fresh; side effect did happen → same-key retry
replays the real committed result), because a caller receiving `UNKNOWN_OUTCOME` genuinely
cannot tell which occurred from the throw alone.

**A real, if minor, gap the new tests caught immediately**: the shared `authorize()` test
helper and two inline authorize calls in the existing suite built `metadata` without `vinkId`
— worked fine before this slice (nothing validated it), broke the instant `INVALID_REQUEST`
validation was added. Confirmed via `git grep` that this was a **shared helper problem**, not
20 independently-broken tests: one fix (adding `vinkId` to the helper's metadata) cascaded to
fix every dependent test at once.

## The M0 gate amendment (D46, supersedes D45)

Mid-slice, the owner reversed D45's "do not amend the M0 gate" direction, having identified a
distinction D45 hadn't drawn: Stripe issues sandbox/test-mode API keys freely, with no business
approval or commercial relationship required — genuinely decoupled from what the gate's ten
conditions actually govern (live funds-flow approval). `docs/architecture/06-milestone-0-gate.md`
now carries a new **Sandbox-only exception** section (full text in the file itself; summary):
sandbox-mode Stripe integration is permitted for technical validation and demos, with hard
guards — sandbox/test-mode credentials only in every environment including the demo (a
live-mode key must fail to boot, the same fail-fast discipline `JWT_SECRET`/`OPERATOR_PASSWORD`
already use), an isolated webhook endpoint/secret, and the codebase's existing off-by-default/
boot-refused-outside-dev-test flag discipline. This does **not** satisfy any of the ten gate
conditions and does **not** authorize real-money movement, live card issuance, consumer fund
custody, or public launch — the gate itself says so explicitly, not left to inference.

D45 is marked `SUPERSEDED (by D46)` in the decision log, not deleted or rewritten in place —
the historical record of what was decided, when, and why (including the reversal itself) is
preserved, matching this repo's own established decision-log discipline.

## Tests

- `packages/payment-provider-contract-tests/src/mock.contract.test.ts`: **25/25** (up from 20
  — 5 new).
- `packages/payment-provider/src/mock/mock-financial-provider.test.ts`: **14/14**, unchanged —
  confirms the new validation didn't regress the mock's own pre-existing direct test coverage.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, 10/10
  packages.
- `apps/api`: **221/221**, unchanged — confirms the `declineReason` type change and new
  `INVALID_REQUEST` validation don't affect any real application call site (none of them
  construct `authorizeContribution` metadata without `vinkId`, and none read
  `declineReason` today).
- `packages/application`: **137/137**, unchanged.

## Known, disclosed gaps

- `COMPLIANCE_BLOCKED` as a decline reason has no real backing yet — no KYC/compliance program
  exists in this codebase (confirmed in Slice 1's audit), so this is vocabulary completeness
  for when one does, not a working compliance check today.
- The M0 gate amendment's code-level hard guards (boot-refusal on a live-mode-shaped key,
  isolated webhook config) are **specified in the gate document now, not yet implemented** —
  that's Slice 3/4's job, not this slice's. This report doesn't claim the guards exist in code
  yet, only that the policy requiring them is now written down.

## Next

ENG6 Slice 3 — a real Stripe sandbox adapter. This needs real (free, sandbox-only) Stripe API
keys to build against an actual sandbox, the same kind of external-credential dependency ENG5's
Apple/Google slices hit — flagged to the owner before starting, not assumed available.
