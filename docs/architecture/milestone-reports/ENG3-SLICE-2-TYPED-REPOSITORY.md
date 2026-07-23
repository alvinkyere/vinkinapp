# Milestone Report — ENG3 Slice 2: Flutter Typed Repository + Command-State Layer

Date: 2026-07-22 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: the second of
six owner-approved ENG3 slices — "Flutter typed repository + command-state layer," addressing
two audit findings: **typed repositories — Missing** (no repository files existed anywhere
under `lib/`; every screen called `ApiClient.get/post` directly and hand-parsed raw JSON
inline) and **command state separate from view state — Partial** (`vink_lobby_screen.dart` had
three separate ad hoc `bool _busy` + `String? _error` pairs; `create_vink_screen.dart`
conflated all four of its mutating actions into one shared pair).

## Scope decision: prove the pattern on the highest-stakes screen, not a full-app migration

The audit found the vink-domain API surface spread across 8 files. Migrating all of them in one
pass would have meant touching `create_vink_screen.dart`,
`canonical/canonical_create_vink_screen.dart`, `add_person_sheet.dart`, and
`canonical/canonical_add_person_sheet.dart` — all four either actively being extended by the
concurrent UX-track session this same day (new "Slice I5"/"Slice I5B (D40)" tests appeared in
the suite mid-session) or, in the canonical Create Vink screen's case, mid-way through its own
D30 two-screen rebuild. Touching any of them risked a real merge conflict with in-flight work
neither this session started nor could safely finish on someone else's behalf.

This slice instead builds the typed repository and command-state abstractions fully, and
migrates the three files that don't touch Create Vink at all: `home_providers.dart`,
`activity_providers.dart`, and `vink_lobby_screen.dart` — the Lobby specifically because it's
both the highest financial stakes screen (cancel, contribute) and the one with the clearest
pre-existing ad hoc command-state duplication (three separate pairs) the abstraction is meant
to replace. Migrating Create Vink's own repository + command-state usage is flagged as
follow-up work for whichever slice/session next touches those files without colliding with
concurrent work.

## What was built

**`lib/core/commands/command_state.dart`** (new): `CommandState<T>` — a sealed
`Idle`/`InProgress`/`Success`/`Failure` type — plus `CommandRunner<T>`, which runs one action
through that lifecycle and writes the result via the same `setState`-shaped closure a screen
already has (no new state-management framework, no replacement of
`ConsumerStatefulWidget`). Two deliberate design decisions, both because the existing ad hoc
call sites had specific behavior a naive generic runner would have silently changed:

- `onFailure` can return `true` to **suppress** a failure from ever reaching `state` (resolves
  to idle instead) — reproduces `vink_lobby_screen.dart`'s pre-existing cancel behavior
  exactly: refresh the snapshot on a conflict (the double-tap-hits-`ILLEGAL_TRANSITION` case)
  and never show an error for something that may well have already succeeded.
- `onSuccess` is **awaited before** `state` becomes `Success` — several original handlers kept
  their loading flag set through a follow-up refetch inside a `finally` block that ran *after*
  that refetch completed (e.g. "Pay my share" → refresh the snapshot → *then* stop the
  spinner). Making `onSuccess` fire-and-forget would have flipped the spinner off one refetch
  early — a real, if subtle, regression this design avoids.
- One intentional behavior change, flagged rather than silent: `CommandRunner.run` catches
  `Object`, not just `ApiException` (two of the three original handlers caught only
  `ApiException`). `classifyFailure` (`failure_classifier.dart`) already documents that it
  handles a raw, unwrapped exception gracefully (classifies as `retryable`, doesn't crash) —
  narrowing the catch to `ApiException` only left a latent gap where an unexpected exception
  type would have propagated uncaught instead of showing a calm message. Widening it here
  closes that gap using infrastructure that already existed for exactly this purpose.

**`lib/core/repositories/vink_repository.dart`** (new): `VinkRepository`, typed methods
(`listMyVinks`, `getSnapshot`, `getParticipantView`, `getActivity`, `cancelVink`,
`authorizeContribution`) covering exactly the vink-domain endpoints Home, Activity, and the
Lobby screen call today — scoped deliberately, not a speculative full REST client. `ApiClient`
remains the one place HTTP/auth/retry concerns live; this layer adds no networking logic, only
typed shape over what it already does.

**Migrated**: `home_providers.dart` (`myVinksProvider`, `activeVinksProvider`),
`activity_providers.dart` (`recentActivityProvider`), and `vink_lobby_screen.dart` — its three
read paths (`_loadInitialSnapshot`, `_refreshSnapshot`, `_loadParticipantView`) now call the
repository instead of hand-parsing `ApiClient` responses (their own pre-existing
`_snapshotRequestId` stale-response guard is untouched — that's a read/view-state concern, not
a command, and was already correct); its three mutating flows (`_cancelVink`, `_payMyShare`,
`_payMyShareAsParticipant`) now use `CommandRunner`, replacing the three ad hoc `bool`+`String`
pairs the audit flagged. The presentational `_LobbyBody`/`_ParticipantLobbyBody` widgets were
**not** touched — the migrated state class exposes backward-compatible getters
(`_cancelling`, `_cancelError`, etc.) deriving from the new `CommandState`, so the leaf widgets'
own constructor calls are byte-for-byte unchanged, minimizing the surface this slice could have
broken.

## Tests

- `test/core/commands/command_state_test.dart` (new, 7 tests): the full lifecycle through a
  real `ConsumerStatefulWidget`/`WidgetRef` harness (not a simplified stand-in) — idle →
  in-progress → success; a thrown `ApiException` classifies correctly; a raw non-`ApiException`
  exception classifies as `retryable` instead of crashing; `onFailure` suppression resolves to
  idle; an `authenticationRequired` failure calls `expireSession()` exactly once; `reset()`;
  and a dedicated test proving `onSuccess` is genuinely awaited before `Success` (a delayed
  `onSuccess` keeps `state` at `InProgress` until it resolves).
- Existing coverage (`home_screen_test.dart`, `activity_screen_test.dart`) fully overrides
  `activeVinksProvider`/`recentActivityProvider` directly, so it exercises the screens
  unaffected by whether their *internal* implementation calls `ApiClient` or the repository —
  confirmed still green, not rewritten.
- No dedicated `vink_lobby_screen.dart` widget test exists in this repo today (confirmed by
  search) — this slice didn't add one; the screen's real-device coverage
  (`e1_test.dart`) remains blocked by ENG3 Slice 1's already-flagged, unrelated Register-screen
  gap (see that report), so this slice's Lobby changes were verified via `flutter analyze` +
  the full `flutter test` suite + careful manual review preserving exact original control flow,
  not a fresh real-device run.

## A pre-existing flaky test file, confirmed unrelated

`test/features/create_vink/canonical/canonical_create_vink_screen_test.dart` (untracked —
`git status` confirms it belongs to the concurrent UX-track session's own in-flight work, never
touched by this slice) fails non-deterministically under the full suite — different specific
tests fail on different runs, and it fails intermittently even run completely alone, with no
other test file involved. This is the classic signature of test-order-independent flakiness
intrinsic to that file (a timing race, most likely, not a logic bug) — not something this
slice's changes could cause, since nothing in this slice is imported by that screen or its
test. Every test this slice's own files are actually exercised by (`test/core/commands`,
`test/features/home`, `test/features/activity`) passes consistently, run alone or as part of
the full suite, across multiple repeated runs.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard` — clean (unaffected; this
  slice touched only `apps/mobile`).
- `flutter analyze` — clean, 11 pre-existing info-level issues unchanged, none in any file this
  slice touched.
- `dart format` — applied to every new/changed file.
- `flutter test` — **127/128** on the fullest run, the one failure in the confirmed-unrelated,
  confirmed-pre-existing-flaky file above; every test in `test/core/commands`,
  `test/features/home`, and `test/features/activity` (the files this slice actually touches or
  adds) passes consistently across repeated runs (19/19 in a targeted run isolating just
  those).

## Files changed

- New: `lib/core/commands/command_state.dart`, `lib/core/repositories/vink_repository.dart`,
  `test/core/commands/command_state_test.dart`.
- Modified: `lib/features/home/home_providers.dart`,
  `lib/features/activity/activity_providers.dart`,
  `lib/features/vink_lobby/vink_lobby_screen.dart`.

## Exit gate (this slice's own scope)

- [x] A typed repository layer exists, covering Home/Activity/Lobby's real endpoints — no
      speculative untested surface for screens this slice doesn't migrate.
- [x] The Lobby's three previously-ad-hoc command flows (cancel, organizer contribution,
      participant contribution) now share one typed, tested `CommandRunner` abstraction.
- [x] Every original per-call-site behavior nuance (conflict-suppression on cancel,
      spinner-through-refetch timing on contribute) is preserved exactly, verified by a
      dedicated test for the one genuinely subtle case (`onSuccess` awaiting).
- [x] One intentional, flagged behavior improvement (catching `Object` instead of narrowly
      `ApiException`), not a silent change.
- [x] Zero regressions in any test this slice's files are actually exercised by.
- [x] Create Vink's own migration is explicitly out of scope and flagged, not silently
      abandoned — avoiding a real conflict with concurrent in-flight work on those exact files.

## Next

Slice 3 (Flutter resilience primitives — request cancellation, network reachability detection,
app-version enforcement) is next in the owner-approved order, pending go-ahead.
