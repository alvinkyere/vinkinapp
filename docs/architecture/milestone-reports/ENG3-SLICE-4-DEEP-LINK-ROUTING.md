# Milestone Report — ENG3 Slice 4: Deterministic Deep-Link Routing

Date: 2026-07-23 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: the fourth of
six owner-approved ENG3 slices — the one remaining Flutter checklist item scoped as its own
slice from the start: "no `/g/:token` route exists at all, no OS-level associated-domains/
entitlements setup... guest invite links can't open the app deterministically today."

## Correcting the audit's own framing before building anything

The original audit's exact finding was that `/g/:token` doesn't exist in `apps/mobile`. Before
writing any code, re-checked this against the architecture: `/g/:token` is
**`apps/guest-web`'s own route** (Phase 4 §13, "Guest token-redeem page" — that whole document
section sits under the guest-web-only `JoinExperience` alongside §7/§8/§9). Guests never use
the organizer Flutter app at all (Phase 0 §1) — there is no legitimate scenario where this app
should intercept a guest token link. Building `/g/:token` handling into `apps/mobile` would have
been inventing new product scope no spec document asks for, not fixing the flagged gap.

The actually-meaningful, already-real destination worth reaching via an external link is
`/vinks/:vinkId` — the Lobby route this app has had since PV9, already noted in
`router.dart`'s own pre-existing doc comment ("Absent for every other caller (deep links, the
post-create redirect...)") as a hypothetical deep-link target nobody had built yet. This slice
builds exactly that, and states the correction above explicitly in code (`deep_links.dart`'s
own doc comment) so a future reader doesn't rediscover the same dead end.

## What was built

**A custom URL scheme (`vinkin://`), not Universal Links/App Links.** Real HTTPS-based deep
linking needs a real, owned domain serving a signed `apple-app-site-association` file plus a
real Apple Developer Team ID — none of which exist yet (ENG4 "Hosted Pilot Infrastructure" is
the not-yet-started milestone that stands up real domains/certs). Building Universal Links now
would mean guessing at infrastructure that doesn't exist. A custom scheme needs no external
infrastructure at all — this is stated explicitly in both `pubspec.yaml` and
`ios/Runner/Info.plist`'s own new comments, so it reads as a deliberate sequencing decision, not
an oversight, when ENG4 eventually does stand up the real thing.

- `ios/Runner/Info.plist`: registers `CFBundleURLTypes` for the `vinkin` scheme.
- New `lib/app/deep_links.dart`: `deepLinkRouteFor(Uri uri) -> String?`, a pure, top-level
  function (the same pattern `reconnectDelay`/`shouldReconnectOnConnectivityChange` already
  established in `realtime_client.dart`) — `vinkin://vinks/:vinkId` maps to the existing
  `/vinks/:vinkId` route; anything else (wrong scheme, wrong host, wrong segment count, empty
  id) returns `null` and is silently ignored, never crashes or guesses.
- New `lib/app/deep_link_listener.dart`: `DeepLinkListener` subscribes to both a cold-start
  link (`app_links`'s `getInitialLink()`) and live links (`uriLinkStream`) and calls
  `GoRouter.go()` on the app's own real router. `getInitialLink`/`uriLinkStream` are injected as
  plain functions rather than the `AppLinks` class itself — mirrors `ConnectivityService`'s own
  `checkConnectivity`/`connectivityChanges` pattern (Slice 3) — so a test needs no platform-
  channel/plugin mocking at all, unlike `ApiClient`'s `PackageInfo`/`FlutterSecureStorage` tests
  in the same slice.
- `lib/app/app.dart`: a new side-effect-only Riverpod provider constructs and disposes the
  listener alongside the existing router provider, always wired to the exact same router
  instance `MaterialApp.router` renders.

**No UI change.** There is no existing "share this Vink with a co-organizer" feature anywhere
in the app to attach a new share button to, and inventing one would be a product decision this
slice isn't scoped to make. This is infrastructure only — the same "capability built, not yet
consumed by a screen" pattern Slice 2's repository layer and Slice 3's `isOnlineProvider`
already established — ready for a push notification, a future co-organizer invite feature, or
manual testing (`xcrun simctl openurl booted vinkin://vinks/<id>`) to use.

## Tests

- `test/app/deep_links_test.dart` (new, 7 tests): the happy path, a real-shaped UUID, wrong
  scheme, wrong host (explicitly including a guest-token-shaped link, proving the correction
  above is enforced, not just documented), missing/empty id, an extra path segment, and
  completely unrelated URLs (`https://`, `mailto:`) — never crashes, always `null`.
- `test/app/deep_link_listener_test.dart` (new, 3 tests): a live link navigates a *real*
  `GoRouter` (pumped via `MaterialApp.router`, asserted by the rendered screen changing); a
  cold-start link navigates on startup; an unrecognized link causes no navigation and no crash.

## Verification

- `flutter analyze`: clean (the same 11 pre-existing info-level issues, unchanged, none in any
  file this slice touched).
- `flutter test`: **158/158** (up from 148 in Slice 3's report — this slice's own +10 across
  the two new files). Ran the full suite twice in a row for stability, including once after the
  concurrent UX-track session's own Slice I2C change landed on `vink_lobby_screen.dart`
  mid-slice (participant realtime support) — merged cleanly, no conflict, re-verified clean
  both times.
- `apps/api`: untouched by this slice, not re-run.

## Files changed

- Modified: `apps/mobile/ios/Runner/Info.plist`, `apps/mobile/lib/app/app.dart`,
  `apps/mobile/pubspec.yaml`.
- New: `apps/mobile/lib/app/{deep_links,deep_link_listener}.dart`,
  `apps/mobile/test/app/{deep_links,deep_link_listener}_test.dart`.

## Exit gate (this slice's own scope)

- [x] A deterministic, OS-level entry point into the app exists (`vinkin://vinks/:vinkId`),
      reaching the real, existing `/vinks/:vinkId` route.
- [x] The routing decision is centralized and pure, unit-tested directly, consistent with
      `router.dart`'s own existing "one place decides" discipline.
- [x] `/g/:token` is explicitly, permanently out of this app's scope — documented as a
      correction to the original audit, not silently dropped.
- [x] No Universal Links/App Links infrastructure guessed at ahead of ENG4's real domain
      setup — the custom-scheme choice is stated as deliberate sequencing in the code itself.
- [x] Zero regressions, including through a concurrent-session file change landing mid-slice.

## Next

Slice 5 (guest-web hardening — server-rendered invite context, tab-resume handling, token-
expiry consistency) is next in the owner-approved order, pending go-ahead.
