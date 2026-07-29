# RM2 — Provider Interface: Enable/Disable + Wallet-Token Provisioning/Revocation

**Date:** 2026-07-29
**Scope:** second engineering slice of the Real-Money Beta plan (D47) — the provider-boundary
half of the card pool's lifecycle: enabling/disabling a pool card and provisioning/revoking
its wallet token, with the token — not the card — as the real authorization-time identity.
Builds directly on RM1's schema and security property
(`docs/architecture/milestone-reports/RM1-CARD-POOL-SCHEMA.md`).

## Scope discipline: additive, still not a cutover

Same discipline as RM1: `temporary_cards` and the live one-shot-per-Vink flow
(`provisionCardCommand`/`authorizeMerchantPurchaseCommand`/`settlePurchaseCommand`) are
untouched. RM2 makes the pool's own provider-boundary mechanics correct and fully tested in
isolation; wiring the live FUNDED-Vink flow onto this schema, and making
`authorizeMerchantPurchaseCommand`'s decision logic check the presented wallet token, both
remain RM3's job.

## What was built

**`FinancialProvider` interface** (`packages/payment-provider/src/provider.ts` +
`types.ts`, D7's hard rule — interface, mock, and Stripe adapter change together): `enableCard`
(no prior inverse of `freezeCard` existed), `freezeCard` renamed `disableCard` (a straight
rename, zero production call sites broke — confirmed by grep before renaming, not guessed),
`getCardStatus`, and four wallet methods (`createWalletProvisioningSession`,
`revokeWalletToken`, `getWalletToken`, `listWalletTokens`). `ProviderCapabilities` gained
`walletProvisioning: boolean` (§21/D7's hard rule: branch on the flag, never assume one
provider's capability). `WalletProvisioningPayload` deliberately keeps `provisioningData:
Record<string, unknown>` opaque rather than encoding Apple/Google-specific field names — a
provider-neutral shape, per the owner's own explicit caution during scoping.

**Mock provider**: `CardRecord.status` consolidated from an invented 4-value shape (which had
a `FROZEN` state Stripe's own vocabulary doesn't have) to the real 3-value
`'ACTIVE' | 'INACTIVE' | 'CLOSED'`; a new `WalletTokenRecord`/`walletTokens` map; a
`simulateChaosThenExecute` helper (mirroring the existing `idempotent()` wrapper, for the
PUT-style enable/disable/revoke operations that don't carry their own idempotency key) so the
existing `simulateUnknownOutcome` chaos hook works uniformly across all of RM2's new methods,
not just contribution authorization.

**Stripe adapter**: `enableCard`/`disableCard`/`getCardStatus` are real calls
(`cards.update`/`cards.retrieve`). All four wallet methods throw `NOT_SUPPORTED` with a
disclosed reason in the error message — verified live against the real sandbox this session
(see below), not guessed: card *creation* itself is still blocked on Stripe's v2 Financial
Account requirement (the wall ENG6 Slice 3/5 already documented), so there is no real card to
provision a wallet token against yet. `capabilities.walletProvisioning: false` for Stripe,
`true` for the mock — the D7 capability-flag discipline applied to a brand-new flag.

**Conformance suite** (`packages/payment-provider-contract-tests`): 5 new tests — enableCard
reverses disableCard, enableCard on a CLOSED card is `INVALID_STATE` not a silent success,
`getCardStatus` reports provider truth through the full lifecycle, THE SECURITY PROPERTY
(a revoked wallet token reports REVOKED and a fresh token for the same card is a genuinely
different id), and `createWalletProvisioningSession` on a non-ACTIVE card is `INVALID_STATE`.
31/31 pass against the mock (up from 26); against the real Stripe sandbox, 14/14 pass with 16
disclosed skips (up from 9/9 passing, 11 skips) — the 5 new RM2 skips are exactly the wallet/
enable-lifecycle tests, all skipped for the same documented reason (`walletProvisioning: false`
/ no issuing simulation available against a card that can't yet be created), not a defect.

**Migration `0025_card_provisioning_status.sql`**: `cards.status` gains `QUARANTINED` (a card
whose provider state is genuinely unknown after an ambiguous outcome, and which must never be
silently returned to `AVAILABLE`); `card_assignments` gains a new `provisioning_status` column,
deliberately layered *alongside* RM1's existing `status` column rather than merged into it —
merging would have required re-touching RM1's already-proven constraints/tests for no benefit.
The state chain (owner-specified, one deliberate simplification disclosed): `RESERVED →
ENABLING → AWAITING_WALLET_PROVISIONING → READY_TO_PAY`, and teardown `DISABLING →
TOKEN_REVOCATION_PENDING → SANITIZED`. `TOKEN_PROVISIONED` was folded into `READY_TO_PAY`
(nothing observes it as a separately persisted state) and `SETTLED` was omitted (that's RM3's
job, once spend actually happens through this schema) — both disclosed simplifications, not
silent drops.

**Application commands** (`packages/application/src/card-pool.ts`): `enableCardCommand`,
`provisionWalletTokenCommand`, `disableCardCommand`, `revokeWalletTokenCommand` — each
idempotent (a call finding the assignment already past its target state is a safe no-op, never
a duplicate provider call) and each funneling every provider call through
`callProviderOrQuarantine`, which quarantines the underlying pool card on a genuinely ambiguous
(`UNKNOWN_OUTCOME`) provider outcome. `returnCardToPoolCommand`'s own security gate (checking
the wallet token table directly) is unchanged from RM1 — deliberate, to avoid regressing RM1's
proven tests; RM2's `provisioning_status` sub-machine is tracking, not a second enforced gate.

## A real bug, caught by the live-Postgres integration test itself

The first implementation of `callProviderOrQuarantine` called `tx.quarantineCard(cardId)` and
then threw, both from inside `ctx.uow.run(async (tx) => {...})`. Running the real-Postgres
integration test for a genuinely ambiguous outcome failed: `cards.status` came back
`'RESERVED'`, not `'QUARANTINED'`. Root cause: throwing from inside `sql.begin(async (tx) =>
{...})` (what `ctx.uow.run` delegates to) rolls back the **entire** transaction, silently
undoing the `quarantineCard` write that had just happened — the identical defect class
`purchases.ts`'s own header comment already documents from PV3 (a reuse-revocation write
rolled back by throwing inside the same transaction). Fixed by having
`callProviderOrQuarantine` **return** a `ProviderCallOutcome<T>` (`{kind:'OK', value}` or
`{kind:'ERROR', error}`) instead of throwing; every RM2 command's `uow.run` callback now
returns `{assignment, providerOutcome}`, and only re-throws the error **after** the transaction
has committed. All four commands (`enableCardCommand`, `provisionWalletTokenCommand`,
`disableCardCommand`, `revokeWalletTokenCommand`) use this identical pattern. Re-running the
same integration test after the fix: `cards.status` correctly reads `'QUARANTINED'`.

A second, unrelated, much smaller defect surfaced by the same debugging pass: the integration
test's own `rm2_quarantine_other_${stamp}` username was 35 characters, over the real 32-character
username limit, causing an unrelated 400 on an otherwise-unrelated later assertion in the same
test. Fixed by shortening the literal to `rm2_q_other_${stamp}` (28 chars) — a test-authoring
bug, not a product or command-layer defect.

## The full re-assignment scenario, the owner's own specified completion test

Implemented at both layers, exactly as specified: Card A serves Vink 1 (reserve → enable →
provision Token 1), is fully torn down (disable → revoke Token 1 → return to pool), then
genuinely serves Vink 2 (reserve → enable → provision Token 2) — with the proof, at every step,
that Token 1 is REVOKED forever and only Token 2 is ACTIVE for the reused physical card.
`packages/application/src/card-pool.test.ts` proves it against the in-memory double (fast unit
coverage); `apps/api/src/card-pool.integration.test.ts` proves the identical scenario against
real PostgreSQL rows and the real `MockFinancialProvider` interface — including a real seeded
provider card (via `createCardholder` + `issueTemporaryCard`, then `disableCard`d to match
D47's "disabled by default" resting state for a pool card) and real HTTP-created Vinks via
`app.inject()`, not synthetic fixtures.

## Tests

- `packages/domain`: **48/48**, unchanged.
- `packages/application`: **147/147** (up from 143 — 4 new RM2 unit tests: enable progression +
  idempotency, provision-requires-enable-first, the full re-assignment scenario, and the
  ambiguous-outcome quarantine proof).
- `apps/api`: **273/273** (up from 271 — 2 new RM2 real-Postgres integration tests: the full
  re-assignment scenario and the ambiguous-outcome quarantine proof, the latter being the test
  that caught the transaction-rollback bug above).
- `packages/payment-provider-contract-tests`: **31/31** against the mock (up from 26); **14/14**
  pass with **16** disclosed skips against the real Stripe sandbox (up from 9/9 passing, 11
  skips) — 0 failures either way.

## Verification

- `pnpm typecheck`/`lint`/`format:check`/`guard`: clean, 12/12 packages.
- Every RM2-touching test file re-run after the transaction-rollback fix, not just typechecked:
  `packages/application/src/card-pool.test.ts` (10/10), `apps/api/src/card-pool.integration.
  test.ts` (4/4, real PostgreSQL), the shared conformance suite against both the mock and the
  real Stripe sandbox (`sk_test_` credentials in `apps/api/.env`), plus the full repo-wide
  `apps/api` suite (273/273, real PG + Redis service processes) and `packages/application`
  (147/147) and `packages/domain` (48/48) to confirm zero regressions elsewhere.

## Known, disclosed gaps (explicitly out of RM2's own scope)

- **Not wired into the live FUNDED-Vink flow** — same disclosure as RM1. RM3 is the slice that
  cuts the live flow over and wires `authorizeMerchantPurchaseCommand`'s decision logic to the
  presented wallet token (this slice built the token-lifecycle machinery that decision will
  check against, but does not yet touch `authorizeMerchantPurchaseCommand` itself).
- **Stripe wallet provisioning remains genuinely blocked**, not simulated: `walletProvisioning:
  false` and all four wallet methods throw `NOT_SUPPORTED` with a disclosed reason, verified
  live against the sandbox rather than assumed. This is downstream of the same Stripe v2
  Financial Account wall ENG6 Slices 3/5 already documented — an owner-side Stripe action, not
  a code gap.
- **No pool-seeding mechanism** still absent (RM1's own disclosed gap, unchanged) — real pool
  cards need the Financial Account wall resolved first.
- **`returnCardToPoolCommand`'s gate is unchanged from RM1** (checks the wallet-token table
  directly, not `provisioning_status`) — deliberate, to avoid touching RM1's already-proven
  tests; the two are documented as intentionally not merged into a single enforced gate in this
  file's own header comment.

## Next

RM3 — the capture-timing funding-engine change (capture immediately per contribution rather
than holding until the Vink completes) and wiring the live FUNDED-Vink flow onto this schema,
including making `authorizeMerchantPurchaseCommand`'s decision check the presented wallet
token rather than the card alone.
