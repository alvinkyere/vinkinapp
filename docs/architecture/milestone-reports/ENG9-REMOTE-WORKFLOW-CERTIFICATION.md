# ENG9 — Remote Workflow Certification

**Date:** 2026-07-28
**Scope:** `docs/architecture/eng-roadmap.md`'s ENG9 — certify the system under 17 named
failure scenarios, with a formal pass/fail certification report.

## Audit first, then two owner decisions before building

An Explore-agent audit checked all 17 scenarios against real test files before any new code
was written (mirroring ENG6/ENG7/ENG8's own precedent). It found 9 already solidly proven,
4 proven only by design/code reasoning with zero test evidence, and 2 genuinely open gaps —
full detail in the table below. Two things needed the owner's own call before proceeding,
resolved via `AskUserQuestion`:

- **Scenario #15 ("contribution during cutoff")** has no backing logic anywhere — no T-15s
  soft-close window exists, a gap prior milestones (ENG1-TIMER-SEMANTICS.md) already flagged
  as deliberately undecided. Owner choice: **document as a gap, don't build it** — this would
  be new product/business behavior, not something to add silently while chasing a
  test-coverage checklist.
- **Scenarios #1–4 and #17** ask to certify against the LIVE hosted Railway deployment. This
  environment has no Railway CLI or credentials at all (confirmed: `railway` command not
  found, no `RAILWAY_*` env vars present) — genuinely cannot restart or interrupt anything
  hosted from here. Owner choice: **certify via equivalent local tests instead**, disclosing
  that literal hosted-infra chaos testing is a separate, owner-run action.

## Certification table

| # | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | API restart during setup | **PASS** | `eng9-process-restart.integration.test.ts` — a real `SIGKILL` of a real `node src/server.ts` child process mid-setup, then a genuinely new process restarted on the same port, replays the exact same Vink via idempotency (never mints a second one), and the flow continues normally afterward. |
| 2 | Worker restart during deadline processing | **PASS, reframed** | Deadline sweeps run inside the API process itself, not `jobs/worker.ts` (that file's own header comment: sweeps move to a real worker only once a real external provider adapter exists) — "during deadline processing" doesn't map onto this architecture yet, disclosed rather than faked. What's real (the PV1 heartbeat worker, a genuinely separate process) is tested: a real `SIGKILL` + restart resumes cleanly with no manual intervention. |
| 3 | Redis restart | **PASS (local only)** | `eng9-infra-restart.manual.ts` — real local Redis genuinely stopped via `brew services stop redis`; the API stays up, `/health/ready` correctly reports `redis: down` while `database: ok`, DB-only operations (registration, Vink creation) keep working through the outage, and health fully recovers once Redis returns. Not hosted-Railway-verified — see the owner decision above. |
| 4 | PostgreSQL failover / connection interruption | **PASS (local only)** | Same file — real local PostgreSQL genuinely stopped; a request during the outage fails within a bounded time (never hangs) with a real 5xx, health recovers once Postgres returns, and a **post-recovery request actually succeeds** (proves the connection pool truly heals, not just that a shallow ping happens to work once). |
| 5 | WebSocket disconnect | **PASS (pre-existing)** | `realtime.integration.test.ts` — reconnection replaces stale local state with a fresh authoritative snapshot; `apps/mobile`'s `RealtimeClient` and `apps/guest-web`'s reconnect logic both have dedicated backoff/reconnect tests (ENG3 Slice 1). |
| 6 | App backgrounding | **PASS** | `test/core/realtime/realtime_client_test.dart` — previously only the pure backoff/connectivity functions were tested, never the real `AppLifecycleListener` wiring. Three new tests walk the actual OS transition sequence (`resumed → inactive → hidden → paused` and the reverse — Flutter's own `AppLifecycleListener` enforces this via internal asserts; a direct `resumed → paused` jump is silently a no-op, a real gotcha this pass hit and fixed in the test itself) and prove `isPausedInBackground` (a new `@visibleForTesting` getter) toggles correctly, and that `connect()` is a genuine no-op while backgrounded. |
| 7 | Guest browser refresh | **PASS (pre-existing, adjacent)** | `realtime.integration.test.ts` — a guest reconnecting gets the same guest-scoped snapshot-on-connect guarantee as scenario #8, functionally equivalent to a refresh. |
| 8 | Stale client snapshot | **PASS (pre-existing)** | `realtime.integration.test.ts` — reconnection is explicitly asserted to replace stale local state with a fresh authoritative snapshot (Plan §14's own guarantee). |
| 9 | Duplicate webhook | **PASS (pre-existing)** | `webhooks.integration.test.ts` — replay protection and dead-letter dedup both proven against real signed deliveries. |
| 10 | Out-of-order webhook | **PASS (pre-existing)** | `reconciliation.integration.test.ts` — interpretation follows the provider's own `occurred_at`, never HTTP arrival order, with a dedicated `seq` proof. |
| 11 | Delayed provider callback | **PASS (pre-existing)** | `contributions.integration.test.ts` — a delayed authorization resolves late and funds during grace (simulator pending-resolve). |
| 12 | Lost response after committed mutation | **PASS (pre-existing + strengthened)** | `contributions.integration.test.ts`'s E5 lost-response test plus `vinks.integration.test.ts`'s create-idempotency test already covered this at the application layer; scenario #1 above now additionally proves it survives a REAL process kill, not just a simulated interruption. |
| 13 | Two devices operating on one Vink | **PASS (pre-existing, analog)** | `invites.integration.test.ts`'s genuine concurrent double-accept and `vinks.integration.test.ts`'s concurrent-open test both model two independent actors racing on the same Vink via real row-lock serialization. |
| 14 | Simultaneous contributions | **PASS, gap closed** | The existing test only raced one participant against itself (double-taps). New: `contributions.integration.test.ts`'s "ENG9 #14" test races two genuinely DIFFERENT participants concurrently via `Promise.all`, proving the D5 single-resolver fires exactly once (one `VinkFunded` event, not zero or two) even when two independent requests could both plausibly believe they're "the one that completes funding." |
| 15 | Contribution during cutoff | **NOT BUILT — documented gap** | Owner-directed: no cutoff/soft-close logic exists anywhere in this codebase; not invented here. Revisit trigger: an explicit product decision to build the Spec §14 T-15s soft-close window. |
| 16 | Expired token | **PASS, gap closed** | The existing test only covered *reuse* of a rotated-out refresh token — a different code path from genuine TTL expiry. New: `auth.integration.test.ts` ages a real, never-rotated refresh token's `expires_at` into the past directly in PostgreSQL and confirms `401`; a second new test constructs a real JWT access token (the app's own real `JWT_SECRET`, only `exp` backdated) and confirms `verifyAccessToken`'s real `jose` expiry check rejects it. |
| 17 | Deployment during an active Vink | **PASS — and a real production defect found + fixed** | See below. |

## The real defect: graceful shutdown was silently dropping in-flight requests

The first live run of the #17 test (`eng9-process-restart.integration.test.ts`) failed
**consistently**, not flakily — a real `SIGTERM` sent to a real server process while a
`POST /vinks` request was genuinely in flight (confirmed via the server's own real
`"incoming request"` log line, not a timing guess) killed the connection before the response
was ever sent, every time.

Root-caused with a minimal reproduction outside this app (a bare Fastify instance with a
`setTimeout`-delayed handler, no database involved) before touching any production code:
Fastify's default `forceCloseConnections: 'idle'` calls Node's `server.closeIdleConnections()`
as the very first step of `close()`. Node's idle-heuristic operates at the raw socket level —
a connection whose request has been fully *received* but whose handler is still working (no
socket I/O happening at that exact instant, e.g. mid-database-transaction) looks identical to
a genuinely idle keep-alive connection. Every deploy, every restart, could silently drop
whatever request happened to be in flight at that moment — a defect present since `server.ts`
was first written in PV1, never caught because nothing had ever exercised a *real* OS-level
kill against a *real* in-flight request before this test existed.

**Fixed in two parts**, each verified against the same minimal reproduction before being
applied to `apps/api`:

1. `app.ts` gained an `AppDeps.forceCloseConnections` override, defaulting to Fastify's normal
   behavior for every existing caller (dozens of integration test files, several of which open
   real WebSocket connections and call `app.close()` in their own `after()` hook with no
   timeout — `forceCloseConnections: 'idle'` is exactly what lets *that* `close()` resolve
   promptly, since an idle WS connection is the legitimate case that setting exists for). Only
   `server.ts` — the one real production entrypoint — sets it `false`.
2. `server.ts`'s shutdown handler implements the standard "grace period, then force" pattern
   explicitly, rather than relying on Fastify's single all-or-nothing setting: a genuinely
   in-flight request gets time to finish naturally (`IDLE_CONNECTION_GRACE_MS`, tuned to 500ms
   — generous against this app's real observed request latencies, single-to-low-double-digit
   milliseconds throughout this repo's own test timings), after which any connection still
   open (now safely idle, or a genuinely stuck edge case) gets force-closed via
   `app.server.closeIdleConnections()`. A hard outer deadline (`GRACEFUL_SHUTDOWN_TIMEOUT_MS`,
   10s) is the absolute backstop so a truly stuck connection can never hang shutdown forever.

Verified through the full arc: initially failed 100% reproducibly (3/3 runs); the naive first
fix (`forceCloseConnections: false` with no grace window) fixed the drop but reintroduced the
opposite problem — a full 10-second shutdown on *every* run, confirmed by observing the test's
own timing pin to almost exactly the hard-timeout value; the tuned grace-period fix above
brought shutdown back to ~580ms (essentially the grace window plus overhead) while still
correctly completing the in-flight request, stable across repeated runs. The full `apps/api`
suite, which had genuinely hung on this exact trade-off during the naive fix (a concurrently
running WebSocket test's own `app.close()` call never returned), passes clean at normal speed
with the final version.

## New test infrastructure

- `testing/child-server.ts` — spawns real `node src/server.ts`/`node src/jobs/worker.ts` child
  OS processes, with either HTTP-poll (`/health/ready`) or real-log-line-based readiness
  detection (worker.ts has no HTTP surface at all).
- `testing/child-process-db.ts` — a dedicated, fully separate PostgreSQL *database* (not just
  a schema like the rest of this repo's isolated-test pattern) per spawned-process suite,
  since a real child process needs its own independently connectable `DATABASE_URL`.
- `eng9-process-restart.integration.test.ts` — scenarios #1, #2, #17. Runs as part of the
  normal `apps/api` test suite (spawns its own disposable processes/databases; doesn't touch
  shared infrastructure, safe to run concurrently with everything else).
- `eng9-infra-restart.manual.ts` — scenarios #3, #4. **Deliberately excluded** from the
  default `npm test` glob (named `.manual.ts`, not `.test.ts`) after the first real run of
  this exact file, before the rename, broke a concurrently-running `realtime.integration
  .test.ts` suite by stopping shared Redis out from under it — `node --test`'s default glob
  runs test files concurrently, and this suite intentionally stops/starts the same local
  Postgres/Redis every other suite depends on. Has its own dedicated script,
  `npm run test:eng9-infra-restart`, meant to be run in isolation. Also genuinely **not
  CI-portable as written** — `brew services` doesn't exist in GitHub Actions' runner (CI's
  Postgres/Redis are Docker service containers, a different lifecycle entirely); disclosed,
  not silently left out of CI without explanation.

## Tests

- `apps/api`: **269/269** (up from 260 before this milestone) — includes the 9 new
  process-restart/infra-restart tests, 2 new token-expiry tests, and 1 new true-concurrency
  test. `eng9-infra-restart.manual.ts`'s 2 tests run separately, confirmed green in isolation,
  not counted in the default-suite total by design.
- `apps/mobile`: **254/254** (up from 251) — 3 new real `AppLifecycleListener` tests.
  `flutter analyze`: unchanged at the documented 26-issue baseline.
- `packages/application`: **137/137**, unchanged — confirms this milestone stayed entirely
  inside `apps/api`'s and `apps/mobile`'s own transport/client layers.

## Verification

- `pnpm typecheck`/`lint`/`format:check`/`guard`: clean, 12/12 packages.
- The full `apps/api` suite (including the new process-restart tests, which genuinely spawn
  and kill real OS processes) re-run repeatedly for stability, not just once — the #17 test
  specifically was run 3+ times after each fix iteration to confirm it wasn't flaky.
- `eng9-infra-restart.manual.ts` genuinely stops and restarts real local Redis and PostgreSQL
  — confirmed both services healthy (`redis-cli ping` → `PONG`,
  `pg_isready` → `accepting connections`) after every run, including after the one run that
  originally broke a concurrent suite (root-caused and fixed, not just noted).

## Known, disclosed gaps

- **Scenario #15 (contribution during cutoff)** is not built — owner choice, a real product
  decision deferred, not silently invented.
- **Scenarios #1–4 and #17 are certified locally, not against the live hosted Railway
  deployment** — owner choice, given this environment has no Railway credentials at all.
  Genuinely proving these against the hosted environment (real API/worker/Redis/Postgres
  restarts on `api.vinkin.org`) remains a separate, owner-run action.
- **`eng9-infra-restart.manual.ts` is not wired into CI** — `brew services` has no equivalent
  in the GitHub Actions runner's Docker-service-container topology; a `docker stop`/`start`
  rewrite would be needed to make this CI-portable, not attempted here.

## Next

Per `docs/architecture/eng-roadmap.md`'s sequence
(`... → ENG8 → ENG9 → PV12 → M0 → ENG12 → ...`), the next unblocked item is **PV12** — but
PV12 is the actual closed campus pilot, an owner/operational decision (real people, a real
closed pilot), not something code can satisfy on its own; M0 (the real-money authorization
gate) remains blocked on the same owner-outreach/sandbox-account conditions documented since
early in this project. ENG9 itself is complete for what code can certify.
