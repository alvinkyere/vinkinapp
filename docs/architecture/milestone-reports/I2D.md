# Slice I2D — Participant-Inclusive Activity Retrieval and Client Consumption

**Brief:** owner-directed, closing the gap Slice I2B's own completion report (2026-07-21)
flagged as "a genuinely new read surface (filtering which events are safe to show a
non-organizer)" — a candidate for I3/I6, requested before the broader I6 Home/Activity/Vink
Details work begins. Filed as **I2D**, not I2B — that label was already taken by the shipped
slice this gap traces back to (same reasoning as I2C).

**A real, currently-live bug was found while investigating this, not hypothetical**:
`recentActivityProvider` (`apps/mobile/lib/features/activity/activity_providers.dart`) called
the organizer-only `GET /vinks/:vinkId/activity` for *every* Vink `myVinksProvider` returns —
possible to include participant-role Vinks since I2A. That call 403s for a participant-role
Vink, and the merge loop had no per-vink error handling, so the **entire Activity screen
failed** for any user who is a participant on even one Vink, not just that one vink's entries.
`activity_screen_test.dart` never caught this because it overrides `recentActivityProvider`
wholesale rather than exercising its real merge logic against a mixed-role list. Fixed as part
of the same change, since the fix and the feature are the same code path.

## Files changed

**Backend:**
- `packages/application/src/guest.ts` — new `getParticipantVinkActivity` (allowlist filter +
  own-contribution-only scoping + payload sanitization, alongside `getParticipantVinkView`).
- `apps/api/src/modules/vinks/routes.ts` — new `GET
  /api/v1/vinks/:vinkId/participant-activity`, same flag gate as `/participant-view`.
- `packages/application/src/participant-view.test.ts` — 6 new tests for
  `getParticipantVinkActivity`.
- `apps/api/src/participant-inclusive-transport.integration.test.ts` — 2 new real-Postgres
  tests (flag-off 404, real filtering proof); `before()` now supplies a `MockFinancialProvider`
  (previously absent — needed to register the contribution routes this slice's own test calls).

**Flutter:**
- `apps/mobile/lib/core/repositories/vink_repository.dart` — new `getParticipantActivity`.
- `apps/mobile/lib/features/activity/activity_providers.dart` — `recentActivityProvider`
  branches per vink by role (the feature and the crash-bug fix at once); `VinkActivity` gained
  `isOrganizerRole`, carried per entry.
- `apps/mobile/lib/features/activity/activity_screen.dart` — passes `isOrganizerViewer` through
  to `activityCopy`.
- `apps/mobile/lib/features/activity/activity_copy.dart` — new `isOrganizerViewer` param
  (default `true`), neutralizing `VinkCreated`/`VinkCancelled`'s "You..." framing for a
  participant.
- `apps/mobile/test/features/activity/activity_copy_test.dart` — 3 new tests.
- `apps/mobile/test/features/activity/activity_providers_test.dart` (new) — 3 tests, including
  the concrete crash-bug regression proof, using a new `_FakeVinkRepository` test double
  (mirrors the established `FakeApiClient` pattern at the repository layer).
- `apps/mobile/integration_test/participant_realtime_test.dart` — extended with an Activity-tab
  visit after the existing live-Lobby proof.

**Docs:** `docs/spec/decision-log.md` (D42), `docs/design/phase-10-implementation-readiness.md`
(implementation note under I2; row 58 of the traceability matrix updated to Shipped).

## The filtering rule and its rationale

`listActivity`'s raw rows mix two kinds of internal data never safe to forward verbatim:
`'transition'` rows (state-machine internals — `from`/`event`/`to`/`actor`/`correlationId`) and
`'event'` rows (the full raw outbox payload, which for contribution/refund events carries
`participantId`, and for others may carry organizer-only detail). `getParticipantVinkActivity`
applies:

1. Drop every `'transition'` row outright — internal diagnostics, organizer or not.
2. Keep vink-wide milestone `'event'` rows (`VinkCreated`, `VinkOpened`, `ParticipantJoined`,
   `ParticipantAllocationChanged`, `ParticipantRemoved`, `VinkFunded`, `TemporaryCardIssued`,
   `MerchantAuthorizationApproved`, `PurchaseCaptured`, `VinkCompleted`, `VinkCancelled`,
   `VinkExpired`) — none of these carry identifying detail in the copy that renders them.
3. Keep contribution/refund lifecycle events only when `payload.participantId` equals the
   viewer's own participant id — the same "own contribution only" boundary `ParticipantVinkView`
   already enforces (D24/D25).
4. Drop everything else: internal timer states, provider/organizer-only diagnostics, and
   organizer-financial-recovery internals (`SettlementVarianceDetected`,
   `RecoveryObligationCreated`, `OrganizerRestricted`) — none have existing customer-safe copy,
   and showing them would leak organizer-only business.
5. Every surviving entry's `detail` is reduced to `{ eventType }` — no `participantId`,
   `actor`, `correlationId`, or amount ever reaches the wire, even for the viewer's own
   contribution (the copy needs nothing more).

This reuses the exact `ActivityEntry { kind, at, detail }` wire shape — no new client model.
`activityCopy()` gained `isOrganizerViewer` (default `true`) purely as a client-side copy
concern: `VinkCreated`/`VinkCancelled` are the only two cases that name the viewer as the actor
("You started"/"You cancelled"), false for a participant — they now render "This Vink was
created"/"This Vink was cancelled" instead.

## The crash-bug: found, fixed, verified

`recentActivityProvider`'s per-vink branch (`vink.isOrganizerRole ? getActivity(...) :
getParticipantActivity(...)`) is simultaneously the feature and the fix. Verified two ways:
a new Flutter test (`activity_providers_test.dart`) drives the *real* provider against a fake
repository with a mixed organizer-role + participant-role vink list and asserts both feeds
merge without throwing; and the real-device run (below) visits the Activity tab as an actual
participant on a real backend Vink and confirms no error state renders.

## Real-device result

`participant_realtime_test.dart`'s extension ran clean on a real booted iOS Simulator against
the real local backend (`VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL=1`): after the existing live-
Lobby proof, the same signed-in participant (`demo_member_1`) navigates back to Home and taps
the Activity tab. The screen renders real milestone entries (`VinkOpened`'s "...is open for
contributions" copy present), never the error state ("Couldn't load activity." absent — the
crash-bug regression proof), never the empty state (real entries exist), and never the
organizer-only "You started..." framing. `e1_test.dart` was re-run immediately after and stayed
green, confirming the organizer's own Activity feed is unaffected.

## Complete validation

- `apps/api`: 135/135 tests green (`VINKIN_INTEGRATION=1`), including the 2 new tests.
- `packages/application`: 111/111 tests green, including the 6 new
  `getParticipantVinkActivity` tests.
- `apps/mobile`: full `flutter test` (no path filter) 164/164 green; `flutter analyze` clean at
  the same 11 pre-existing info-level lints documented since ENG0 (no new categories).
- Repo-wide `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean (one
  unrelated, untracked, unformatted file from a concurrent session —
  `apps/guest-web/tests/guest-session-expired-notice.spec.ts` — confirmed via `git status` as
  never touched by this slice, left alone).
- Two real-device runs (iPhone 17 Pro simulator, real local Postgres + Redis +
  `apps/api/src/server.ts` with `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL=1`, no mocks):
  extended `participant_realtime_test.dart` and `e1_test.dart` (regression) both pass.

## Deviations

- **No enrichment with participant names or amounts** — the organizer's own feed doesn't do
  this either (`activity_copy.dart`'s own doc comment flags it as cut from an earlier
  milestone); not reintroduced here for participants specifically, matching the plan's own
  explicitly-out-of-scope list.
- **The two organizer-framed event types are neutralized, not excluded** — a deliberate choice
  over dropping `VinkCreated`/`VinkCancelled` entirely for a participant, so the feed still
  shows the vink's full milestone history, just without a false "you did this" claim.

## What remains open before I6

Nothing from this specific gap. Guest-web was untouched (no Home/Activity surface exists there,
unchanged since I2's own original scope note). The plan's explicitly-out-of-scope items
(enrichment, `listActivity`'s underlying table shape, the organizer-only route's own behavior)
remain exactly as they were.
