# ENG4 Slice 4 — Metrics & Observability

**Date:** 2026-07-24
**Scope:** Third pure-application-code slice of ENG4. Brief's goal: metrics for API latency,
queue depth, realtime connections, reconnect frequency, invitation delivery, contribution
latency, authorization latency, worker failures, database latency, provider latency, health
status — exposed cleanly, no dashboards yet. Exit criteria: "the system can answer 'what is
happening?' without reading logs."

## Audit findings (before any code)

Zero metrics infrastructure existed anywhere: no `prom-client`, no OTel metrics exporter — only
`apps/api/src/observability/otel.ts`'s trace-only, off-by-default `NodeSDK` bootstrap. Fully
greenfield.

## Design decision: extend the existing OTel setup, pull-based, its own flag

Per ENG4's own "prefer extending established systems" principle, metrics are built on the same
OpenTelemetry SDK family `otel.ts` already uses (`@opentelemetry/api`, now also
`@opentelemetry/sdk-metrics` + `@opentelemetry/exporter-prometheus`), not a separate library
like `prom-client` — same ecosystem, no second philosophy introduced.

Deliberately **not** gated by `VINKIN_OTEL_ENABLED`: that flag defaults off because a push-based
OTLP trace exporter "only produces noise" without a running collector (`otel.ts`'s own doc
comment). A Prometheus exporter is pull-based and self-contained — `curl localhost:PORT/metrics`
works with nothing else running, no collector needed. It gets its own flag
(`VINKIN_METRICS_ENABLED`, default off) because it still opens a new port, a real behavior
change that shouldn't happen silently in an already-running environment — same reasoning
category as every other new-capability flag this engineering track has added (`VINKIN_OTEL_
ENABLED`, `VINKIN_MINIMUM_APP_VERSION`), applied to a genuinely different actual risk.

## What was built

**`apps/api/src/observability/metrics.ts`** (new): `startMetrics(env)` returns a `Metrics`
recorder API + a `stop()`. Flag off → `NOOP_METRICS` (every method a true no-op, verified by a
dedicated test). Flag on → a real `MeterProvider` + `PrometheusExporter` (its own tiny HTTP
server on `VINKIN_METRICS_PORT`, default 9464) backing five real instruments:
- `vinkin_api_request_duration_ms` (histogram) — method/route-pattern/status code.
- `vinkin_provider_call_duration_ms` (histogram) — provider/method.
- `vinkin_worker_job_failures_total` (counter) — queue.
- `vinkin_invitation_delivery_total` (counter) — outcome/method.
- `vinkin_realtime_connections` (up-down counter).
- Plus a generic `registerObservableGauge(name, callback)` — the async-gauge pattern BullMQ
  queue depth and health-check status both need, since they're polled facts, not events.

**Wired at seven real choke points**, all additive (default parameter `= NOOP_METRICS`, every
pre-existing call site/test unaffected):
- `app.ts`'s new `onResponse` hook records API latency for every request — using
  `request.routeOptions.url` (the route *pattern*, e.g. `/vinks/:vinkId`), never the resolved
  URL, to avoid an unbounded-cardinality label (every UUID becoming its own label value).
- `withProviderLogging` (Slice 3's existing Proxy decorator) now also times each call and
  records `vinkin_provider_call_duration_ms` — one wrapper serving both logging and metrics,
  since both fire around the exact same call; covers provider latency AND authorization latency
  (authorization is just one of the wrapped methods) for free.
- `jobs/sweeps.ts`'s `startSweepScheduler`: `worker.on('failed', ...)` records worker failures;
  `registerObservableGauge('vinkin_queue_depth', ...)` polls `queue.getJobCounts(...)` on every
  scrape.
- `jobs/worker.ts` (the heartbeat process): its own `worker.on('failed', ...)`. Since this is a
  genuinely separate OS process from the main API server (the whole point of `worker.ts`), it
  gets its own `startMetrics` call on `VINKIN_METRICS_PORT + 1` — sharing the main process's
  port would conflict the moment both run together, the normal deployment topology.
- `modules/realtime/routes.ts`: `metrics.connectionOpened()` right after a WebSocket
  subscription genuinely succeeds (never on any of the earlier `socket.close(...)` rejection
  paths — those are refused upgrades, not real connections); `connectionClosed()` in the
  existing `socket.on('close', ...)` handler.
- `modules/vinks/routes.ts`'s `dispatchGuestInvitationSafely`: records
  `vinkin_invitation_delivery_total` at the same point the existing audit-row write already
  records SENT/FAILED — mirroring an outcome that already exists, not inventing a new
  determination of it. Also recorded on the "provider threw unexpectedly" catch path.
- `server.ts`: registers a `vinkin_health_status` gauge reusing the *exact same* `checkDb`/
  `checkRedis` closures `/health/ready` already runs — no new health-determination logic, just
  an additional way to observe the one that exists.

## Tests

- `apps/api/src/observability/metrics.test.ts` (new, 4 tests): `NOOP_METRICS` genuinely no-ops
  every call; the flag-off default never opens a port; **a real HTTP scrape** (flag on, real
  ephemeral port) returns real Prometheus text with every recorded histogram/counter/
  up-down-counter/gauge value correct — not mocked, an actual `fetch()` against an actual
  running server; `stop()` actually closes the port (`fetch` after `stop()` rejects).

## Verification

- `pnpm typecheck`: 10/10 packages clean, first pass despite the seven-file wiring surface.
- `pnpm lint` / `pnpm format:check` / `pnpm guard`: clean.
- `apps/api`: **157/157** (up from 153 pre-slice).
- Real process verification (not simulated): a full `node src/server.ts` boot with
  `VINKIN_METRICS_ENABLED=1` — `/metrics` (its own port) returns real Prometheus text
  including live `vinkin_api_request_duration_ms` values from the actual `/health/ready`/
  `/health/live` requests that were just made, a `vinkin_health_status` gauge reading 1/1 for a
  genuinely healthy local Postgres/Redis, and `vinkin_queue_depth` reflecting the real
  `vink-sweeps` BullMQ queue's job counts. A separate `node src/jobs/worker.ts` boot with its
  own `VINKIN_METRICS_PORT + 1` confirmed no port conflict with the main server running
  simultaneously.

## Known, disclosed gaps

- **Database latency**: not implemented. The `postgres` npm client (`postgres.js`) exposes no
  built-in per-query completion/duration hook (only a pre-execution `debug` callback). The only
  way to measure it would be wrapping the `Sql` instance itself — the single most pervasively
  used object in the entire backend, called from hundreds of sites including inside
  transactions (`sql.begin`). Given "never rewrite working architecture" and the financial
  criticality of every code path that touches it, wrapping it was judged too risky for this
  slice's own additive-metrics goal. Flagged as a real gap for a future, more careful pass.
- **Reconnect frequency**: not implemented. This is fundamentally a *client-side* fact (a mobile/
  guest-web app's own retry attempts) the backend cannot observe directly — the backend only
  sees `vinkin_realtime_connections` rise, not *why* a given connection opened (fresh session vs.
  reconnect). A real implementation would need clients to report reconnect attempts (e.g.
  through the existing PV12-prep `analytics_events` pipeline) — a bigger, cross-repo decision
  flagged here, not silently invented.
- **Member-invitation delivery metrics**: only guest-invitation delivery (`dispatchGuestInvitation
  Safely`, entirely inside `apps/api`) is instrumented. `dispatchMemberInvitationsOnOpen` lives
  entirely inside `packages/application/src/delivery.ts` with no return value surfaced to
  `apps/api`; extending the application layer's dependency-free `CommandContext.logger` port to
  also carry metrics would conflate two different concerns under time pressure, and this path is
  boot-refused outside development/test anyway (`VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED`,
  no real delivery provider selected yet) — low real-world impact today, flagged rather than
  forced.
- **Contribution latency** as a full user-journey metric (submit → resolved) was not built as
  its own instrument — interpreted the brief's "contribution latency"/"authorization latency"
  pair as being about the *provider-call* latency already covered by `vinkin_provider_call_
  duration_ms`, not a broader end-to-end journey timer, which would need a different
  measurement point (first contribution attempt → final resolution, potentially spanning a
  sweep-triggered resolution far later) not obviously reducible to one instrument.

## Exit gate

- [x] Metrics exist for API latency, provider latency (incl. authorization calls), worker
  failures, queue depth, realtime connections, invitation delivery, and health status.
- [x] Exposed cleanly via a real, independently-verified Prometheus `/metrics` endpoint.
- [x] No dashboard built (explicitly out of scope, per the brief's own words).
- [x] "What is happening?" is answerable without reading logs, for the seven metrics actually
  implemented — confirmed by a real scrape showing live values from real requests/health
  checks/queue state, not by inspection alone.
- [ ] Database latency and reconnect frequency are disclosed, not-yet-implemented gaps.

## Next

ENG4 Slice 5 (distributed tracing — propagating trace context through jobs/realtime/delivery/
provider adapters, building on the existing but currently single-process-only `otel.ts` trace
bootstrap).
