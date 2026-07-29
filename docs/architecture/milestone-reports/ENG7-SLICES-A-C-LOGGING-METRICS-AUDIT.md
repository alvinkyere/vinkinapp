# ENG7 Slices A–C — Structured Logging, Metrics, and Audit Trail Completion

**Date:** 2026-07-27
**Scope:** `docs/architecture/eng-roadmap.md`'s ENG7 ("Observability and auditability") —
the Logging, Metrics, and Audit trail subsections. The fourth subsection, Alerts, is
explicitly deferred (owner choice, via `AskUserQuestion`: "Defer alerts, build the rest
first") — no alerting infrastructure/channel exists yet, and the roadmap names no vendor,
matching this repo's own established precedent of deferring vendor-dependent work (ENG4
Slices 2/6/7/8/9) rather than guessing at one.

## Audit first, then build

Following this session's own established discipline (mirroring ENG6 Slice 1), a dedicated
Explore pass checked the roadmap's four named ENG7 subsections against actual code before any
change was made, file:line-cited. Findings:

- **Logging**: the mechanism (`CommandLogger` port, `logCommand` — never wired) existed from
  ENG4 Slice 3 but was used by almost none of `packages/application`'s command functions.
  Neither `RELEASE_VERSION` nor an idempotency key ever appeared on a log line.
- **Metrics**: real gaps against the roadmap's 13 named metrics — no job-duration histogram,
  no sweep-delay histogram, no webhook/replay/outcome counters; WebSocket reconnect counting
  was never plumbed from either client.
- **Alerts**: zero infrastructure anywhere, as expected — no vendor decision exists yet.
- **Audit trail**: `vink_state_history`/`contribution_status_history` cover most transitions,
  but two real, previously-undiscovered holes existed — `createVinkCommand` and
  `setSplitCommand` wrote to **no audit mechanism at all** (neither is a domain-legal
  state-machine transition, so neither ever called `applyVinkTransition`).
  `contribution_status_history` also had no `provider_reference` column, and
  `operator_audit_log` had no `correlation_id` column, so operator actions couldn't be tied
  back to a request trace.

## Slice A — structured logging

`packages/application/src/support/command-logging.ts` (new): a small `logCommand` helper
called at every command's real exit point(s) — correlation ID, actor, vink ID (when known),
command name, and idempotency key (when the command has one). Wired into all command files
(`commands.ts`, `contributions.ts`, `purchases.ts`, `refunds.ts`, `recovery.ts`, `guest.ts`,
`invites.ts`) — 18 commands total. Branching commands (e.g. `authorizeContributionCommand`,
`inviteGuestCommand`) capture an intermediate `result` and log once after the underlying
transaction resolves, rather than scattering a log call into every branch.

`RELEASE_VERSION` is new (`apps/api/src/config/env.ts`), sourced from
`RELEASE_VERSION ?? RAILWAY_GIT_COMMIT_SHA ?? 'unknown'` — Railway (ENG4 Slice 2) already
auto-injects the commit SHA, so a real release build gets a real value with zero deploy
config, while local dev cleanly falls back to `'unknown'`. Threaded into three places: the
Fastify logger's `base` (`app.ts`), the shared non-HTTP `createLogger` factory
(`observability/logger.ts`, used by `jobs/worker.ts`/`jobs/sweeps.ts`), and Sentry's
`release` tag (`observability/sentry.ts`).

**Real bug found and fixed**: Pino's `base` logger option *replaces* its default
`{pid, hostname}` binding rather than merging with it — setting `base: { release }` in
`app.ts` would have silently dropped `pid`/`hostname` from every HTTP log line. Fixed by
explicitly restating them alongside `release`.

## Slice B — metrics

`packages/application/src/ports.ts` gained a `CommandMetrics` port (mirroring `CommandLogger`
exactly): `recordReplay`, `recordContributionOutcome`, `recordAuthorizationOutcome`,
`recordRefundOutcome`. `apps/api/src/observability/command-metrics.ts` (new) is the
`toCommandMetrics` adapter, the same pattern as `toCommandLogger`. Wired into every route
module's command-context builder (`vinks`, `contributions`, `purchases`, `recovery`, `ops`)
and into `jobs/sweeps.ts`'s `ContributionCommandContext`.

`observability/metrics.ts` gained 7 real Prometheus instruments: `vinkin_job_duration_ms`
(histogram — sweep tick, worker heartbeat), `vinkin_sweep_delay_ms` (histogram — drift of
actual tick start against `VINK_SWEEP_INTERVAL_SECONDS`), `vinkin_webhook_events_total`
(counter, by provider/outcome), `vinkin_command_replay_total`,
`vinkin_contribution_outcome_total`, `vinkin_merchant_authorization_outcome_total`,
`vinkin_refund_outcome_total` (all counters, by outcome). `jobs/sweeps.ts`'s scheduler now
tracks `previousTickStartedAt` and records the delay each tick. `modules/webhooks/routes.ts`
records ingestion outcome right after `ingestWebhookEvent` resolves.

**Deliberately not built**: reconnect-frequency reporting (a client-side fact; wiring it
would mean touching `apps/mobile`/`apps/guest-web`, out of scope for this pure-backend pass,
flagged as a disclosed gap, not silently dropped) and database query latency (the `postgres`
npm client exposes no per-query hook; wrapping the single most pervasively used object in the
codebase, including inside financial transactions, was judged too risky for an additive slice
— same reasoning ENG4 Slice 4 already used for the identical gap).

## Slice C — audit trail completion

`createVinkCommand` and `setSplitCommand` each gained a direct `tx.appendHistory(...)` call
(the plain, non-domain-validated write path — confirmed via `VinkTx`'s signature — since
neither event is a real state-machine transition `applyVinkTransition` could validate:
creation has no real "from" state, and split doesn't change `vink.state` at all). Values are
deliberately synthetic-but-honest: `fromState: 'NONE'` for creation, `fromState === toState`
for split.

Migration `0022_audit_trail_completion.sql`: `contribution_status_history` gained
`provider_reference` (now populated by `applyContributionTransition`), `operator_audit_log`
gained `correlation_id` (both `modules/ops/routes.ts` and `modules/reconciliation/routes.ts`
now pass `correlationId: String(request.id)` on every audit-log write).

**Two existing tests updated, not weakened**: `vinks.integration.test.ts` and
`packages/application/src/commands.test.ts` both hardcoded the old (incomplete)
transition-row count (`VINK_OPENED` only). Updated to assert the full, now-correct sequence
`['VINK_CREATED', 'SPLIT_CONFIGURED', 'VINK_OPENED']` — confirmed this is the audit trail
becoming more complete, not a regression being papered over.

## Tests

New: `apps/api/src/structured-logging.integration.test.ts` (3/3) — proves a real
`command_executed` log line carries correlationId/actor/vinkId/command/idempotencyKey/release,
that `setSplit`/`openVink` each emit their own line, and that no line ever leaks a display
name, contact destination, or raw token. `apps/api/src/audit-trail.integration.test.ts` (3/3)
— proves `createVink`/`setSplit` write real `vink_state_history` rows, a captured
contribution's history row carries a real `provider_reference`, and an operator action's audit
row carries a real `correlation_id`. `apps/api/src/observability/metrics.test.ts` extended
with all 7 new instruments, including a real HTTP scrape assertion (not mocked).

- `apps/api`: **260/260** (up from 254).
- `packages/application`: **137/137**, unchanged — confirms the logging/metrics wiring stayed
  additive and broke nothing.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, 12/12
  packages.
- Verified against real running processes, not just unit assertions: a live server boot with
  `VINKIN_METRICS_ENABLED=1`, real HTTP-driven commands, and a real `curl` scrape confirming
  `vinkin_job_duration_ms`/`vinkin_sweep_delay_ms` genuinely populated from the actual running
  sweep scheduler.

## Known, disclosed gaps

- **Alerts** (the roadmap's 4th ENG7 subsection): fully deferred, per explicit owner choice —
  no channel/vendor has been selected. Revisit trigger: an owner decision on delivery channel
  (the same shape of decision ENG4's vendor-dependent slices needed).
- **Reconnect-frequency metric**: not built — needs client-side reporting from
  `apps/mobile`/`apps/guest-web`, out of scope for this backend-only pass.
- **Database query latency**: not instrumented — no per-query hook exists on the `postgres`
  client without wrapping the most pervasively used object in the codebase; same reasoning as
  ENG4 Slice 4's identical disclosed gap.
- `apps/operations-console` was not updated to display `correlationId` on audit-log rows —
  the column now exists and is populated, but no UI surfaces it yet.

## Next

ENG7's Alerts subsection remains open pending an owner channel decision. Otherwise ENG7 is
done for now; the roadmap's own sequence continues from wherever the owner directs next.
