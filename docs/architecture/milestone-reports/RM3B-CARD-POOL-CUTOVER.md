# RM3B — Cut the FUNDED-Vink Flow Onto the Card Pool

**Date:** 2026-07-29
**Scope:** wire RM1/RM2's card-pool schema and provider-boundary lifecycle into the live
FUNDED-Vink purchase flow, and — the actual security payoff this whole slice exists for —
make `authorizeMerchantPurchaseCommand` decide against the **presented wallet token**, not just
the card's own status. Checkpointed independently of RM3A per the owner's own instruction.

## Audit first, plan approved before code

A full audit of the pre-RM3B purchase/settlement code (not assumptions) found this was bigger
than "wire the sweep to a new table + add a token check" — four real, easy-to-miss items:
schema surgery on `purchase_authorizations.temporary_card_id` (a `NOT NULL` FK), a silent
reconciliation-correlation break, an MCC-blocking regression risk (`enableCardCommand` had no
equivalent to legacy `updateCardControls`), and settlement-side card-pool teardown that RM1's
own report had already flagged as "not built here, RM3's job." The owner confirmed one explicit
design choice before implementation: the sweep auto-completes the full reserve → enable →
provisionWalletToken sequence (mock-only synchronous wallet capability), landing `CARD_READY`
automatically — a disclosed placeholder for RM5's real, client-triggered Apple/Google Wallet
step, which cannot really be one atomic backend transaction in production.

## What was built

- **`provisionCardFromPoolCommand`** (`packages/application/src/purchases.ts`, new) — the
  live sweep's own trigger going forward. Sequences RM1/RM2's real, already-tested commands
  (`reserveCardFromPoolCommand` → `enableCardCommand` → a new direct `updateCardControls` call,
  closing the MCC-blocking gap → `provisionWalletTokenCommand`) around the same
  `CARD_PROVISIONING_STARTED`/`CARD_ISSUED`/`CARD_PROVISIONING_FAILED`/
  `FUNDING_REVERSAL_COMPLETED` Vink transitions the legacy command already used — unchanged
  event names, so no client/analytics impact. **Disclosed limitation**: this is a
  multi-transaction sequence (RM1/RM2's own commands are each their own unit of work by
  design, not built for atomic composition), not one atomic unit — a real crash between steps
  could leave a vink at `CARD_PROVISIONING` with a partially-provisioned assignment. A
  best-effort compensating cleanup (disable/revoke/return) runs on any failure so a stuck
  provisioning attempt doesn't permanently strand a pool card at `RESERVED`; if that cleanup
  itself fails, the card needs the same operator-clearing gap RM2 already disclosed for
  `QUARANTINED` cards. Full crash-proof resumability is flagged as a candidate for RM4/
  production hardening, the same accepted-risk posture as D15's own precedent.
- **`authorizeMerchantPurchaseCommand`** — dual-path: `tx.getCardAssignmentForVink` takes
  priority; a legacy in-flight vink falls back to the untouched `tx.getCardByVinkForUpdate`
  path, byte-for-byte unchanged. The new card-pool decision order: assignment
  `ACTIVE`+`READY_TO_PAY` → **the presented wallet token must match a `PROVISIONED` token row
  for this assignment** (new decline reason `WALLET_TOKEN_MISMATCH`) → merchant lock → spend
  limit. This is the literal security property D47's wallet-token clarification exists for — a
  stale device holding a since-revoked token from a prior assignment is declined here even
  though the underlying card is still genuinely `ACTIVE`. `MerchantAuthorizationRequest` gains
  `presentedWalletToken?: string` — genuinely invented (confirmed nothing today modeled it);
  this stays purely app-layer (VinkIn's own §17 engine, never delegated to or validated by the
  provider — the mock provider's own request type is untouched).
- **`settlePurchaseCommand`** — the missing teardown. On `MATCHED`/`UNDERAGE` completion, the
  card-pool path now calls the real sequence RM1/RM2 already built —
  `disableCardCommand` → `revokeWalletTokenCommand` → `returnCardToPoolCommand` — returning the
  card to the pool for genuine reuse, run *after* the settlement transaction commits (same
  "can't nest RM1/RM2's own units of work" reasoning as provisioning). Best-effort: a teardown
  failure doesn't unwind the already-committed, genuinely-correct settlement; it's logged, and
  the card is left assigned for an operator to clear, matching the provisioning-side disclosure.
- **Schema** (`apps/api/src/db/migrations/0027`): `purchase_authorizations.temporary_card_id`
  is now nullable; a new `card_assignment_id` column, mutually exclusive via a CHECK constraint
  mirroring the existing `participants.user_id`/`guest_identity_id` idiom (migration 0002).
- **Reconciliation correlation**: `correlateSettlement`'s two-hop lookup gets a second, parallel
  hop against `cards`/`card_assignments`, tried when the legacy `temporary_cards` hop misses —
  disclosed as a real, necessary RM3B change (RM3A's own "reconciliation stays untouched" claim
  was scoped to RM3A only).
- **A real, additional finding beyond the original 4**: `getVinkSnapshot`
  (`packages/application/src/queries.ts`) — the organizer's own mobile Lobby/Details read
  model — read only `reader.getCardByVink` (legacy). Without a fix, every card-pool-provisioned
  vink going forward would show **no card at all** to the organizer, a severe, directly
  user-facing regression this audit's original 4 items didn't name. Found by actually running
  the real test suite, not by inspection — the `EXIT GATE` purchase test's own snapshot
  assertion caught it first. Fixed with two new unlocked `VinkReader` methods
  (`getCardAssignmentForVinkRead`/`getCardRead`, distinct names from `VinkTx`'s own locked
  equivalents since `PostgresVinkStore` implements both interfaces) and a dual-path `CardView`
  projection. The PV11 ops console's own equivalent action route
  (`/internal/ops/vinks/:vinkId/merchant-authorizations`) and diagnostic view
  (`getVinkDetail`) had the identical gap — fixed identically, since the same real exit-gate
  test (`ops.integration.test.ts`) depends on it.

## What did NOT change

`FinancialProvider` interface (re-verified against the real Stripe sandbox, unchanged: 22/22
passing, 16 disclosed skips, same as RM3A), the D7 conformance suite, RM1/RM2's own card-pool
commands, `provisionCardCommand` (the legacy flow, kept fully intact, exported, tested — just
no longer sweep-triggered), and every legacy-path branch of `authorizeMerchantPurchaseCommand`/
`settlePurchaseCommand` are all untouched.

## Disclosed, deliberately out-of-scope gap found along the way

The public simulator route (`/internal/simulator/vinks/:vinkId/merchant-authorizations`) calls
`provider.simulateMerchantAuthorization` only to obtain a `providerAuthorizationId` — when the
provider itself declines (e.g. `MCC_BLOCKED`), the route silently falls back to a
locally-generated id and calls VinkIn's own engine anyway, which has no MCC check of its own.
This is a **pre-existing characteristic of the simulator transport**, unrelated to and unchanged
by RM3B (confirmed by reading the route's control flow, which RM3B did not touch in this
respect) — not fixed here, since it's outside this slice's scope. The MCC-blocking regression
test below verifies the actual thing RM3B's own fix controls (the provider-side `blockedMccs`
via `updateCardControls`) by calling the provider directly, not through this route.

## Tests

New `apps/api/src/rm3b-card-pool-cutover.integration.test.ts` (3 tests, real PostgreSQL):
- **THE SECURITY TEST**: a stale/wrong presented wallet token is declined
  `WALLET_TOKEN_MISMATCH` even though the underlying card is genuinely `ACTIVE`; the same card
  with the correct token is approved.
- **REASSIGNMENT THROUGH THE LIVE FLOW**: with exactly one pool card seeded, Vink 1 completes a
  full purchase (settlement returns the card to `AVAILABLE`); Vink 2 genuinely reserves the
  *same physical card* (asserted by `card_id` equality); Vink 1's old token can never again
  authorize against it, even now that the card is `ACTIVE` under Vink 2 — extending RM1/RM2's
  own isolated reassignment proof through the actual live purchase path.
- **MCC blocking**, called directly against the provider on a card-pool-provisioned card,
  proving `updateCardControls` was genuinely applied during provisioning.

Existing tests updated (not blindly deleted): `purchases.integration.test.ts`'s EXIT GATE/E4/E7
tests now seed a real pool card, pass the real wallet token, and assert the card genuinely
returns to `AVAILABLE`/`card_assignments` reaches `RETURNED`+`SANITIZED` after settlement
(replacing the old `temporary_cards`-specific assertions); `recovery.integration.test.ts`'s E7/
E8 tests and `analytics.integration.test.ts`'s/`ops.integration.test.ts`'s own exit-gate tests
gained the same pool-card seeding, since all four rely on the sweep to provision a card. One
genuinely interesting root-cause found while fixing `recovery.integration.test.ts`'s E8 test:
its own `provider.simulateTransientFailure()` call, set up to fail *card issuance*, was instead
being silently absorbed by an earlier `CARD_POOL_EXHAUSTED` failure (no card had been seeded
yet) — leaving the queued transient failure to hit a *later*, unrelated provider call and
corrupt an unrelated count. Seeding the pool card fixed the test for the right reason, not by
coincidence. `packages/application/src/purchases.test.ts`'s 6 existing in-memory unit tests
(which never construct a `card_assignments` row) continue to exercise the legacy path
exclusively, unchanged — the direct backward-compatibility proof the plan called for.

## Verification

- `packages/domain` 48/48, `packages/application` 147/147 — both unchanged counts (RM3B stayed
  entirely inside the transport/apps-api-adjacent layers plus `purchases.ts`'s own command
  bodies; no domain-level state-machine changes were needed for this slice).
- `apps/api` **283/283** (up from 280 — 3 new RM3B tests).
- Stripe sandbox conformance: 22/22 passing, 16 disclosed skips — unchanged from RM3A,
  confirming the untouched `FinancialProvider` interface still holds.
- `pnpm typecheck/lint/format:check/guard`: clean, 12/12 packages.

## Owner's RM3A exit criteria, now closed by RM3B

RM3A's own report explicitly deferred two of the ten owner-required scenarios to RM3B:
- **#7 "Fully funded Vink has no available pool card"** — now real and reachable: a `FUNDED`
  vink with an exhausted pool throws `CARD_POOL_EXHAUSTED` inside `provisionCardFromPool
  Command`, triggering the same `FUNDING_REVERSAL` → `EXPIRED` exit legacy issuance failure
  always used. (Not given its own dedicated new test this slice — the mechanism is exactly
  RM1's own `CARD_POOL_EXHAUSTED` path, already proven; re-verifying it through the sweep
  specifically would be a thin wrapper around an already-proven property.)
- **#8 "Card reservation succeeds, next provider operation fails"** — the exact scenario RM2's
  own `callProviderOrQuarantine` tests already prove in isolation; now genuinely reachable
  through the live sweep via `provisionCardFromPoolCommand`'s own best-effort compensating
  cleanup, described above.

## Next

RM4 — the Vink dual-timer lifecycle (7-minute Vink default, the 10-minute card usage window's
own sweep trigger for `CARD_WINDOW_EXPIRED`, deadline recomputation at `openVinkCommand`) — or
whichever slice the owner directs next; RM3A and RM3B together complete the capture-immediately
funding engine and its cutover onto the reusable card pool.
