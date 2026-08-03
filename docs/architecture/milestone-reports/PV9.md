# Milestone Report — PV9 (Organizer Mobile Application)

Date: 2026-07-19 · Track: product validation · Master plan §19/§20/§24. Exit gate: "An
organizer can complete E1 entirely from the Flutter application" — verified below on a real
iOS Simulator against the real local backend, not a mock.

## What was implemented

A Flutter app (`apps/mobile/`) covering the organizer's full E1 journey: register/login →
create a Vink (category, total) → add participants by username → review a split → open the
Vink → watch funding, card issuance, and purchase completion live over the same WebSocket
channel PV8/PV8.5 built, with no polling and no manual refresh.

**Layout matches Plan §19**: `lib/app/` (shell, theme, router), `lib/core/{auth,networking,
storage,realtime,errors,analytics}`, `lib/design_system/{colors,typography,spacing,
components}`, `lib/features/{onboarding,home,create_vink,vink_lobby,profile}`. Stack per
Plan §4: `flutter_riverpod` (state), `go_router` (routing, with an auth-aware redirect),
`dio` (HTTP, bearer-token interceptor with one-shot refresh-and-retry on 401),
`flutter_secure_storage` (Keychain-backed token storage — the only place tokens touch disk),
`web_socket_channel` (realtime, auto-reconnect).

**Design system** includes a `SimulationBanner` component shown whenever a Vink is in a
money-bearing simulated state (FUNDED through COMPLETED) and a `_CardCard` widget explicitly
labeled "SIMULATED CARD" — the mock-card-must-be-clearly-labeled requirement from Plan §19,
verified visually during manual runs and structurally by the E1 test asserting on that exact
text.

**Backend addition**: `GET /api/v1/vinks` (list the signed-in organizer's own Vinks, newest
first) — Plan §20's "Vink history" needed a list endpoint that no prior PV added (PV3's API
only ever addressed a single Vink by id). Added through the existing D13 command/query
pattern: `VinkReader.listVinksByOrganizer` port method, `listMyVinks` query function, both
store implementations, one route, one test.

## Two real bugs found and fixed by end-to-end testing

Both were invisible to every prior test in this repo because nothing before PV9 had ever
driven `apps/api/src/server.ts` as a live process end-to-end, or exercised the mobile
client's realtime state machine against real server timing. This is exactly the category of
defect the Spec's "verify against real infrastructure" discipline exists to catch.

1. **BullMQ `maxRetriesPerRequest` misconfiguration silently killed the sweep scheduler and
   the PV1 heartbeat worker.** `createRedis()` (`apps/api/src/redis/client.ts`) sets
   `maxRetriesPerRequest: 1`, correct for fast-failing health checks and the realtime hub —
   but BullMQ's `Queue`/`Worker` classes reject any connection where that option isn't
   exactly `null` (they use blocking commands incompatible with ioredis's request-retry
   limiting) and throw at construction. `startSweepScheduler` caught the exception and only
   logged a misleading warning ("sweep scheduler not started (Redis unavailable?)") even
   though Redis was reachable — so the sweep, and therefore all deadline-driven transitions
   (submission close, grace resolution, card provisioning) had never actually run outside of
   tests that call `runSweeps` directly as a pure function. **Fixed**: added
   `createBullMqRedis(env)`, a second factory with `maxRetriesPerRequest: null`, used by both
   `sweeps.ts` and `worker.ts`; `createRedis()` is unchanged for its other callers. Confirmed
   by restarting the real server and reading the log: `"deadline sweep scheduler started"`
   instead of the swallowed warning.
2. **The Lobby screen never picked up card data delivered by a live state-change event.**
   `apps/api/src/realtime/outbox-publisher.ts` deliberately sends a lean payload per event
   (`state`, `fundedAmountMinor` — not the full snapshot). The Lobby's message handler
   patched only those two fields and left `card`/`participants` pinned to whatever the last
   full snapshot had — null, before a card exists. The in-code comment even described a
   "pull-to-refresh affordance below" that was never actually built. Net effect: a Vink could
   reach CARD_READY live (correct state, correct progress bar) while the card itself stayed
   invisible indefinitely. Caught by the E1 test polling for the "SIMULATED CARD" text and
   timing out even though `psql` showed the vink genuinely in `CARD_READY` with a real card
   row. **Fixed**: `_onMessage` now still applies the lightweight patch immediately (snappy
   header update), then re-fetches the full snapshot via REST on every non-snapshot message —
   one cheap round trip per domain event, not per second.

A third, non-product issue surfaced by the same run: the iOS Simulator's Keychain outlives
app reinstalls, so a session saved by an earlier dev/test run made a later `flutter test`
run boot straight past onboarding into Home. Fixed by having the E1 test call
`SecureTokenStore().clear()` before pumping the app, so every run starts from a genuinely
signed-out device regardless of prior state.

## Files changed

New: `apps/mobile/` (30 Dart files — full app), `apps/api/src/redis/client.ts`
(`createBullMqRedis`), `docs/architecture/milestone-reports/PV9.md`.
Modified: `apps/api/src/jobs/{sweeps,worker}.ts` (use `createBullMqRedis`),
`apps/api/src/modules/vinks/{routes,store}.ts`, `packages/application/src/{ports,queries,
commands.test,testing/in-memory}.ts` (list-my-vinks), status docs.

## Database changes

None (no schema change — `GET /api/v1/vinks` is a read against existing columns).

## APIs added

`GET /api/v1/vinks` — the organizer's own Vinks, newest first (Plan §20 "Vink history").

## UI added

The full organizer-facing Flutter app: Welcome, Login, Register, Home (Vink list), Create
Vink (category → total → participants → split review → open, collapsed from Plan §20's
separate screens into one guided flow — a pragmatic PV9 scope choice, flagged below), Vink
Lobby (live funding/card/completion), Profile.

## Tests added

- Backend: 1 new unit test (`listMyVinks` — organizer isolation, newest-first ordering).
  Full suite after this milestone: **147 unit + 55 integration, all green** against real
  local PostgreSQL 16 and real local Redis (Homebrew, no Docker) — `lint`, `format:check`,
  the provider-import `guard`, and `typecheck` all clean across every package.
- Mobile: `test/widget_test.dart` (host-side smoke test — boots to Welcome with a mocked
  empty Keychain) and `integration_test/e1_test.dart`, the actual exit-gate proof — driven
  through real XCTest touch injection on a real booted iOS Simulator (`iPhone 17 Pro`)
  against the real local server (Postgres + Redis + `apps/api/src/server.ts`, no mocks).
  Only the organizer's own actions go through app UI; the two participants' contribution
  approvals and the merchant capture are driven by direct HTTP calls, matching the master
  plan's own screen split (participant/guest UI is PV10 scope; the merchant/ops console is
  PV11 scope — neither is this milestone's to build). The test passed end-to-end: register →
  create Vink ($60, GROCERY) → add two participants → split (organizer at $0 — see below) →
  review → open → lands on the live Lobby → **FUNDED observed live** via WebSocket, no
  navigation or refresh → **the mock card appears live** once the real sweep provisions it →
  merchant authorization + capture (ops-console scope, driven directly) → **COMPLETED
  observed live**. `flutter analyze` is clean (one pre-existing, deliberately suppressed
  info-level lint).

## Known limitations

1. **No organizer "approve my own contribution" UI.** The domain's `EQUAL` split makes the
   organizer a payer like anyone else, but PV9 has no Lobby affordance for the organizer to
   authorize their own share. Worked around, not hidden: `create_vink_screen.dart` submits a
   `CUSTOM_AMOUNT` split with the organizer explicitly at $0 and the added participants
   splitting the full total — the sensible default for how this product actually works
   (organizer fronts nothing, gets reimbursed), but a real, deliberately small scope gap
   worth flagging for whoever picks up PV10.
2. Plan §20 describes category/total/split/participants as separate screens; PV9 collapsed
   them into one guided three-step flow since each step depends on the Vink id the previous
   step creates. Revisit if product wants the screens split for their own sake.
3. `freezed`/`json_serializable` (codegen) intentionally omitted — hand-written immutable
   models keep the build free of a codegen step. Revisit if the model surface grows large
   enough to justify it.
4. iOS-only target verified (full Xcode present on this machine); Android was not built or
   tested this milestone.
5. `integration_test`'s `binding.takeScreenshot()` calls in `e1_test.dart` run without error
   at all six journey milestones, but the default `flutter test integration_test/*.dart -d
   <device>` runner (as opposed to a `flutter drive`-based driver harness) does not persist
   the captured bytes to host disk — confirmed by searching the filesystem after a passing
   run and finding nothing. The screenshots are not currently retrievable as files; wiring
   that up would need a small `flutter_driver` script, deferred as a nice-to-have rather than
   blocking the exit gate (which the passing test itself satisfies).

## Security review

- Tokens never touch disk outside `SecureTokenStore` (iOS Keychain via
  `flutter_secure_storage`) — no `SharedPreferences`, no plain files.
- The API client attaches the bearer token to every request except `/auth/*`, and performs
  exactly one refresh-and-retry on a 401 rather than looping.
- No provider SDK or secret reaches the mobile app; the app only ever talks to VinkIn's own
  API, consistent with §42/§43's provider-isolation rule (unaffected by this milestone).
- The simulated-card UI is unambiguously labeled at every state where real money would be
  represented in a production build, per Plan §19.

## Next milestone

**PV10 — Participant / Guest Mobile Experience**, the natural next step now that E1 is
provably complete from the organizer's device: the guest-join and contribution-approval UI
that PV9's E1 test currently drives via raw HTTP calls (deliberately, since it's out of this
milestone's scope) becomes real app screens. Recommend addressing known-limitation #1 (an
organizer self-approval affordance) as part of or alongside that work, since both touch the
same contribution-approval surface.
