# Milestone Report — ENG1 Slice 4 (Retry Classification and Duplicate-Action Protection)

Date: 2026-07-20 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: typed retry
classification + duplicate-action protection across mutating commands, per the owner's own
slice brief. No auto-retry of financial mutations without an idempotency guarantee.

## Approach: audit first, then fix exactly what's broken

Rather than blindly re-implementing Slice 2's idempotency-key pattern for all nine named
mutating actions regardless of need, each was checked against what the backend already
guarantees before touching anything:

| Action | Before this slice | Verdict |
|---|---|---|
| create Vink | Client key + server replay (Slice 2) | Already solid |
| contribute (`authorize`) | Server-derived idempotency keys throughout (`operation-ids.ts`); `authorizeContributionCommand` already has explicit "Business-level idempotency: a double tap returns the live contribution unchanged" | Already solid |
| update split | `PUT` — naturally idempotent by REST convention | Already solid |
| open Vink | One-way DRAFT→OPEN state-machine transition — a second attempt hits `ILLEGAL_TRANSITION`, never a duplicate | Safe, but the client showed a scary generic error for what may have already succeeded |
| cancel | Same state-machine protection | **Zero error handling in the client at all** — any failure, including a harmless double-tap, propagated unhandled |
| add participant | Existing `existing.some(userId === input.userId)` guard | Safe from duplication, but returned undifferentiated `INVALID_COMMAND` — indistinguishable from a genuinely invalid request |
| **invite guest** | **Nothing** | **Real gap: a lost-response retry or double-tap created a second, genuinely separate guest participant every time** |
| merchant authorize/capture | Internal ops-console/simulator endpoints, not organizer-app actions | Out of this slice's scope (ENG1 §7's later merchant-payment command split) |

Two real defects came out of this audit — one client-side (cancel), one server-side (invite
guest) — both fixed. The rest needed only classification/messaging improvements, not new
protection machinery.

## What was implemented

### 1. Typed `FailureCategory` classifier (`apps/mobile/lib/core/errors/failure_classifier.dart`)

The exact eight categories from the brief: `retryable`, `conflict`, `expired`,
`authenticationRequired`, `alreadyCompleted`, `validation`, `terminal`, `unknown`. A single
pure function, `classifyFailure(Object error) → ClassifiedFailure`, replaces every screen's
own ad-hoc `on ApiException catch` + `humanErrorMessage` interpretation (7 screens did this
independently before). Each classification answers exactly the questions the brief named:
whether a retry is shown (`canRetry`), whether state should be refreshed first
(`shouldRefreshState`), and whether the user must sign in again (`requiresSignIn`).

**Deliberately absent: automatic retries.** Every category's "is retry automatic" answer is
"no" — a mutating request only ever repeats because the user tapped a button again. The brief
explicitly warns against auto-retrying financial mutations without a positive idempotency
guarantee; building that safely (backoff, cancellation, an auditable per-action decision) is
bigger than typed classification and stays out of scope here. `canRetry` only controls whether
a retry *affordance* is shown.

`ILLEGAL_TRANSITION` (the domain state machine's generic "this transition isn't legal from
here" error — thrown identically whether a Vink was already opened by an earlier successful-
but-lost-response attempt, or whether it genuinely can never happen) classifies as `conflict`
rather than guessing which case it is: refreshing state is the correct response either way,
and `ApiException` doesn't currently carry the `from`/`event` fields that would let it be told
apart more precisely.

### 2. `AuthController.expireSession()` — the missing half of "must sign in again"

Found while wiring the classifier: `ApiClient`'s 401-refresh-retry-once interceptor already
existed, but when the retry *also* failed, nothing told the app's in-memory `AuthState` the
session was dead — the router only reacts to that state, not to the token store directly, so
a mid-session expiry would show a generic error while leaving the user looking signed in. New
`expireSession()` (distinct from `logout()` — no network call, the server already doesn't
recognize this session) clears state to `AuthSignedOut`; the router's existing redirect logic
picks it up automatically. `failure_handling.dart`'s `presentFailure()` calls it whenever
`requiresSignIn` is true, so this is now the one place that decision is ever made.

### 3. Backend: closed the one real duplication gap (guest invites)

`inviteGuestCommand` had no protection at all. Unlike Vink creation, the invite response's raw
guest token/join link can never be recovered for a true replay (D14: only its hash is ever
stored) — so a detected duplicate is **rejected** (`INVITE_ALREADY_SENT`, 409), not replayed.
The client treats that rejection as success and closes quietly rather than showing an error —
no duplicate guest is ever created, which is the actual correctness property that matters;
there's nothing better to offer since the original link is genuinely gone by design.

- Migration `0010`: `guest_invite_idempotency (vink_id, idempotency_key, participant_id)`,
  primary key on `(vink_id, idempotency_key)` — the actual guard.
- `inviteGuestCommand` accepts optional `invitationIdempotencyKey`; pre-checks, then on a
  genuine concurrent race (DB unique-violation via `InviteIdempotencyRaceError`) still resolves
  to `INVITE_ALREADY_SENT` rather than a raw error.
- `addParticipantCommand`'s existing duplicate guard now throws distinct
  `PARTICIPANT_ALREADY_ADDED` (409) instead of generic `INVALID_COMMAND` — the classifier can
  now tell "already done" apart from "genuinely invalid."
- Both endpoints previously had **zero test coverage** — closed alongside the fix.

### 4. Client: wired the classifier + fixed the cancel gap

- `add_person_sheet.dart`: sends a lazily-generated, retry-stable
  `invitationIdempotencyKey` (reusing `idempotency_key.dart` from Slice 2, no new dependency);
  both add-participant and invite-guest catch blocks now classify failures — an
  `alreadyCompleted` result closes the sheet quietly instead of showing an error.
- `create_vink_screen.dart`: split/open/create catch blocks all route through
  `presentFailure()`. **Open specifically** now does more than classify: on a `conflict`
  result it re-fetches the snapshot, and if the Vink is no longer DRAFT, proceeds to the lobby
  exactly as if the tap had succeeded — because it likely did, just with a lost response. This
  is the concrete duplicate-tap safety net the brief asks for on "Open Vink."
- `vink_lobby_screen.dart`: **`_cancelVink()` previously had no try/catch at all** — any
  failure propagated unhandled. Now classified, with a new dedicated `_cancelError` display
  slot (reusing the existing top-level `_error` field would have been silently swallowed by
  the UI once a snapshot is loaded — caught by writing the widget test for it, see below).
  `_payMyShare()` upgraded to the classifier for consistency; needed no new protection —
  the contribution engine's own business-level idempotency already covers it.

## Files changed

New: `apps/api/src/db/migrations/0010_guest_invite_idempotency.sql`,
`apps/mobile/lib/core/errors/failure_classifier.dart`,
`apps/mobile/lib/core/errors/failure_handling.dart`,
`apps/mobile/test/core/errors/failure_classifier_test.dart`, this report.
Modified: `packages/application/src/{errors,ports,guest,commands,commands.test,guest.test}.ts`,
`packages/application/src/testing/in-memory.ts`, `apps/api/src/modules/vinks/{store,routes}.ts`,
`apps/api/src/vinks.integration.test.ts`, `apps/mobile/lib/core/auth/auth_controller.dart`,
`apps/mobile/lib/core/errors/human_errors.dart`,
`apps/mobile/lib/features/create_vink/{add_person_sheet,create_vink_screen}.dart`,
`apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart`,
`apps/mobile/test/core/errors/human_errors_test.dart`.

## Tests added

12 new classifier unit tests + 4 new backend tests (2 unit in `guest.test.ts`'s new describe
block covering replay-rejection/different-key/race, 2 real-Postgres integration including a
genuine `Promise.all` concurrent-invite race) + 2 corrected/extended existing tests
(`PARTICIPANT_ALREADY_ADDED` code, `human_errors_test.dart`'s known-codes list). Repo totals:
**203 Node/TS tests** (up from 197) + **54 Flutter tests** (up from 27 — the jump also
reflects several already-passing design-system tests this session hadn't previously listed
individually), all green.

Real-device re-verification (no mocks, real local Postgres/Redis/API, real touch injection on
a booted iOS Simulator): re-ran both `e1_test.dart` (the full golden path — create through
completion, exercising create/participant/invite/split/open/contribute) and
`eng1_slice3_setup_recovery_test.dart` (Slice 3's resume flows, which exercise
`create_vink_screen.dart` heavily) after all Slice 4 changes — both pass clean, confirming no
regression from the classifier rewiring.

## A recurring environment pattern, now familiar

Running the full suite via `pnpm test` failed intermittently on `@vinkin/api` and then
`@vinkin/guest-web` — in both cases a **stale process from earlier in this long session**
(the API server on :3000 running pre-migration code; guest-web's Playwright `webServer` with
`reuseExistingServer: true` reusing a stale build on :3100) was the actual cause, not a defect
in this slice's code. Killing each and letting them restart fresh resolved both immediately.
This is the same class of issue ENG0 and Slice 2's reports already flagged — worth that
`.env`/start-script fix if a session like this keeps recurring.

## Known limitations

1. `add_person_sheet.dart`'s "already completed" handling closes the sheet quietly with no
   visible confirmation — correct (no duplicate is ever created) but the organizer doesn't see
   *why* the sheet closed. A toast/snackbar would be a small, real UX improvement; not added
   here to keep this slice's diff focused on the correctness property, not new UI chrome.
2. The classifier's `conflict` bucket conflates two genuinely different situations behind
   `ILLEGAL_TRANSITION` (already-done vs. can-never-happen) because `ApiException` doesn't
   carry the domain error's `from`/`event` fields. The "Open Vink" handler works around this
   for that one specific action by re-checking state directly; other `ILLEGAL_TRANSITION`
   sites just refresh and show the message, which is safe but not always maximally precise.
3. Per the owner's list, merchant authorize/capture duplicate-protection was scoped out — those
   are ops-console/internal-simulator actions, not organizer-app mutations, and belong with
   ENG1 §7's merchant-payment command split rather than this slice.

## Next milestone

Per the owner's stated order: **timer-semantics configuration** (moving `VINK_OPEN_DURATION_
SECONDS`/`VINK_CONTRIBUTION_CUTOFF_SECONDS`/`VINK_PROCESSING_GRACE_SECONDS` out of scattered
constants into one explicit, verified-against-the-approved-product-behavior configuration
surface), then the organizer merchant-payment command split (§7).
