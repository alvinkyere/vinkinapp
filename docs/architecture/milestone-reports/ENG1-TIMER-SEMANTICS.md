# Milestone Report — ENG1 Timer Semantics

Date: 2026-07-21 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: "one approved
source of truth" for Vink timing, moved into explicit configuration — no product-timing
value changed without a closed decision to back it.

## Research done before touching anything

The plan's own text is explicit: *"The current 18–23-hour behavior must not remain
accidentally hard-coded if the approved product remains a five-to-seven-minute checkout
window... Before changing actual values, verify them against the approved product-behavior
document. Do not silently convert existing behavior to five or seven minutes unless that
decision is already closed."* Before writing any code, this was checked:

- `docs/spec/open-questions.md` G9 (grace timings): **OPEN**, not ratified.
- `docs/spec/master-roadmap-prompt.md` §14 ("PROCESSING GRACE"): the Spec's own "Recommended
  initial timing" — `T-15s` new-attempts cutoff, `T-15` to `T` submissions closed, `T` to
  `T+60s` processing grace — with the explicit line *"The grace duration must be
  configurable."* This is a recommendation to implement as a **default**, not a closed
  decision about final values.
- `docs/design/*.md` (the concurrent UX-track's product-behavior docs, phases 0–10) and
  `docs/spec/decision-log.md` (through D36 as of this pass): **no document anywhere specifies
  a target Vink-open duration** — no "5–7 minutes," no "18–23 hours" as an intended figure.
  That range in the plan's own text is illustrative, not sourced from an existing decision.

Conclusion: no decision closes what the real open-window duration should be. The correct,
disciplined action is to make timing **configurable** without silently changing the **value**
— exactly what was implemented.

## What was implemented

**The real defect this closes**: `apps/mobile`'s create-Vink flow computed
`DateTime.now().toUtc().add(const Duration(hours: 24))` and sent it as an absolute
`submissionDeadline` — a client-hardcoded product-timing decision, unaudited, unconfigurable,
and the literal thing ENG1 warns about. The server had no independent say in how long a Vink
stayed open; whatever the client happened to compute was authoritative.

- **`apps/api/src/config/env.ts`**: three new Zod-validated env vars —
  `VINK_OPEN_DURATION_SECONDS` (default `86400` — **exactly** the prior hardcoded 24h, not a
  behavior change), `VINK_PROCESSING_GRACE_SECONDS` (default `60` — matches both the Spec's
  own §14 recommendation and the value already hardcoded in `commands.ts`), and
  `VINK_SWEEP_INTERVAL_SECONDS` (default `10` — matches the prior hardcoded
  `SWEEP_INTERVAL_MS`).
- **`packages/application/src/ports.ts`**: new optional `CommandContext.timers?: VinkTimers`
  — optional so every existing caller (tests, internal tooling) is unaffected; only
  `apps/api`'s real HTTP context threads real config in.
- **`packages/application/src/commands.ts`**: `CreateVinkInput.submissionDeadline` is now
  **optional** — when omitted, the server computes `now + ctx.timers.openDurationSeconds`
  (or the matching default) itself. An explicit value is still accepted (genuinely useful for
  tests needing specific deadline control — not a production backdoor, since the real client
  stopped sending one). `processingGraceDeadline` computation in both `createVinkCommand` and
  `configureVinkCommand` now reads `ctx.timers?.processingGraceSeconds` instead of a module
  constant.
- **`apps/api/src/modules/vinks/routes.ts`**: `createSchema.submissionDeadline` is optional;
  `contextFor` threads `env.VINK_OPEN_DURATION_SECONDS`/`env.VINK_PROCESSING_GRACE_SECONDS`
  into every command context.
- **`apps/api/src/jobs/sweeps.ts`**: `startSweepScheduler` reads
  `env.VINK_SWEEP_INTERVAL_SECONDS * 1000` instead of a hardcoded constant.
- **`apps/mobile/lib/features/create_vink/create_vink_screen.dart`**: stopped computing and
  sending `submissionDeadline` entirely — the server is now the one and only source of truth
  for how long a Vink stays open, matching Plan §19 ("the app never re-derives backend
  logic").

## An honest, undecided gap — not silently implemented

The Spec's §14 recommendation includes a `T-15s` "new attempts allowed until T-15s, submissions
closed from T-15 to T" soft-close window, distinct from the hard deadline. **This does not
exist in the current domain state machine** — there is exactly one OPEN→SUBMISSIONS_CLOSED
path today, triggered at the hard deadline, not 15 seconds early. Implementing that would be a
genuine new state-machine behavior (a product/domain decision), not a "move a constant into
config" refactor, so it was **not** implemented here. `VINK_CONTRIBUTION_CUTOFF_SECONDS`
(named in the plan's own env-var list) was deliberately **not** added as a config value,
because there is no distinct enforced behavior for it to configure yet — adding an env var
that's read but never enforced would be misleading, dead configuration. Flagged here for a
future decision, not guessed at.

## Files changed

Modified: `apps/api/src/config/env.ts`, `apps/api/src/jobs/sweeps.ts`,
`apps/api/src/modules/vinks/routes.ts`, `packages/application/src/{ports,commands,
commands.test}.ts`, `apps/mobile/lib/features/create_vink/create_vink_screen.dart`,
`apps/api/src/vinks.integration.test.ts`. This report.

## Tests added

3 new unit tests (default 24h + 60s grace when `ctx.timers` is omitted; `ctx.timers`
overriding both values; an explicit `submissionDeadline` still winning over `ctx.timers` for
the deadline itself, while grace still derives from config) + 1 real-Postgres integration
test (a real HTTP `POST /vinks` omitting `submissionDeadline`, asserting the real server
config produces a deadline within a wide-but-real tolerance band of `now +
VINK_OPEN_DURATION_SECONDS`). All green, plus the full existing suite (**237 Node/TS tests**,
**54 Flutter tests**) unaffected — the additive, default-preserving design means nothing that
already worked needed to change.

Real-device re-verification: `e1_test.dart` (the full golden path — create through
completion) re-run on a freshly erased booted iOS Simulator against the real local backend,
with the mobile client genuinely no longer sending `submissionDeadline` — passes clean,
confirming the server-computed default works correctly for real, not just in a unit test.

## Two real accumulated-environment defects found and fixed along the way (not product bugs)

Verifying this milestone surfaced — and this report fixes as a byproduct, since they were
actively blocking verification — two structural fragilities from this long session's own
repeated local dev-server restarts, **neither caused by this milestone's code**:

1. **BullMQ repeatable-job accumulation**: every `kill <pid>` of a dev server today skipped
   `startSweepScheduler`'s graceful-shutdown cleanup, so each restart's
   `upsertJobScheduler('vink-sweeps-repeat', ...)` left the previous instance's repeat-job
   registration behind in Redis. Over a full day of restarts this accumulated to **5,616
   stale keys**. Cleared (`redis-cli --scan --pattern "bull:vink-sweeps:*" | xargs redis-cli
   DEL`); worth a documented graceful-shutdown habit (or a `SIGTERM`-based stop script) for
   future long sessions rather than bare `kill`.
2. **Mock-provider ID counters vs. persistent Postgres data**: `MockFinancialProvider` is
   in-memory by design (documented in `sweeps.ts`'s own header comment) — its
   sequential `auth_NNN`/`pay_NNN` counters reset to zero on every server restart, but
   Postgres rows from *before* that restart still reference the old counter's IDs. A fresh
   counter eventually regenerates an ID that collides with an old row's
   `provider_authorization_id`/`provider_reference` (`unique constraint` violations), and
   for the sweep specifically, hitting *one* such poisoned row mid-loop aborted the entire
   sweep function before it ever reached healthy, newer vinks — which is what looked like a
   "card provisioning is broken" regression until traced to its actual cause. Fixed by
   removing 38 fully-terminal (`COMPLETED`/`EXPIRED`/`CANCELLED`) test vinks accumulated
   from today's testing; deliberately left every `OPEN`/`DRAFT`/`CARD_READY` vink untouched
   in case the concurrent UX-track session (also active in this repo today) has state it's
   using. Worth a documented `pnpm --filter @vinkin/api` "reset local dev data" script if
   long multi-restart sessions keep recurring — this is the third distinct flavor of
   accumulated-session-cruft this pass alone (after BullMQ keys and, in earlier ENG1 slices,
   disk space and CoreSimulator daemon degradation).

Also observed (not fixed, not this milestone's concern): running the full suite via `pnpm
test` intermittently shows different packages failing on different runs under this machine's
current load (many concurrent Postgres/Redis/Playwright/simulator processes from a long
session) — confirmed transient by re-running every implicated package in isolation
repeatedly, always clean. Real signal is the isolated per-package runs and the real-device
test, not a single combined `pnpm test` invocation on an already-loaded machine.

## Next milestone

Per the owner's stated order: **the organizer merchant-payment command split (§7)** —
separating `ContributeOrganizerShare` from `RequestMerchantAuthorization`/
`CaptureMerchantPurchase` as unambiguous, distinct application-layer intents.
