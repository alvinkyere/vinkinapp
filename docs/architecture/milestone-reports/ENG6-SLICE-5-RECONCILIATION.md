# ENG6 Slice 5 — Reconciliation Scaffolding

**Date:** 2026-07-27
**Scope:** owner-directed, with explicit exclusions — process the durable webhook inbox
(Slice 4), correlate provider events against VinkIn's own records, classify discrepancies
under explicit reviewed rules, produce operator-review findings, never mutate financial state,
preserve complete audit history, support idempotent replay and crash-safe resumption. Explicit
non-goals, honored throughout: no Stripe Financial Accounts v2 (a separate, unresolved
provider-account constraint — see `ENG6-SLICE-5-STRIPE-FINANCIAL-ACCOUNT-NOTE.md`), no Stripe
command adapter wired into the running application, no bank-account/Financial Account
infrastructure of any kind.

## What was built

**`packages/reconciliation`** (new package, zero production dependencies, mirroring
`@vinkin/ledger`'s own split between pure rules and DB persistence) — the classification
engine itself, provider-neutral:

- `correlation-map.ts` — `correlationTargetFor(eventType)`: which VinkIn domain concept
  (`contribution` | `purchase_authorization` | `settlement` | `none`) a given
  `ProviderEventType` is expected to correlate against. `dispute.created` maps to `'none'`
  honestly — VinkIn's domain models no disputes anywhere today (confirmed by search).
- `classify.ts` — the reviewed rules, pure: given an event and an already-fetched
  `CorrelationLookup` snapshot (no database access here at all), returns one of the five
  owner-specified classifications (`EXPECTED`/`PENDING`/`MISMATCHED`/`ORPHANED`/
  `UNRECOGNIZED`) plus a human-readable reason and, for anything short of `EXPECTED`, a
  `proposedRemediation` string — always prose for an operator, never an executable action.
  Status-consistency and amount-consistency checks are both explicit, named tables
  (`CONSISTENT_STATUSES`, `AMOUNT_BEARING_TYPES`), not inferred from the domain's own state
  machine — reconciliation must be able to catch VinkIn's own state being *wrong*, so it
  cannot simply restate what the state machine already believes.
- **16/16 tests**, split deliberately: `classify.test.ts` uses hand-written, provider-neutral
  `ProviderEvent` fixtures (12 tests, one per required scenario: expected, pending, mismatched,
  orphaned, unrecognized, late capture, reversal in both directions, refund in both
  directions, the settlement two-hop target, and a dedicated proof that
  `proposedRemediation` is always operator-facing prose, never an instruction). A separate
  `stripe-translation.test.ts` (4 tests) proves the same rules against events **as Stripe's own
  adapter actually produces them** — real `mapStripeEventType` translation, a real locally-
  computed HMAC signature — fully offline (`Stripe.webhooks.constructEvent` is pure local
  crypto, confirmed in Slice 3/4; a throwaway `sk_test_...` key never touches the network), so
  this runs in CI with no live credentials and is not gated behind
  `VINKIN_STRIPE_SANDBOX_TEST`.

**`apps/api/src/db/migrations/0020_reconciliation.sql`** — `reconciliation_runs` (the audit
trail of every execution: started/completed timestamps, events examined, findings created) and
`reconciliation_findings` (`webhook_event_id UNIQUE` — the real idempotency guard, PostgreSQL
uniqueness per this codebase's hard rule, not an app-layer check; `seq BIGSERIAL` for a
deterministic total order, the same pattern `ledger_entries`/`outbox_events`/
`contribution_status_history` already use, here to let tests prove processing order).

**`apps/api/src/modules/reconciliation/store.ts`** — the DB-layer correlation queries, plain
functions (not a class) taking an explicit `Sql`/`TransactionSql` each call, since the runner's
own transaction needs every correlation lookup to run inside the SAME transaction that holds
the `webhook_events` row locks. `contribution`/`purchase_authorization` are direct one-hop
lookups (`provider_reference`/`provider_authorization_id`); `settlement` is a genuine two-hop
lookup (`payload.providerCardId` → `temporary_cards` → the vink's own most recent settlement)
since `settlements` carries no direct provider-object column at all — confirmed against the
real migration, not assumed.

**`apps/api/src/modules/reconciliation/runner.ts`** — `runReconciliation(sql, batchSize)`,
deliberately mirroring `realtime/outbox-publisher.ts`'s own proven `FOR UPDATE SKIP LOCKED`
pattern rather than inventing a new one: one `sql.begin` transaction per run, claim a batch of
unprocessed `webhook_events` rows (`status = 'received'` only — dead-lettered rows are Slice
4's own audit trail, never a verified financial event to classify) **ordered by `occurred_at`,
never `received_at`/insertion order** (§28, the owner's own explicit requirement), correlate
and classify each, insert a finding (`ON CONFLICT (webhook_event_id) DO NOTHING`), record the
run's own counts, commit. This one pattern delivers every required property at once:
multi-instance/concurrent-run safety (a locked row is skipped by any other runner, never
double-processed), crash-safe resumption (a crash mid-run rolls the whole transaction back;
the next run simply claims the same unprocessed rows again), and idempotent replay
(`webhook_event_id UNIQUE` means replaying the same underlying rows can only ever produce zero
additional findings on a second pass).

## Proof, not assertion — every required scenario has its own real-Postgres test

`apps/api/src/reconciliation.integration.test.ts`, **13/13** against real PostgreSQL, using
direct-SQL provider-neutral fixtures (inserted straight into `webhook_events`, bypassing
Slice 4's HTTP route entirely — that route's own behavior is already proven separately) and,
for several scenarios, deliberately-inconsistent domain state no real command flow would ever
produce (drift, by definition, doesn't happen through the well-behaved application layer — it
has to be constructed directly to be tested at all):

- **EXPECTED** — a captured event whose amount and status match VinkIn exactly.
- **MISMATCHED (late capture)** — a capture event arrives while VinkIn's own contribution
  still shows only `AUTHORIZED`.
- **MISMATCHED (reversal)** — a cancellation VinkIn hasn't caught up to.
- **MISMATCHED (refund)** — a refund amount that disagrees with VinkIn's own record.
- **ORPHANED (missing predecessor)** — a known event type with no VinkIn record at all.
- **UNRECOGNIZED (unknown provider object)** — `dispute.created`, no VinkIn domain concept.
- **PENDING** — a real-time authorization *request* correctly precedes any VinkIn decision.
- **Settlement two-hop correlation** — `EXPECTED` via `providerCardId` → card → vink →
  settlement.
- **OUT-OF-ORDER** — two events inserted (== "arrived") in reverse chronological order; the
  test asserts, via `reconciliation_findings.seq`, that the earlier-`occurred_at` event was
  processed **first**, proving the ordering rule directly rather than by inspection.
- **DUPLICATE / REPLAY** — running reconciliation twice over the same events produces zero new
  findings the second time, and exactly one finding total — the actual "replay without
  duplicating domain effects" proof.
- **CRASH-SAFE / CONCURRENT** — 30 events, two concurrent `runReconciliation` calls
  (`Promise.all`, the exact pattern `outbox-publisher.integration.test.ts` already
  established for the identical property): every row claimed and processed exactly once,
  combined, never twice, never missed.
- **AUDIT** — every run's own row records real `started_at`/`completed_at`/counts, and every
  finding it created traces back to it via `run_id`.
- **NEVER MUTATES** — a dedicated test captures the `contributions` row's `status`/`updated_at`
  before and after a reconciliation run that produces a `MISMATCHED` finding against it, and
  asserts they are byte-identical — reconciliation records the discrepancy; it does not touch
  the record it's reporting on.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, 12/12
  packages (including the new `@vinkin/reconciliation`).
- `packages/reconciliation`: **16/16**.
- `apps/api`: **240/240** (up from 227 — 13 new).
- `packages/application`: **137/137** unchanged — confirms this stayed entirely inside a new,
  additive module; no command or domain code was touched.
- `packages/providers`: **9/9** unchanged.

## Explicitly honored exclusions

- **No Stripe Financial Accounts v2 code anywhere.** The v2 requirement surfaced while
  re-checking Issuing status mid-session (see the separate decision note) is treated as
  exactly what it is — an unresolved provider-account constraint, not something this slice's
  scope covers or should route around.
- **No Stripe command adapter wired into `server.ts`.** `apps/api`'s command-execution
  `provider` remains `MockFinancialProvider`, unchanged. Reconciliation reads `webhook_events`
  rows regardless of which adapter produced them — it has no dependency on which provider is
  wired for command execution.
- **No automatic repairs of any kind.** Every classification short of `EXPECTED` produces a
  `proposedRemediation` string for a human, and `NEVER MUTATES`'s own dedicated test proves no
  reconciliation code path writes to `contributions`, `settlements`, `purchase_authorizations`,
  or any ledger table.

## Known, disclosed gaps

- No HTTP surface (list findings, trigger a run, mark a finding acknowledged/resolved) exists
  yet — `runReconciliation` is callable programmatically only. That's Slice 6's explicit scope
  ("operations console read-only tooling"), not invented early here.
- No scheduled/recurring trigger exists yet (unlike `sweeps.ts`'s BullMQ-driven cadence) —
  `runReconciliation` is a function, not a wired job. Left for whichever slice actually needs
  reconciliation running unattended, since the owner's brief didn't ask for that here either.
- The settlement two-hop correlation picks the vink's single most recent settlement
  (`ORDER BY created_at DESC LIMIT 1`) — correct for VinkIn's current one-settlement-per-vink
  domain shape, but would need revisiting if that shape ever changes.

## Next

ENG6 Slice 6 — operations console read-only tooling: surfacing `reconciliation_findings` (and
the run history) in `apps/operations-console`, plus an operator-triggered run and the
acknowledge/resolve workflow `review_status` already supports.
