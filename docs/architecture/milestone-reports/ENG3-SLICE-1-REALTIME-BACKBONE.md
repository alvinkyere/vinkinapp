# Milestone Report — ENG3 Slice 1: Realtime Backbone Hardening

Date: 2026-07-22 · Track: engineering (owner-supplied ENG0–ENG15 plan, full brief restated by
the owner this session) · Scope: the first of six owner-approved slices of ENG3 ("Client
Reliability Architecture" — Flutter, Next.js, and the realtime layer, without making visual/UX
decisions). This slice: reconnect backoff+jitter, an application-level heartbeat, lifecycle-
aware reconnection, and fixing the real stale-response bug the audit surfaced — on both
`apps/mobile` and `apps/guest-web`'s realtime clients.

## Audit first, then implement

Before writing any code, three parallel audits (two backgrounded `Explore` agents for
`apps/mobile`/`apps/guest-web`, one done directly for the realtime layer) checked ENG3's full
~30-item checklist against real code, not impressions. Full findings were presented to the
owner, who chose "my proposed order" from an `AskUserQuestion` — six slices, this being the
first: realtime backbone hardening, chosen first because it fixes a real bug and covers 4 of
ENG3's own 8 exit-gate scenarios (WS blocked, events out of order, network changes, app
backgrounded). The other five slices (Flutter typed-repository + command-state layer, Flutter
resilience primitives, Flutter deep-link routing, guest-web hardening, error-mapping cleanup)
remain queued, not started.

**The real bug**: `apps/guest-web/features/join/use-guest-realtime.ts`'s per-live-message
`GET /api/v1/guest/session` refetch had no request-sequence guard — an older-issued request
that happened to *resolve* later than a newer one could overwrite fresher state with stale
data. This is the exact bug class `apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart`'s
`_snapshotRequestId` counter already guards against (fixed there during PV13-SCREENSHOTS.md's
own capture pass) — never applied to guest-web until now.

## What changed

**Backend** (`apps/api/src/modules/realtime/routes.ts`): a `socket.on('message', ...)` handler
answers a client's `{type:'ping'}` with `{type:'pong'}` — the WebSocket protocol's own
ping/pong control frames aren't exposed to application code by browsers or Dart's
`IOWebSocketChannel`, so liveness has to be checked at the application layer instead. Malformed/
non-JSON messages are silently ignored, never crash the connection.

**`apps/mobile/lib/core/realtime/realtime_client.dart`** (full rewrite, same public API — the
one call site, `vink_lobby_screen.dart:149`, needed no changes):
- `reconnectDelay(int attempt, {Random? random})` — a pure, top-level, unit-tested function:
  exponential backoff (1s base, ×2 per attempt, 30s cap) with ±20% jitter, replacing the old
  flat 2-second retry.
- A 20s-interval/10s-timeout ping/pong heartbeat; no pong within the timeout force-closes the
  socket so the existing reconnect path takes over, rather than silently sitting on a dead
  connection.
- An embedded `AppLifecycleListener` (no `WidgetsBindingObserver` mixin needed on the Lobby
  screen's `State` — Flutter 3.13+'s standalone listener API works from any plain Dart class):
  `onPause` cancels the reconnect timer, stops the heartbeat, and closes the socket — no point
  spending battery/network retrying a screen nobody can see; `onResume` resets the backoff
  counter and reconnects immediately. A backgrounded socket is frequently killed by the OS
  without a clean `close` event ever firing, so waiting out a normal backoff on return would
  leave a resumed screen looking stale for several seconds — this fixes that, and the server's
  own "always send a fresh `snapshot` on connect" behavior (PV8) means the reconnect alone is
  sufficient, no separate catch-up logic needed.

**`apps/guest-web/features/join/use-guest-realtime.ts`** (full rewrite, same public
`GuestRealtimeResult` shape):
- The stale-response fix: a `requestSeqRef` counter shared by every call path that can trigger
  a `getGuestSession` refetch (the per-message refetch and the explicit `refetch()` exposed to
  `SessionView`) — only the most recently *issued* request's result is ever applied, regardless
  of resolution order.
- `reconnectDelayMs(attempt, random?)` — the same exponential-backoff-with-jitter shape as the
  Dart side, exported and unit-tested, `Math.random` injectable for deterministic tests.
- The same ping/pong heartbeat pattern, and a `visibilitychange` listener: on the tab becoming
  visible again, reconnects immediately (bypassing the backoff wait, since a backgrounded
  mobile tab is frequently network-throttled or has its socket closed outright without a clean
  `close` event) and refreshes state.

## Tests

- `apps/mobile/test/core/realtime/realtime_client_test.dart` (new, 5 tests): exact-value
  assertions on `reconnectDelay` via an injectable `Random` (attempt-0 centering, monotonic
  growth, the 30s cap, both jitter-band edges, never-zero) — a pure function, no socket/timer
  mocking needed.
- `apps/guest-web/tests/realtime-reconnect.spec.ts` (new, 5 tests): the identical assertions
  for `reconnectDelayMs`, run as a pure-logic Playwright test (this repo's own established
  pattern for guest-web unit tests, `guest-copy.spec.ts`).
- `apps/guest-web/tests/guest-realtime-stale-response.spec.ts` (new, 1 test): a genuine
  regression test for the real bug — two mocked `GET /api/v1/guest/session` responses, the
  first issued-but-slower (500ms delay, "stale" data), the second issued-later-but-faster
  (50ms delay, "fresh" data); asserts the final rendered "Your share" figure is the fresh
  value, never the stale one. **Verified this test actually catches the bug**: temporarily
  reverted the `requestSeqRef` guard, confirmed the test fails exactly as expected (the stale
  response wins), then restored the fix and confirmed it passes again — not just a test that
  happens to pass, a proven regression test.
- `apps/api/src/realtime.integration.test.ts` (extended, +1 test): a real WebSocket client
  sends `{type:'ping'}` against the real server (real Postgres + real Redis, `RedisRealtimeHub`
  — PV8.5's own exact test harness), confirms a `{type:'pong'}` reply, sends malformed/
  non-ping messages to confirm they're silently ignored and the connection survives, then a
  second ping still gets answered. Caught and fixed a real test-ordering bug of its own while
  writing this: the server's `socket.on('close', ...)` → `unsubscribe()` cleanup is
  intentionally fire-and-forget (`void unsubscribe()`), so a test that closes its own socket
  and is *also* the last test in the file can race the suite's `after()` hook disconnecting
  Redis before that cleanup finishes — fixed by not making this the file's last test (matching
  every other test in the file that already avoids this by construction), not by adding an
  artificial delay.

## A second real finding: dev-environment cruft, not a code defect

Verifying this slice against `apps/operations-console`'s exit-gate Playwright test surfaced the
exact "poisoned dev database" failure mode `milestone-reports/ENG1-TIMER-SEMANTICS.md` already
documented once before: a vink got stuck at `FUNDED`, never reaching `CARD_READY`, timing out
after 30s. `apps/api`'s own isolated-test-DB suite already proved the sweep→card-provisioning
mechanism itself is correct (98/98, including that exact flow against a fresh DB) — ruling out
a code regression from this slice's changes (which don't touch card provisioning at all).
Root-caused to two stacked issues: a genuinely stale `node --watch src/server.ts` process
squatting on port 3000 from earlier in this session (my own "restart" was silently talking to
the old process the whole time — `EADDRINUSE` in its logs gave it away), and — even after
killing that — the same underlying accumulated-dev-Postgres-cruft issue ENG1's report already
named. Fixed by dropping and recreating the local `vinkin` database, re-running
`migrate`/`seed`, and `redis-cli FLUSHALL`, then restarting cleanly — `apps/operations-console`
went to 2/2 and `apps/guest-web` picked up two more passes it had also been silently losing to
the same cruft (10 failures → 8, both of the newly-passing ones unrelated to the genuine
pre-existing Slice I3/I3A gap below).

## A known, pre-existing gap this slice could not verify around

Re-running the real-device `apps/mobile/integration_test/e1_test.dart` (this project's own
established verification method for realtime/Lobby changes) failed before ever reaching the
Lobby screen this slice actually touches — at the Register screen, not the Lobby. Traced to a
genuine, pre-existing mismatch: `register_screen.dart` now has 5 fields (name, username, email,
phone, password, in that order — the concurrent UX-track session's own D19/D27 contact-capture
addition), but `e1_test.dart` still fills only 3 by index (`registerFields.at(0..2)`, assuming
name/username/password), so the actual password field is never filled and the account is never
created. Confirmed unrelated to this slice via direct inspection (server-side registration
works correctly via a manual `curl`) and via `git log` (both files last touched in a commit
that predates this session's own edits). Not fixed here — it's another session's in-flight
test file, out of this slice's scope, and fixing it risks a real conflict with whatever that
session is mid-way through. Flagged for whoever picks it up next: the fix is likely as small
as indexing the password field correctly (or by key) in `e1_test.dart`, but that's a
one-line-away guess, not a verified fix. This slice's Flutter changes were instead verified via
`flutter analyze` (clean, zero new issues) and the full `flutter test` suite (111/111,
including the 5 new `reconnectDelay` tests) — real-device Lobby verification for this specific
change is a follow-up once the Register-screen gap is fixed, not skipped by choice.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard` — clean, all 10 packages.
- `apps/api`: **98/98** (up from 97 — the new heartbeat test).
- `apps/mobile`: `flutter analyze` clean (11 pre-existing info-level issues, unchanged, none in
  any file this slice touched); `flutter test` **111/111** (up from 105 pre-slice — the 5 new
  `realtime_client_test.dart` tests plus concurrent-session work already in the tree).
- `apps/guest-web`: **41 passed**, 8 failed, 1 skipped, against a freshly reset dev DB — the 8
  failures are the same pre-existing Slice I3/I3A terminal-copy gap confirmed via `git log` in
  `milestone-reports/ENG2-CLOSURE-TYPED-CONTRACTS.md`, not a regression; the 6 new tests this
  slice added (`realtime-reconnect.spec.ts` ×5, `guest-realtime-stale-response.spec.ts` ×1) all
  pass, the latter proven to actually catch the bug it targets.
- `apps/operations-console`: **2/2**, against the same freshly reset dev DB.
- Real-device: blocked by the pre-existing, unrelated Register-screen gap above — not run to
  completion; flagged, not silently skipped.

## Files changed

- Modified: `apps/api/src/modules/realtime/routes.ts`,
  `apps/mobile/lib/core/realtime/realtime_client.dart`,
  `apps/guest-web/features/join/use-guest-realtime.ts`.
- New: `apps/mobile/test/core/realtime/realtime_client_test.dart`,
  `apps/guest-web/tests/realtime-reconnect.spec.ts`,
  `apps/guest-web/tests/guest-realtime-stale-response.spec.ts`.
- Extended: `apps/api/src/realtime.integration.test.ts` (+1 test, +1 helper).

## Exit gate (this slice's own scope, not ENG3's full 8-scenario gate)

- [x] Reconnect uses exponential backoff+jitter on both clients, not a flat delay.
- [x] An application-level heartbeat detects a connection that looks open but has gone
      silently dead, on both clients and the server.
- [x] Both clients stop retrying while backgrounded and reconnect immediately on resume/tab-
      visible, rather than blindly retrying on a fixed interval regardless of app state.
- [x] The real stale-response bug is fixed, with a regression test proven to actually catch it.
- [x] Full verification suite green except the two named, pre-existing, unrelated gaps (both
      confirmed via git history, not assumed).

## Next

Slice 2 (Flutter typed repository + command-state layer) is next in the owner-approved order,
pending the owner's go-ahead to continue.
