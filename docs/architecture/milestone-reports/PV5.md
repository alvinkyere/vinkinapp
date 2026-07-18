# Milestone Report — PV5 (Mock Contribution Flow)

Date: 2026-07-18 · Track: product validation (D10) · §45 report format.

## What was implemented

- **`packages/ledger`** (new, zero-dep — D2's ledger-core): the Plan §18 account set,
  balanced posting builders (contribution capture, session funding move, refund reversal),
  `assertBalanced` (positive integers, debits = credits, never empty).
- **Migration 0004**: `contributions` (attempt numbers, UNIQUE idempotency key — PostgreSQL
  is the final §12 guard — and a **partial UNIQUE index: one live contribution per
  participant**, the exit-gate's double-count guard), `contribution_status_history`,
  `ledger_accounts` (seeded with the ten §18 codes), `ledger_transactions`,
  `ledger_entries` with **two triggers**: append-only (UPDATE/DELETE raise) and a
  DEFERRABLE constraint trigger proving debits = credits per transaction at commit.
- **`packages/application` contribution engine** (`contributions.ts`):
  - `authorizeContributionCommand`: vink row lock → participant/allocation guards (§4.7
    `assertWithinApprovedMaximum` before any provider call) → contribution CREATED →
    AUTHORIZATION_PENDING (D12 events throughout) → provider authorize through the
    **neutral interface only** (Spec §12 operation ids; mock scenarios ride on payment-method
    tokens). Outcomes: AUTHORIZED (fast-path check), DECLINED (terminal; retry = new
    attempt, new key), PROCESSING (stays pending), PROVIDER_UNAVAILABLE →
    RESOLUTION_PENDING (E5). A live contribution replays idempotently on double-tap.
  - **`resolveFunding` — the D5 single resolver**: the only code firing
    FUNDING_CONFIRMED/FUNDING_FAILED. All-authorized → capture each (provider capture +
    two ledger postings per contribution + CAPTURED) → funded amount = required → FUNDED.
    Unresolved attempts + grace not expired → WAITING. Otherwise → cancel every hold at the
    provider (pendings time out → RESOLUTION_PENDING → RESOLVED_CANCELLED) → EXPIRED.
    Zero unresolved attempts at close → immediate decision (doc 03 fast path).
  - `closeSubmissionsCommand` / `resolveGraceCommand`: deadline job bodies —
    **PostgreSQL timestamps decide; schedulers only schedule** (Plan §10); late/duplicate
    firings are no-ops.
  - `resolveContributionCommand`: reconciliation by provider-side truth
    (`retrievePaymentStatus`); lost responses replay the ORIGINAL idempotency key — the
    provider returns the executed result without a second charge (E5).
  - Allocation-shape commands (split/cover/remove) now **lock once a live contribution
    exists** — an authorized amount must keep matching its allocation or the resolver could
    never conclude.
- **`apps/api`**: contribution routes (user + guest token authorize, resolve/retry),
  scenario controls gated by the governance §5 allowlist (403 `SCENARIO_NOT_PERMITTED`
  outside it), simulator endpoints (`run-deadlines` with test-only now-override,
  `resolve-pending` for 3DS-style late confirmation — registered only in allowlisted envs
  and only for the mock), `runSweeps` job body + BullMQ scheduler (runs in the API process —
  the mock is in-memory; moves to the worker with a real adapter), store methods for
  contributions/history/ledger (application-side `assertBalanced` plus the DB trigger).

## Files changed

New: `packages/ledger/**` (4 files + test), `packages/application/src/contributions.ts` +
`contributions.test.ts` + `support/contribution-transition.ts`,
`apps/api/src/modules/contributions/routes.ts`, `apps/api/src/jobs/sweeps.ts`,
`apps/api/src/db/migrations/0004_contributions_ledger.sql`,
`apps/api/src/contributions.integration.test.ts`, this report.
Modified: application `ports/index/commands/testing/in-memory`, domain `entities.ts`
(+`attemptNumber`), api `store/app/server`, docs statuses.

## Database changes

Migration 0004 (above). The ledger's invariants live in the DATABASE, not just code:
append-only trigger + deferred balance trigger, both integration-tested.

## APIs added

`POST /api/v1/vinks/:vinkId/contributions/authorize`, `POST
/api/v1/guest/contributions/authorize`, `POST
/api/v1/vinks/:vinkId/contributions/:contributionId/resolve`; simulator (allowlisted envs):
`POST /internal/simulator/vinks/:vinkId/run-deadlines`, `POST
/internal/simulator/contributions/:contributionId/resolve-pending`.

## UI added

None (PV9–PV11).

## Tests added

22 new (4 ledger + 8 application + 6 integration + fixes; totals: **125 unit + 33
integration**, all green — integration against real local PostgreSQL 16):
- Ledger: posting shapes, balance across builders, unbalanced/empty/zero/float rejection.
- Application (real `MockFinancialProvider` in-memory): funded fast path with balanced
  ledger + event set; decline → attempt 2 with fresh key; double-tap replay; delayed →
  WAITING → late confirm → FUNDED; grace expiry → EXPIRED with provider-side holds
  CANCELED and **zero ledger postings**; E5 lost-response replay (exactly one
  `payment.authorized` at the provider); split locked after contribution; FORBIDDEN/
  non-OPEN guards.
- Integration: funded journey (FUNDED, funded=required, CAPTURED×2, debits=credits=24000,
  SubmissionsClosed/ProcessingGraceStarted/ContributionCaptured/VinkFunded in the outbox);
  **EXIT GATE: six concurrent double-taps → exactly one non-replayed response, one row,
  funded = required exactly**; decline+deadline via the real sweep body → EXPIRED at close
  (zero unresolved = immediate decision) with idempotent late re-runs; E5 via API;
  delayed→pending-resolve→FUNDED during grace; **ledger append-only UPDATE rejected and
  unbalanced transaction rejected at commit by the DB itself**.

Two engine defects were caught by tests during the pass (stale row snapshots returned after
the resolver advanced them) and fixed before anything shipped.

## Known limitations

1. **Provider calls run inside the DB transaction** — safe only because the mock is
   in-process. A real adapter requires outbox-driven, two-phase provider orchestration;
   flagged prominently in the engine header and D10's revisit trigger.
2. Provider customer/method ids are re-derived idempotently per call, not persisted; mock
   state is per-process (an API restart forgets provider-side objects — irrelevant for
   validation, noted for the ops console).
3. The sweep scheduler shares the API process (mock constraint); Redis-backed scheduling is
   wired but locally unverified (no Docker). CI exercises Redis for BullMQ imports only —
   a service-container sweep test lands with PV6's ops console work.
4. E5 replay for a contribution that never got a provider reference needs the same scenario
   passed on retry (the raw method token is not persisted) — acceptable for the mock.
5. Organizer "cover remaining" at funding time (E3's full form) is PV7 scope; participant
   exit after authorizing is likewise deferred (allocation-lock blocks it today).
6. `resolveGrace`'s WAITING leaves re-entry to the sweep cadence (10s) — fine at
   validation scale.

## Security review

- §4.7 enforced twice: before authorization and again before every capture; amounts are
  always the server-computed allocation — no client-supplied amounts anywhere.
- One-live-contribution is a DATABASE constraint, not just command logic; idempotency keys
  are server-derived (Plan §11 + Spec §12 operation ids).
- Ledger integrity is a database property (append-only + balanced triggers), proven by
  tests that attack it directly.
- Scenario controls and simulator endpoints are allowlist-gated (never reachable in
  staging/production); the now-override exists only behind that gate.
- Every financial transition is one row-locked transaction with its outbox event (D12).

## Next milestone

**PV6 — Mock Card and Purchase Flow**: card issuance from FUNDED (vink
CARD_PROVISIONING/CARD_READY states are already in the machine), spending limit = funded
amount (Plan §16), first-merchant lock, merchant authorization/capture/reversal via the
mock's simulator surface, settlement + card closure, ops-console-grade simulator endpoints.
Owner actions unchanged: push (CI), Docker Desktop for local Redis paths.
