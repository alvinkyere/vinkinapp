# ENG3 Slice 6 — Typed Error Mapping Completion

**Date:** 2026-07-23
**Scope:** Final slice of the owner-approved 6-slice ENG3 ("Client Reliability Architecture")
execution order. Closes the one remaining gap the pre-slice audit found: `login_screen.dart`
and `register_screen.dart` were the only two mutating screens still bypassing the shared
`failure_classifier.dart`/`CommandRunner` pipeline every other screen (`vink_lobby_screen.dart`,
Slice 2) already uses, instead hand-rolling `bool _submitting`/`String? _error` pairs and ad hoc
`error.code == '...' ? ... : ...` checks.

## What was built

### 1. `classifyFailure` ordering fix (real, disclosed bug)

`apps/mobile/lib/core/errors/failure_classifier.dart` checked `error.isAuthError` (a blanket
"was this a 401") **before** any of the specific-code-set checks (`_alreadyCompletedCodes`,
`_conflictCodes`, `_expiredCodes`, `_terminalCodes`, `_validationCodes`). This was safe only by
coincidence — no code that previously needed a specific classification also happened to arrive
at a real 401. That coincidence broke the moment login/register needed classification:
`apps/api/src/modules/auth/routes.ts`'s `authErrorStatus` returns `INVALID_CREDENTIALS` (wrong
password) at a genuine HTTP 401 and `USERNAME_TAKEN` at 409. Under the old ordering,
`INVALID_CREDENTIALS` would have been misclassified as `authenticationRequired` ("your session
died, sign in again") instead of `validation` ("bad input, try different credentials") — on the
login screen itself, which is a particularly bad place for that mistake.

Fixed by reordering `classifyFailure()`: all specific-code-set checks now run first; the
`isAuthError` check runs last, immediately before the final `RATE_LIMITED`/`NETWORK_ERROR`/5xx
and `unknown` fallbacks. Added `INVALID_CREDENTIALS` and `USERNAME_TAKEN` to `_validationCodes`,
and both to `human_errors.dart`'s message table with the exact copy the two screens' old ad hoc
strings already used ("Incorrect username or password.", "That username is already taken.") —
no copy change, just routing the existing copy through the shared pipeline.

**Bonus fix, found by the same reordering, not by intent:** `GUEST_UNAUTHENTICATED` was already
present in `_expiredCodes`, but the pre-existing test only ever exercised it at an artificial
status code 410 — never its real status. `apps/api/src/modules/sharing/routes.ts` actually sends
it at a genuine 401 (`reply.code(401).send({ error: 'GUEST_UNAUTHENTICATED' })`), which under the
old ordering would have been swallowed by the blanket `isAuthError` check before ever reaching
the `_expiredCodes` lookup — a real latent misclassification that existed before this slice and
was never previously caught. The reordering fixes it as a side effect; a new regression test
proves it at the real status code.

### 2. `login_screen.dart` / `register_screen.dart` → `CommandRunner<void>`

Both screens migrated to the same pattern `vink_lobby_screen.dart` established in Slice 2:
a `_guardedSetState` closure, a `late final _loginCommand`/`_registerCommand =
CommandRunner<void>(_guardedSetState, ref)`, `_submitting`/`_error` derived as getters off
`_loginCommand.state`/`_registerCommand.state` instead of separately tracked fields, and
`_submit()` reduced to a single `await _command.run(() => ...)` call.

This also fixed a small, real, pre-existing gap for free: login's old catch block set `_error`
without checking `mounted` (its `finally` block one line below it did check `mounted`, so the
two were already inconsistent with each other) — `CommandRunner`'s own `_guardedSetState`-shaped
closure makes every state transition mounted-safe uniformly.

**One deliberate, disclosed simplification** on register: the old `VALIDATION_FAILED` branch
showed a more specific message ("Username needs 3+ letters/numbers, password needs 10+
characters.") than `human_errors.dart`'s shared generic entry ("Please check the details and try
again."). `ClassifiedFailure` doesn't carry the original error code — only category, message,
and flags — so preserving the specific copy would mean either widening the shared classifier's
return type for one screen's preference, or hand-parsing the raw exception again, defeating the
point of the migration. `VALIDATION_FAILED` is already shared by many other call sites using the
generic message; register now matches them instead of being a one-off exception. This is a real,
small specificity loss, flagged in a code comment at the point of the change, not hidden.

### 3. Real bug caught while writing the register widget test: missing scroll wrapper

`register_screen.dart`'s `build()` had no scroll container around its 5-field `Column` (name,
username, email, phone, password — the email/phone fields came later, from D19/D27). On a
phone-sized test viewport this produced a genuine `RenderFlex overflowed by 23 pixels` error,
caught immediately by the new widget test. Phase 4 §3 (the Register screen's own approved
contract) explicitly requires: "Scroll behavior: content scrolls above the keyboard on small
devices... same as Login, more fields so more likely to need it" — a requirement that was
evidently missed when the two contact-info fields pushed the field count to five. Fixed by
wrapping the existing `Column` in a `SingleChildScrollView`, with a comment citing the exact
contract line being implemented — a layout/structural fix implementing an already-approved
requirement, not a new UX decision (consistent with ENG3's own "no visual/UX decisions" scope
constraint).

## Tests

- `apps/mobile/test/core/errors/failure_classifier_test.dart`: 2 new tests —
  `INVALID_CREDENTIALS`/`USERNAME_TAKEN` classify as `validation` (never
  `authenticationRequired`) at their real status codes, with exact message assertions; and the
  `GUEST_UNAUTHENTICATED`-at-401 regression proving the ordering bug is fixed. All pre-existing
  tests in the file re-verified passing — no regression from the reordering.
- `apps/mobile/test/features/onboarding/login_screen_test.dart` (new): mocks
  `POST /api/v1/auth/login` to throw `ApiException(401, 'INVALID_CREDENTIALS')`, submits via the
  real form, asserts the shared human copy renders and the raw code never does.
- `apps/mobile/test/features/onboarding/register_screen_test.dart` (new): mocks
  `POST /api/v1/auth/register` to throw `ApiException(409, 'USERNAME_TAKEN')`, fills all 5 fields,
  submits, asserts the shared human copy renders and the raw code never does. This test is what
  caught the scroll-overflow bug on its first run.

## Verification

- `flutter analyze`: clean, same 11 pre-existing info-level issues, unchanged baseline.
- `flutter test`: **168/168 passing** (up from 158 pre-slice: 2 classifier tests + 1
  login screen test + 1 register screen test = 4 new tests, plus tests contributed by the
  concurrent UX-track session's own in-flight commits landing on shared files during this
  slice — confirmed via `git diff --stat` that `activity_copy.dart`/`activity_providers.dart`/
  `activity_screen.dart`/`activity_copy_test.dart`/`feature_flags.dart`/`vink_repository.dart`
  changes are that session's own work, not this slice's).
- `pnpm typecheck`: 10/10 packages clean.
- `pnpm lint`: clean.
- `pnpm format:check`: 3 pre-existing warnings, all in files this slice never touched
  (`apps/api/src/participant-inclusive-transport.integration.test.ts`,
  `packages/application/src/guest.ts`, `packages/application/src/participant-view.test.ts`) —
  confirmed via `git status` as the concurrent session's own in-flight, not-yet-formatted work.
- `pnpm guard`: clean (provider-import guard passed).

## Files changed

- `apps/mobile/lib/core/errors/failure_classifier.dart` — reordering fix, two new validation
  codes.
- `apps/mobile/lib/core/errors/human_errors.dart` — two new table entries.
- `apps/mobile/lib/features/onboarding/login_screen.dart` — `CommandRunner` migration.
- `apps/mobile/lib/features/onboarding/register_screen.dart` — `CommandRunner` migration +
  scroll-overflow fix.
- `apps/mobile/test/core/errors/failure_classifier_test.dart` — 2 new tests.
- `apps/mobile/test/features/onboarding/login_screen_test.dart` — new file.
- `apps/mobile/test/features/onboarding/register_screen_test.dart` — new file.

## Exit gate

- [x] Every mutating screen now funnels through `classifyFailure`/`CommandRunner` — no screen
  hand-rolls its own error-code comparison or ad hoc submitting/error state.
- [x] The `isAuthError`-vs-specific-code ordering bug is fixed with a regression test proving it,
  not just the two new codes this slice needed.
- [x] A real layout bug (register overflow) found during this slice's own test-writing is fixed,
  not deferred.
- [x] Full verification (Flutter + repo-wide TS) green, with all non-green results confirmed
  attributable to the concurrent session, not this slice.

## Next

ENG3 is now fully closed — see the CLAUDE.md closure note. ENG4 ("Hosted Pilot Infrastructure")
is next in the owner's ENG0–ENG15 sequence; not started here, pending owner go-ahead.
