# Milestone Report — ENG3 Slice 3: Flutter Resilience Primitives

Date: 2026-07-23 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: the third of
six owner-approved ENG3 slices — request cancellation, network reachability handling, and
app-version enforcement, the three Flutter checklist items the original audit found entirely
**Missing** (no `CancelToken` usage anywhere; no `connectivity_plus`/proactive offline
detection; no mechanism at all for the server to signal a minimum supported client version).

## Request cancellation

`ApiClient` (`apps/mobile/lib/core/networking/api_client.dart`) now accepts an optional
`CancelToken` on every method (`get`/`post`/`put`/`patch`/`delete`/`getList`) — additive, every
existing call site that omits it behaves exactly as before. `_toApiException` maps a
`DioExceptionType.cancel` to a new `ApiException.isCancelled` flag rather than a generic
`NETWORK_ERROR`, so a caller that still holds the exception can skip error-state handling for a
request it deliberately aborted (matching the existing `if (!mounted) return;` idiom already
everywhere in this codebase, not inventing a new pattern).

Wired into `VinkLobbyScreen`: one `CancelToken` shared by every read the screen issues
(`_loadInitialSnapshot`, `_refreshSnapshot`, `_loadParticipantView`), cancelled in `dispose()`.
Deliberately **not** wired into the screen's three mutating commands (cancel Vink, pay share) —
a financial command should complete server-side once sent regardless of whether the screen
that triggered it still exists to see the result; cancellation is for reads that become moot
when superseded or the screen disposes, never for commands. `VinkRepository`'s three read
methods (`getSnapshot`, `getParticipantView`, `listMyVinks`) accept the token; its two command
methods (`cancelVink`, `authorizeContribution`) deliberately don't, with a doc comment
explaining why.

**A required fix, not scope creep**: adding the optional `CancelToken` parameter broke
override-compatibility for `test/support/fake_api_client.dart` — a shared test double used
across many existing test files — since Dart requires an override to redeclare every named
parameter the base method has. Fixed by adding the same optional parameter to each override
(accepted, never consulted, since the fake bypasses `Dio` entirely) — a required consequence of
the `ApiClient` signature change, not new scope.

`ApiClient` also gained an injectable `Dio` constructor parameter (mirroring the existing
`HttpAnalytics({Dio? dio})` pattern in `core/analytics/analytics.dart`) so cancellation could be
proven against a real `Dio` + a fake `HttpClientAdapter` whose `fetch()` never resolves on its
own — real cancellation semantics, no real network call, no mocking package.

## Network reachability handling

New `ConnectivityService` (`apps/mobile/lib/core/network/connectivity_service.dart`), wrapping
the new `connectivity_plus` dependency behind two injectable functions rather than the plugin
class itself (mirrors `RealtimeClient`'s own `reconnectDelay(attempt, {Random? random})`
testability pattern) — a test supplies plain fakes, no platform-channel mocking involved.
`isOnlineProvider` (a Riverpod `StreamProvider<bool>`) combines an explicit initial
`checkConnectivity()` call with the live `onConnectivityChanged` stream, since the underlying
plugin stream never replays the current state to a new subscriber on its own — correct from its
very first emitted value, not a window where a consumer reads a stale "loading" state.

**Deliberately not wired into any screen's visual "you're offline" presentation** — ENG3's own
brief says "without making visual/UX decisions," and no Phase 4 screen contract specifies what
that presentation should look like. This provider is the capability; attaching it to a specific
screen's UI is a future UX-directed slice's job, stated explicitly in the code's own doc
comment so it isn't mistaken for an oversight.

One concrete, non-visual integration: `RealtimeClient` now reconnects immediately (bypassing the
exponential backoff wait) on a genuine offline→online transition — the same "don't make a
resumed screen wait out a full backoff" reasoning Slice 1's `AppLifecycleListener` integration
already established for backgrounding, since a network change frequently kills the socket
without ever firing a clean `close` event. The transition *decision* itself
(`shouldReconnectOnConnectivityChange`) is a pure, top-level function — unit-tested directly,
the same pattern `reconnectDelay` already uses in this same file — rather than folded into the
harder-to-test class internals.

## App-version enforcement

**Backend** (new `apps/api/src/app-version.ts` + a new `VINKIN_MINIMUM_APP_VERSION` env var,
unset by default): `isAppVersionSupported`/`parseAppVersion` are pure, fail-open functions — a
malformed client or configured version is always treated as supported, since a parsing bug must
never be able to lock every client out of the API, a far worse failure mode than the
enforcement this exists to provide. `app.ts` gained a new global `onRequest` hook, a no-op
whenever the env var is unset (the default — exact current behavior, byte-for-byte, the same
"off preserves current behavior" convention every other static flag in this codebase already
follows) or a request carries no `x-app-version` header at all — `apps/guest-web` and
`apps/operations-console` never send one, so they're unaffected by construction, not by a
carve-out this hook has to remember. A client below the configured minimum gets
`426 Upgrade Required` with `{error: 'APP_VERSION_UNSUPPORTED', message: ...}`, never reaching
the route handler.

**Client**: `ApiClient` gained a second injectable constructor parameter, `appVersion` (a
`Future<String>`, defaulting to a new dependency, `package_info_plus`'s
`PackageInfo.fromPlatform()` — the running app's own installed version, read once and reused
for every request, never the possibly-stale build-time `pubspec.yaml` value). Every request
carries `x-app-version` unconditionally — free while the server-side flag is off, which it is
everywhere today. `APP_VERSION_UNSUPPORTED` was added to `failure_classifier.dart`'s existing
`terminal` category (no new `FailureCategory` needed — "nothing about retrying can help, only
an update can" is exactly what `terminal` already means) and given a plain functional message
in `human_errors.dart` ("This version of VinkIn is no longer supported. Please update the
app."), the same table-driven pattern every other error code already uses — not a new "Update
Required" screen, which would be exactly the kind of visual/UX decision this slice is scoped to
avoid.

## Tests

- `apps/mobile/test/core/networking/api_client_test.dart` (new, 4 tests): a cancelled request
  maps to `isCancelled`; cancellation threads through every method; omitting a token never
  spuriously cancels; every request carries `x-app-version`. Needed two real-platform-channel
  mocks to run at all in a bare (non-widget) test — `FlutterSecureStorage.setMockInitialValues`
  and `PackageInfo.setMockInitialValues`, both the packages' own documented `@visibleForTesting`
  seams, plus `TestWidgetsFlutterBinding.ensureInitialized()` — genuinely needed, not
  over-engineering: without them, `readAccessToken()`/`PackageInfo.fromPlatform()` fail before
  a request ever reaches the fake adapter, which is exactly what happened while writing this
  test and is documented inline as a lesson, not silently worked around.
- `apps/mobile/test/core/network/connectivity_service_test.dart` (new, 9 tests): `isOnline`'s
  classification rules, `ConnectivityService`'s two injected functions, and
  `isOnlineProvider`'s initial-value-then-live-stream ordering.
- `apps/mobile/test/core/realtime/realtime_client_test.dart` (extended, +5 tests):
  `shouldReconnectOnConnectivityChange`'s four transition cases plus the "no prior reading yet"
  edge case.
- `apps/mobile/test/core/errors/failure_classifier_test.dart` (extended, +1 test):
  `APP_VERSION_UNSUPPORTED` classifies as `terminal`, never retryable, never requiring sign-in.
- `apps/api/src/app-version.test.ts` (new, 19 tests): `parseAppVersion`'s strict parsing (7
  malformed-input cases) and `isAppVersionSupported`'s full comparison matrix, including both
  fail-open cases.
- `apps/api/src/app.test.ts` (extended, +5 tests): the flag-off default, header-absent,
  below-minimum (426 + exact body), at-or-above-minimum (3 versions), and malformed-header
  cases — against the real `buildApp()`/`onRequest` hook, not the pure function in isolation.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard` — clean, all 10 packages.
- `apps/api`: **131/131** (up from 98 in Slice 1's report — this slice's own +24, plus +9 from
  the concurrent session's own Slice I5B work landing in between, confirmed additive via the
  full suite run, not assumed).
- `apps/mobile`: `flutter analyze` clean (11 pre-existing info-level issues, unchanged, none in
  any file this slice touched); `flutter test` **148/148** (up from 111 in Slice 1's report —
  this slice's own +19 across the four files above, plus concurrent-session work already in
  the tree); re-ran the full suite twice for stability, and ran every file this slice actually
  touches in isolation as an additional, faster-signal check.
- `apps/guest-web` / `apps/operations-console`: untouched by this slice, not re-run.

## Files changed

- Modified: `apps/mobile/lib/core/networking/api_client.dart`,
  `apps/mobile/lib/core/repositories/vink_repository.dart`,
  `apps/mobile/lib/core/realtime/realtime_client.dart`,
  `apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart`,
  `apps/mobile/lib/core/errors/{failure_classifier,human_errors}.dart`,
  `apps/mobile/lib/core/errors/api_exception.dart`, `apps/mobile/pubspec.yaml`,
  `apps/mobile/test/support/fake_api_client.dart` (required override-compatibility fix),
  `apps/api/src/app.ts`, `apps/api/src/config/env.ts`.
- New: `apps/mobile/lib/core/network/connectivity_service.dart`, `apps/api/src/app-version.ts`,
  and the six test files listed above.

## Exit gate (this slice's own scope)

- [x] Request cancellation exists (`ApiClient`, `VinkRepository`), proven against a real `Dio`
      with a fake adapter, wired into the Lobby's read paths, cancelled on dispose.
- [x] Proactive network reachability detection exists (`ConnectivityService`,
      `isOnlineProvider`), fully unit-tested, deliberately not attached to any screen's visual
      presentation (out of scope for this slice by the owner's own instruction).
- [x] `RealtimeClient` reconnects immediately on an offline→online transition, not just on
      backgrounding — the connectivity-driven half of ENG3's own "network changes from Wi-Fi
      to cellular" exit-gate scenario.
- [x] App-version enforcement exists end-to-end (server env var + hook, client header +
      classification), off by default, fail-open on any malformed input, zero impact on
      `apps/guest-web`/`apps/operations-console` by construction.
- [x] Zero regressions; the one required fix (`FakeApiClient`'s override signatures) is
      documented as a consequence of this slice's own `ApiClient` change, not silent scope
      creep.

## Next

Slice 4 (Flutter deep-link routing for `/g/:token`) is next in the owner-approved order,
pending go-ahead.
