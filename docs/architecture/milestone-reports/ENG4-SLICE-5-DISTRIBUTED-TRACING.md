# ENG4 Slice 5 — Distributed Tracing

**Date:** 2026-07-24
**Scope:** Fourth and final pure-application-code slice of ENG4 (the owner-approved order: 1,
3, 4, 5 before the infrastructure/vendor-decision slices 2, 6, 7, 8, 9). Brief's goal: propagate
trace context through the API, workers, realtime, delivery, provider adapters, and background
jobs; trace one Vink from creation → invitation → contributions → funded → merchant payment →
completion. Exit criteria: "every major workflow can be visualized end-to-end."

## Design decision: bounded spans + a stable correlation attribute, not one giant span

A Vink's full lifecycle (creation → completion) can span up to `VINK_OPEN_DURATION_SECONDS`
(24h by default) plus recovery/settlement time — genuinely multi-hour, sometimes multi-day.
OpenTelemetry traces are shaped for bounded operations (milliseconds to minutes), not
multi-day business processes; forcing one OTel trace to span a whole Vink lifecycle would be a
real anti-pattern (a trace backend has no good way to display or query a trace that's still
"open" a day later). The standard, correct pattern for this — the one this slice implements —
is: every individual operation (one HTTP request, one job tick, one provider call) gets its own
normal-shaped span, and every span is tagged with a stable business identifier (`vink.id`,
`correlation.id`) as an attribute. A real trace backend's search-by-attribute view then lets an
operator find and order every span belonging to one Vink, reconstructing the full workflow —
without needing one span to literally span 24 hours.

## What was built

**`apps/api/src/observability/tracing.ts`** (new): `withSpan(name, attributes, fn)` — creates a
real span via `@opentelemetry/api`'s `tracer.startActiveSpan`, records exceptions and sets
`ERROR`/`OK` status, always ends the span. `tagActiveSpan(attributes)` — tags whatever span is
currently active (an HTTP auto-instrumented one, or one `withSpan` created) with extra
attributes; a safe no-op with nothing active.

Deliberately **not** a custom no-op-by-default wrapper like `metrics.ts`'s `Metrics`/
`NOOP_METRICS`: the OpenTelemetry API package is itself always safely callable — every method
here is already a genuine no-op when `otel.ts` hasn't started a real `NodeSDK`
(`VINKIN_OTEL_ENABLED` off, the default), by the OTel API's own design (a `ProxyTracer`
delegating to a no-op implementation until a real SDK registers). No second no-op layer needed,
unlike metrics, which had no equivalent always-safe library default.

**Because `startActiveSpan`'s callback runs inside the OTel context the new span
establishes**, any span created *from within* that callback automatically nests as a child —
this is the actual propagation mechanism, achieved without threading a span/context object
through every function signature in between.

**Wired at the real propagation gaps** (HTTP requests already get spans for free from
`otel.ts`'s existing auto-instrumentation — the audit's real finding was that nothing else
did):
- `jobs/sweeps.ts`: the whole sweep tick is now `withSpan('vink.sweep', ...)` — no HTTP request
  triggers a sweep, so without this it got no span at all; everything nested inside (each
  command's own provider calls) now genuinely nests under it.
- `jobs/worker.ts`: each heartbeat job is `withSpan('vink.heartbeat', ...)`.
- `observability/provider-logging.ts` (Slice 3/4's existing `withProviderLogging` wrapper): now
  also wraps each call in `withSpan('provider.<method>', ...)` — one wrapper now serving
  logging, metrics, *and* tracing, since all three fire around the identical call. This is what
  makes "propagate trace context through… provider adapters" real for both the HTTP path (nests
  under the request's auto-span) and the job path (nests under `vink.sweep`), without touching
  the provider interface itself.
- `modules/vinks/routes.ts`'s `dispatchGuestInvitation`: the delivery-provider `.send()` call is
  now `withSpan('delivery.send', { 'vink.id', 'correlation.id', method }, ...)`.
- Seven HTTP route context-builders (`contributions`/`purchases`/`recovery` ×2/`ops`/`vinks`/
  `sharing`) now call `tagActiveSpan({ 'correlation.id': ... })` — tagging the real
  per-request auto-instrumented span with the same correlation ID every log line (Slice 3) and
  DB history row already carries, so a trace found via one system can be cross-referenced via
  the others.

**One deliberately lower-risk choice**: `modules/realtime/routes.ts`'s WebSocket
connection-setup handler has many early-return branches (bad params, missing token, invalid
token, forbidden, not found — five distinct rejection paths interleaved with the actual auth/
snapshot-fetch logic). Restructuring it around a `withSpan` callback would have meant changing
control flow in security-sensitive authentication code for a real but smaller benefit.
Instead, it calls `tagActiveSpan({ 'vink.id', 'correlation.id' })` right after `vinkId` is
parsed — safe (a no-op if nothing is active), no control-flow change, real value if Node's HTTP
auto-instrumentation does cover the WS upgrade request (not independently verified this slice
— see gaps below).

## A real test-infrastructure detour, worth recording

The first version of `tracing.test.ts` used `@opentelemetry/sdk-node`'s `NodeSDK` (the same
class `otel.ts` uses) with an `InMemorySpanExporter`, and consistently saw zero exported spans
even after `sdk.shutdown()`. Root-caused via a standalone debug script: `NodeSDK`'s default
`traceExporter` wiring buffers through a `BatchSpanProcessor` (a ~5-second default delay) —
completely expected, standard, correct behavior for production (batching is the right tradeoff
there), just wrong for a test that checks synchronously. Confirmed by waiting long enough that
the span DID appear before shutdown. **No defect in `otel.ts`** — its production trace pipeline
is untouched by this and was never in question. The test was rewritten on the lower-level
`NodeTracerProvider` + `SimpleSpanProcessor` (synchronous, no batching) — the standard pattern
for fast, deterministic span-export tests — which resolved it immediately and is what ships.

## Tests

- `apps/api/src/observability/tracing.test.ts` (new, 5 tests, real OTel SDK — not mocked):
  `withSpan` creates a real span with the right name/attributes and ends it;
  records an exception + sets `ERROR` status on failure, still rethrows; **a nested `withSpan`
  call becomes a real child of the outer span** (same trace ID, correct parent span ID) — the
  actual propagation proof; `tagActiveSpan` tags the currently-active span, visible on the
  exported span; `tagActiveSpan` is a safe no-op with nothing active.
- `apps/api/src/observability/provider-logging.test.ts` (Slice 3's existing 5 tests): re-run
  unchanged and still pass — confirms adding the span wrapper introduced no regression when no
  SDK is registered (the normal test/dev-without-OTel-enabled case).

## Verification

- `pnpm typecheck`: 10/10 packages clean.
- `pnpm lint` / `pnpm format:check` / `pnpm guard`: clean.
- `apps/api`: **162/162** (up from 157 pre-slice).
- Real process verification (not simulated): a full `node src/server.ts` boot with
  `VINKIN_OTEL_ENABLED=1` — real requests (`/health/ready`, `/health/live`) served
  successfully, no crashes or unexpected errors in the logs (only the already-known, expected
  OTLP-export-has-no-collector noise `otel.ts`'s own doc comment already describes) — confirms
  the tracing wiring across eight files doesn't break real server startup or request handling
  when actually enabled, not just when disabled.

## Known, disclosed gaps

- The realtime WebSocket connection-setup path uses `tagActiveSpan` rather than a dedicated
  manual span, and whether Node's HTTP auto-instrumentation actually creates a span for a WS
  upgrade request (as opposed to a plain HTTP request) was not independently verified this
  slice — flagged rather than assumed. A future pass with a real trace backend running could
  confirm this directly.
- No dedicated span exists for `dispatchMemberInvitationsOnOpen` (entirely inside
  `packages/application/src/delivery.ts`) — the same architectural boundary noted in Slice 4's
  report (extending the application layer's dependency-free ports for a third cross-cutting
  concern was judged out of proportion for this slice, and this path is boot-refused outside
  dev/test anyway).
- This slice was verified structurally (real span creation, real parent-child nesting, real
  attribute tagging, real production-shaped server boot) but not against a live trace backend
  (Jaeger/Tempo/Honeycomb) showing an actual visualized end-to-end workflow — no such backend
  exists in this local environment (no Docker, per the repo's own machine notes), and standing
  one up is arguably ENG4 Slice 2's infrastructure territory, not this slice's. The exit
  criteria's literal "every major workflow can be visualized end-to-end" is therefore
  structurally supported (the right spans, attributes, and nesting now exist) but not
  visually confirmed — disclosed, not silently claimed as done.

## Exit gate

- [x] Trace context propagates through the API (auto-instrumented + correlation-tagged),
  workers (`vink.sweep`, `vink.heartbeat`), delivery (`delivery.send`), and provider adapters
  (`provider.<method>`, nested under whichever of the above triggered it).
- [x] A stable `vink.id`/`correlation.id` attribute scheme exists for cross-trace correlation of
  one Vink's full lifecycle, given the deliberate (and disclosed) choice not to force one
  multi-hour span.
- [ ] Realtime connection-setup tracing is tag-only, not a dedicated span (disclosed, scoped
  decision, not an oversight).
- [ ] Visual end-to-end confirmation against a real trace backend is unverified — no backend
  available locally; structural correctness proven instead.

## ENG4 status: all four owner-approved pure-application-code slices done

Slices 1 (production configuration), 3 (structured logging), 4 (metrics), and 5 (distributed
tracing) are complete. The remaining five brief items — Slice 2 (deployment topology), Slice 6
(Universal Links/App Links), Slice 7 (secrets management), Slice 8 (release pipeline), Slice 9
(crash reporting) — each depend on a real infrastructure or vendor decision (hosting platform
and staging domain, a secrets manager, a crash-reporting vendor) that wasn't guessed at, per the
plan agreed before starting this run. Slice 10 (operational readiness certification) depends on
those being done first. Awaiting owner input on those choices before continuing.
