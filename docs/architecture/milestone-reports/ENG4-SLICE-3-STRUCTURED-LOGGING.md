# ENG4 Slice 3 — Structured Logging

**Date:** 2026-07-24
**Scope:** Second pure-application-code slice of ENG4. Brief's goal: every request/command/
worker job/provider interaction carries a correlation ID; logs become machine searchable;
never log secrets, payment credentials, or guest capability tokens; a complete Vink lifecycle
can be reconstructed from logs.

## Audit findings (before any code)

`apps/api/src/app.ts` already generates a real per-request UUID (`genReqId: () =>
randomUUID()`), labels it `request_id` in every Fastify log line, and echoes it as an
`x-request-id` response header. Every HTTP route already threads that same id into
`CommandContext.correlationId` (confirmed by grep across all six route modules) — which was
already a field on `CommandContext`/`PublicCommandContext` (added for `VinkStateHistoryRow`/
`ContributionStatusHistoryRow` attribution) — so "every request" and "every command carries a
correlation ID" were **already true and already the same ID**, better than the initial audit
guessed.

The two real, unambiguous gaps: **worker jobs** (`jobs/worker.ts`'s heartbeat used raw
`console.log`, no structured logging, no correlation ID at all; `jobs/sweeps.ts` generated a
correlation ID per sweep tick but never logged it anywhere — it reached only DB history rows)
and **provider interactions** (`packages/payment-provider` has zero logging of any kind, and
nothing threads a correlation ID to it).

## What was built

**`CommandLogger` (new, `packages/application/src/ports.ts`)**: a minimal, dependency-free
`{ info(event, data?), error(event, data?) }` interface, added as an optional field on
`CommandContext`/`PublicCommandContext` — same "omit for pre-existing behavior" convention as
`timers`/`invitesEnabled`. Deliberately not the real Pino type: the application layer stays
"pure orchestration" with no logging library dependency; `apps/api` supplies a real
implementation. Every existing test and internal caller is unaffected (confirmed:
`packages/application` 137/137 unchanged).

**`withProviderLogging` (new, `apps/api/src/observability/provider-logging.ts`)**: a `Proxy`-
based decorator around `FinancialProvider`, not a change to the interface itself. The
interface is a spec-verbatim (§43) contract shared with the adapter-conformance suite (D7) —
adding a parameter to every method would be a breaking change to a locked contract, exactly
what ENG4's own principles warn against ("respect the provider abstraction… do not bypass
existing architecture"). The decorator logs `provider_call_start`/`provider_call_end`/
`provider_call_error` (method name + provider name + correlation ID only — **never the raw
input/output payload**, which can carry financial PII) around every async method, and special-
cases `parseWebhookEvent` (the interface's one synchronous method) to preserve its exact
synchronous call contract rather than silently wrapping it in a Promise.

**`toCommandLogger` (new, `apps/api/src/observability/command-logger.ts`)**: adapts a
Pino-shaped logger (`request.log`, or the new shared factory below) to the narrow
`CommandLogger` port.

**`createLogger` (new, `apps/api/src/observability/logger.ts`)**: a shared Pino factory (same
`level`/`redact` shape as `app.ts`'s Fastify-embedded logger) for the one process that didn't
already have Pino for free — `jobs/worker.ts`. `pino` added as an explicit direct dependency of
`apps/api` (was only a transitive dependency via `fastify`).

**Wired at 6 context-construction sites** (`contributions/routes.ts`, `purchases/routes.ts`,
`recovery/routes.ts` ×2, `ops/routes.ts`, `vinks/routes.ts`, `sharing/routes.ts`): each now
supplies `logger: toCommandLogger(request.log)`, and the four that carry a `FinancialProvider`
now wrap it with `withProviderLogging(provider, correlationId, logger)`. Four of these files'
`contextFor`-style helpers changed from taking a bare `requestId: string` to the full
`FastifyRequest` (needed for `.log`) — a small, consistent refactor that also unified them with
`contributions/routes.ts`'s pre-existing `contextFor(request)` shape.

**`jobs/sweeps.ts`**: `runSweeps` gained an optional 4th parameter (`log?: PinoLike`,
backward-compatible — all 7 existing integration-test call sites across
contributions/purchases/recovery/analytics/ops suites needed no changes). Each sweep tick now
gets a genuinely unique correlation ID (`sweep:${timestamp}:${randomSuffix}` — the previous
timestamp-only id could collide across rapid ticks in tests), logs `sweep_start`/`sweep_end`
(the latter carrying the exact `SweepResult` counts), and wraps its provider the same way HTTP
routes do. `startSweepScheduler` now constructs a real logger via `createLogger` and threads it
through.

**`jobs/worker.ts`**: replaced raw `console.log(JSON.stringify(...))` with the shared Pino
logger; the heartbeat job now logs with `correlationId: heartbeat:${job.id}` — BullMQ's own job
id reused as the correlation id rather than minting a separate one (same principle as
`sweeps.ts`'s per-tick id, applied where an existing stable id already fits).

## Tests

- `apps/api/src/observability/provider-logging.test.ts` (new, 5 tests): readonly properties
  pass through untouched; a successful call logs a matching start/end pair; a failing call
  logs `provider_call_error` and still rethrows; **the raw input payload never appears in any
  logged data** (asserted via `JSON.stringify` scan, not just spot-checked); `parseWebhookEvent`
  stays synchronous (proven by asserting a synchronous `throw`, not a Promise rejection).
- `apps/api/src/observability/command-logger.test.ts` (new, 2 tests): Pino call-order
  adaptation, default-empty-object on omitted data.
- `apps/api/src/jobs/sweeps-logging.test.ts` (new, 3 tests, real isolated Postgres): a
  `sweep_start`/`sweep_end` pair sharing one `sweep:`-prefixed correlation ID; two separate
  sweep ticks get two different IDs; omitting the logger changes nothing about the sweep result
  (backward compatibility, explicitly proven not just assumed).
- Real, not simulated: the existing `recovery + refunds end-to-end (PostgreSQL)` integration
  test's E8 scenario (a deliberately failing `refundContribution` call) now visibly prints a
  real `provider_call_error` log line with `correlationId`/`provider`/`method`/`error` during
  the normal test run — direct proof the wiring works end-to-end against real Postgres, not
  just in isolated unit tests.
- Real process smoke tests (not simulated): `node src/jobs/worker.ts` against real local Redis
  — confirmed structured JSON output with `correlationId: heartbeat:<jobId>`, replacing the old
  raw console.log; a full `node src/server.ts` boot against real local Postgres + Redis —
  `/health/ready` returns 200, every log line already carries `request_id`, confirming the
  context-construction refactor across 6 route files didn't break real startup.

## Verification

- `pnpm typecheck`: 10/10 packages clean, first pass.
- `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean.
- `apps/api`: **153/153** (up from 148 pre-slice: +5 new tests — provider-logging's 5 were
  already included in the 148 baseline count taken mid-slice; the final +5 are
  `sweeps-logging.test.ts` (3) + `command-logger.test.ts` (2)).
- `packages/application`: **137/137**, unchanged — confirms the additive `CommandLogger`/
  `logger?` field broke nothing.

## Secrets/PII discipline

Every new log call site logs event name + correlation ID + provider/method name + (on error)
`error.message` only — never a raw command input, provider request/response payload, or
request body. Checked `MockFinancialProvider`'s own error messages: they embed opaque
provider-side reference IDs (`providerPaymentId`, `providerCustomerId`, `cardId` — the same
class of ID already persisted in Postgres columns elsewhere in the schema), never raw card
numbers, CVVs, or other payment credentials. `app.ts`'s existing `redact: ['req.headers.
authorization']` is unchanged and still applies to every process using the shared logger
factory.

## Known, disclosed gaps

- Command-level logging (`logger.info('command_ran', ...)` around each of the ~30 individual
  command functions) was **not** added inside `packages/application`'s command functions
  themselves — only at the 6 context-construction call sites and around provider calls. Adding
  it deeper would mean touching dozens of call sites inside the most heavily-tested financial
  logic in the repo (contributions/purchases/recovery/refunds) for a benefit largely already
  covered by Fastify's own per-request access log (method/url/status/`request_id`, already
  enabled outside `test` env) joined to the DB history tables' own `correlationId` column —
  judged not worth the risk/diff size for this slice. Flagged, not silently skipped.
- `apps/guest-web`/`apps/operations-console` (Next.js) have no correlation-ID mechanism of
  their own yet — out of scope for this slice (it targeted `apps/api`'s request/command/job/
  provider path specifically, per the audit's own findings); a real gap if a future slice needs
  end-to-end tracing across the browser→API boundary (Slice 5's likely territory).

## Exit gate

- [x] Every request already carried (and still carries) a correlation ID.
- [x] Every command already carried (and still carries) the same correlation ID — now provably
  loggable via the new `CommandLogger` port, not just DB-attributable.
- [x] Every worker job now carries and *logs* a correlation ID (previously generated-but-unused
  for sweeps; entirely absent for the heartbeat).
- [x] Every provider interaction now carries and logs a correlation ID, without touching the
  spec-verbatim provider interface.
- [x] Logs are structured JSON (Pino) everywhere, including the one process that previously
  used raw `console.log`.
- [x] No secret, payment credential, or guest capability token appears in any new log line
  (audited, not assumed).

## Next

ENG4 Slice 4 (metrics — a `/metrics`-style endpoint; no dashboards yet per the brief's own
exit criteria).
