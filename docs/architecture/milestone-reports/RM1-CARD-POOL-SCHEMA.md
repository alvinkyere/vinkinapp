# RM1 — Card Pool Schema + Domain Model

**Date:** 2026-07-28
**Scope:** first engineering slice of the Real-Money Beta plan (D47) — the reusable 15-card
pool's schema, domain model, and reservation/return mechanics, per
`docs/architecture/06-milestone-0-gate.md`'s new D47 sandbox exception.

## Decision recording, done first

Before any code: `docs/spec/decision-log.md` D47 records the owner's full Real-Money Beta
approval (funds flow, VinkIn-as-cardholder, the card pool, the dual-timer lifecycle,
wallet-only exposure, beta caps, dispute policy) plus two clarifications confirmed during
planning — participant payments capture immediately per payment (not held until the Vink
completes, a real change from today's engine), and authorizations are approved against the
assigned wallet token, not solely the underlying card. `docs/architecture/06-milestone-0-gate
.md` gained a second, narrow sandbox-only carve-out (alongside D46's existing one) explicitly
permitting Real-Money Beta architecture — including card-display UI, previously
unconditionally Forbidden — built and demoed against the sandbox provider only.
`docs/feasibility/funds-flow.md` (gate condition #3's own named evidence file) was rewritten
from a generic multi-provider placeholder to the actual decided VinkIn-owned-Financial-Account
architecture, with real timing measurements flagged as still pending the real Financial
Account's existence.

## Scope discipline: additive, not a cutover

RM1 lands new infrastructure — `cards`/`card_assignments`/`card_wallet_tokens` — entirely
additively. `temporary_cards` and the whole `provisionCardCommand`/`authorizeMerchant
PurchaseCommand`/`settlePurchaseCommand` one-shot-per-Vink flow are **untouched**; they keep
working exactly as before. This is the same "code-complete, not yet wired into the live path"
shape as ENG8's `vinkin_app` role and ENG6 Slice 4's webhook ingestion (built before Slice 5's
reconciliation processor read it) — RM2/RM3 will be the slices that actually cut the live
FUNDED-Vink flow over to this schema.

## What was built

**Migration `0024_card_pool.sql`**: `cards` (long-lived, reusable — the structural inverse of
`temporary_cards.vink_id UNIQUE NOT NULL`, which makes a card the permanent child of one
Vink), `card_assignments` (one row per Vink's use of a card; `UNIQUE(vink_id)` — a Vink is
assigned a card at most once — plus a partial `UNIQUE(card_id) WHERE status = 'ACTIVE'`,
together the actual DB-level enforcement of "a card belongs to one active Vink at a time," not
merely an application check), and `card_wallet_tokens` — deliberately its own table, not a
column on `card_assignments`, since D47's clarification makes the token, not the card, the
real authorization-time identity for a given assignment.

**Domain** (`packages/domain`): new branded IDs (`CardId`, `CardAssignmentId`,
`CardWalletTokenId`) and entity types (`Card`, `CardAssignment`, `CardWalletToken`, never
storing PAN/CVV — unchanged discipline from `TemporaryCard`). The Vink state machine gained
`CARD_WINDOW_EXPIRED` (`CARD_READY → FUNDING_REVERSAL`, emits `CardWindowExpired`) — the
card-phase half of D47's dual-timer lifecycle, reusing the existing wind-down-and-refund exit
shape `CARD_PROVISIONING_FAILED` already uses. The state machine's own exhaustiveness test
(`vinkTransitionTable().length` against a fixed expected list) caught this immediately, as
designed — updated, not weakened. `apps/api/src/realtime/message-mapping.ts`'s exhaustive
`Record<DomainEventName, ClientMessageType>` needed the new event too (a real, expected
consequence of D12's "every transition emits" discipline, caught by the type system, not a
test).

**Ports + adapters**: `VinkTx` gained 8 new card-pool methods (`reserveAvailableCard`,
`insertCardAssignment`, `getCardAssignmentForVink`, `getCardAssignmentForUpdate`,
`updateCardAssignment`, `releaseCardToPool`, `insertCardWalletToken`,
`getCardWalletTokenForAssignment`, `updateCardWalletToken`), implemented in both
`PostgresVinkStore` (real SQL, `FOR UPDATE SKIP LOCKED` for the reservation query — the same
concurrent-claim idiom the outbox publisher and reconciliation runner already use) and
`InMemoryVinkStore` (the unit-test double).

**Application commands** (`packages/application/src/card-pool.ts`): `reserveCardFromPool
Command` (atomically claims one AVAILABLE card, creates an ACTIVE assignment; the
`UNIQUE(vink_id)` constraint is the final guard, this is the pre-check ahead of it, per the
hard rule) and `returnCardToPoolCommand` (marks the assignment RETURNED and the card AVAILABLE
again — **only if the assignment's wallet token is confirmed REVOKED**; a missing token row
is treated the same as "not yet revoked," failing closed rather than assuming a missing row
means nothing to revoke; idempotent on an already-RETURNED assignment, matching this
codebase's "replay, don't re-execute" convention throughout the command layer).

## The security property, proven twice

D47's clarification — authorization is wallet-token-scoped, so a card must not become
reassignable until its previous holder's token is dead — is the one property this slice exists
to guarantee. Proven at two levels: `packages/application/src/card-pool.test.ts` (in-memory,
6 tests) walks a card through reserve → attempt-return-while-provisioned (fails) → revoke →
return → reserve-by-a-different-Vink (succeeds), asserting the second assignment gets a new
id on the same underlying card. `apps/api/src/card-pool.integration.test.ts` (real PostgreSQL,
2 tests) proves the identical property against the real adapter and real constraints, plus a
genuinely concurrent 5-way race for one seeded card (`Promise.allSettled`, not sequential) —
exactly one reservation succeeds, the other four see `CARD_POOL_EXHAUSTED`, and the database
shows exactly one `card_assignments` row — proving `FOR UPDATE SKIP LOCKED` is doing real work,
not just the application-layer pre-check.

## Tests

- `packages/domain`: **48/48** (state machine exhaustiveness test updated for the new
  transition, not weakened).
- `packages/application`: **143/143** (up from 137 — 6 new card-pool unit tests).
- `apps/api`: **271/271** (up from 269 — 2 new card-pool integration tests, including the real
  concurrent-race proof).

## Verification

- `pnpm typecheck`/`lint`/`format:check`/`guard`: clean, 12/12 packages.
- Both new test files run against real infrastructure where it matters (`packages/application`
  ones against the in-memory double for fast unit coverage, `apps/api`'s against real
  PostgreSQL with real HTTP-created Vinks via `app.inject()`, not synthetic fixtures).
- No orphaned test databases or stray processes after the run (confirmed directly).

## Known, disclosed gaps (explicitly out of RM1's own scope)

- **Not wired into the live FUNDED-Vink flow** — `provisionCardCommand` still mints a fresh
  one-shot card exactly as before. RM2 (provider interface: enable/disable + wallet-token
  provisioning/revocation, plus wiring `authorizeMerchantPurchaseCommand`'s decision to the
  presented token) and RM3 (the capture-on-payment funding-engine change) are the slices that
  actually cut the flow over.
- **No provider calls anywhere in this slice** — spending-controls configuration and real
  wallet-token provisioning/revocation are RM2/RM5's job; RM1's tests simulate the token
  lifecycle by writing directly to `card_wallet_tokens`, standing in for what RM2's provider
  calls will eventually drive.
- **No pool-seeding mechanism** (inserting the 15 real cards) — deliberately not built here;
  tests seed cards directly via SQL. Seeding real pool cards needs a real Stripe Issuing card
  per pool slot, which needs the account's Issuing capability (already confirmed clear per
  ENG6) but ultimately the Financial Account v2 wall ENG6 flagged and D47 now targets
  resolving — an owner-side Stripe action, not a code gap.
- **`CARD_WINDOW_EXPIRED` has no sweep triggering it yet** — the transition is real and
  tested at the state-machine level; RM4 is the slice that adds the actual 10-minute-window
  sweep query.

## Next

RM2 — provider interface: `enableCard`/`activateCard` (no inverse of `freezeCard` exists
today) plus `provisionWalletToken`/`revokeWalletToken`, touching the D7 conformance suite, the
mock, and the Stripe adapter together per the existing hard rule; cardholder identity moves
from per-organizer to VinkIn-as-cardholder; `authorizeMerchantPurchaseCommand`'s decision
logic gets the wallet-token check this slice's schema was built to support.
