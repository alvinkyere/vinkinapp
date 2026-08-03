# Milestone Report — PV6 (Mock Card and Purchase Flow)

Date: 2026-07-18 · Track: product validation (D10) · §45 report format.

## What was implemented

- **`packages/ledger`**: three purchase postings (Plan §18) — authorization reserve
  (DR reserve / CR session_funding), reserve release (reversal), settlement expense
  (DR vink_purchase_expense / CR reserve). All balanced by construction.
- **Migration 0005**: `temporary_cards` (one per vink UNIQUE; `display_last_four` CHECK, no
  PAN/CVV columns exist), `purchase_authorizations` (partial UNIQUE on
  `provider_authorization_id` — the E4 dedupe), `settlements`.
- **`packages/application` purchase engine** (`purchases.ts`), all D12/D13:
  - `provisionCardCommand`: FUNDED → CARD_PROVISIONING (TemporaryCardRequested) →
    provider `createCardholder`/`issueTemporaryCard`(limit = funded, Plan §16)/
    `updateCardControls`(cash-like MCC blocks) → card ACTIVE → CARD_READY. Provider failure
    → CARD_PROVISIONING_FAILED → FUNDING_REVERSAL → EXPIRED (the machine's dead-end exit),
    card FAILED. **Provider reached only through the neutral interface.**
  - `authorizeMerchantPurchaseCommand`: **VinkIn's §17 decision from domain state** — E4
    dedupe on providerAuthorizationId; then card ACTIVE → CARD_READY → first-merchant lock
    (unlocked or same merchant) → spend limit. Approve: record authorization, set card
    `merchant_lock_key` + vink LOCKED in the same txn, CARD_READY → PURCHASE_AUTHORIZED
    (MerchantAuthorizationApproved + MerchantLocked), post reserve. Decline: record + event,
    no state change.
  - `reverseAuthorizationCommand`: PURCHASE_AUTHORIZED → CARD_READY, release reserve.
  - `settlePurchaseCommand`: PURCHASE_AUTHORIZED → SETTLING (PurchaseCaptured) → expense =
    min(settled, approved) posting + release unused reserve; MATCHED/UNDERAGE → close mock
    card (`provider.closeCard`) → COMPLETED; OVERAGE → SETTLEMENT_OVERAGE_DETECTED →
    RECOVERY_REQUIRED (recovery obligation + charging is PV7).
- **`apps/api`**: simulator-only purchase routes (provision-card, merchant-authorizations,
  authorizations/:id/reverse, authorizations/:id/capture) — the merchant *simulation* calls
  the mock's provider-side helpers to get a providerAuthorizationId, then invokes the
  engine; environment-allowlisted (governance §5). Card view added to the organizer vink
  snapshot (status, last four, spending limit, merchant-locked — clearly a simulation). The
  deadline sweep now also provisions cards for FUNDED vinks (the §16 pipeline); provisioning
  failure is self-recording. Postgres store methods for cards/authorizations/settlements.

## Files changed

New: `packages/application/src/purchases.ts` + `purchases.test.ts`,
`apps/api/src/modules/purchases/routes.ts`,
`apps/api/src/db/migrations/0005_cards_purchases.sql`,
`apps/api/src/purchases.integration.test.ts`, this report. Modified: ledger
`postings.ts`/test, application `ports/index/queries/testing/in-memory`, domain `entities.ts`
(`providerAuthorizationId: string | null`), api `store/app/jobs/sweeps`, docs statuses.

## Database changes

Migration 0005 (above). Ledger triggers from PV5 now also guard the reserve/settlement
postings — verified balanced end-to-end.

## APIs added

Simulator (allowlisted envs only): `POST /internal/simulator/vinks/:vinkId/provision-card`,
`.../merchant-authorizations`, `POST /internal/simulator/authorizations/:id/reverse`,
`.../capture`. Plus `card` on the existing `GET /api/v1/vinks/:vinkId` snapshot.

## UI added

None (the card view is the API contract PV9 renders; "clearly labeled as simulation" is a
PV9 UI obligation, satisfied at the data layer by the mock last-four + status).

## Tests added

18 new (1 ledger + 6 application + 4 integration + fixtures; totals: **132 unit + 37
integration**, all green vs real local PostgreSQL 16):
- Ledger: reserve/release/settlement shapes + balance.
- Application (real mock provider): E1 full FUNDED→COMPLETED with balanced ledger, closed
  card, and the event set; **exit gate — exactly one purchase (E4 duplicate → DUPLICATE,
  one row)**; first-merchant lock declines a second merchant; over-limit decline; reversal
  nets the reserve to zero; E7 overage → RECOVERY_REQUIRED with variance; provisioning
  requires FUNDED.
- Integration (**PV6 exit gate**): FUNDED → card via the real sweep → snapshot shows the
  card → merchant authorization → capture → COMPLETED, card CLOSED, ledger balanced, full
  event set; E4 (a second swipe on the locked card is declined, exactly one APPROVED row);
  E7 overage → RECOVERY_REQUIRED with participants' contributions unchanged (not
  recharged); merchant auth with no card → 404.

## Known limitations

1. Provider calls still run inside the DB transaction (mock-only pattern; the standing D10
   flag from PV5 — real adapters need outbox-driven provider orchestration).
2. The merchant simulation route mints a fresh providerAuthorizationId per call, so the E4
   *duplicate provider id* path is proven at the unit layer (engine dedupe) and the
   integration layer proves the equivalent guarantee via the first-merchant lock (a second
   swipe cannot produce a second approval). A true duplicate-webhook replay lands with the
   PV11 ops console / real webhook ingestion.
3. Settlement variance detection is implemented; the **recovery obligation, organizer
   charging, and restriction** are PV7 (E7's second half). RECOVERY_REQUIRED is a terminal
   observable state for PV6.
4. Card `display_last_four` is the mock's constant `4242`; a real adapter returns the issued
   value.
5. `provisionCard` is idempotent only via the one-card-per-vink UNIQUE (a concurrent double
   provision loses one with a unique violation, which the sweep swallows) — fine for the
   validation build.

## Security review

- No PAN/CVV columns exist on `temporary_cards`; only a four-digit display value (schema +
  domain `assertCardDisplaySafety`).
- First-merchant lock is enforced inside the row-locked authorization transaction; the
  spend limit is checked from domain state (card `spending_limit`), never delegated.
- E4 dedupe is a partial UNIQUE index — a second identical provider authorization cannot
  create a second approval even under concurrency.
- All PV6 routes are simulator-only (allowlist-gated); none are reachable in
  staging/production.
- Every transition is one row-locked unit of work with its outbox event (D12); the ledger's
  balanced/append-only triggers remain the final guard.

## Next milestone

**PV7 — Recovery and Refunds**: settlement-overage recovery obligation + organizer
charging (off-session via the mock's `offSessionRecovery` capability), organizer
restriction (FinancialAccount RESTRICTED), failed-session refunds (E2/E8 — refund captured
contributions on EXPIRED, retry-refund job), manual-review states. Owner actions unchanged:
push (CI), Docker Desktop for local Redis job paths.
