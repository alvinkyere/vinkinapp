# Slice I2C — Participant-Inclusive Transport and Client Reachability

**Brief:** owner-directed, closing a gap Slice I2B's own completion report (2026-07-21)
explicitly flagged as out of its own scope: a signed-in participant's Lobby view was HTTP-only
— the `/live` WebSocket channel resolved every non-guest token via the organizer-only
`getVinkSnapshot`, so it 403'd a participant exactly like the REST snapshot route did before
I2B. Filed as **I2C**, not I2B — that label was already taken by the shipped Activity-retrieval
work (confirmed with the owner before starting). No new financial semantics, no new privacy
boundary: `ParticipantVinkView`'s existing customer-safe shape is reused verbatim, delivered
over a transport that already exists for everyone else.

Explicitly out of scope, unchanged: the Activity-feed gap (a participant's own events still
don't appear in Home's "Recent activity" — separately flagged in the phase-10 traceability
matrix as a candidate for I3/I6, not this slice).

## Files changed

**Backend:**
- `apps/api/src/modules/realtime/routes.ts` — the JWT branch of the `/live` handler now falls
  back to `getParticipantVinkView` when `getVinkSnapshot` throws `FORBIDDEN`, gated on
  `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL` (the same flag the REST `/participant-view` route
  already requires). Flag off: unchanged, straight 4403. `VINK_NOT_FOUND` from either call
  still closes 4404, unchanged.
- `apps/api/src/realtime.integration.test.ts` — two new tests: a participant gets a
  `ParticipantVinkView`-shaped snapshot and the same live event stream as the organizer (flag
  on); the same non-organizer JWT still gets 4403 with the flag off (rollback proof).

**Flutter:**
- `apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart` — `initState` now calls
  `_connect()` for both roles (previously skipped for `widget.isParticipantView`); `_onMessage`
  branches at the top for participant role — a `snapshot` message parses via
  `ParticipantVinkView.fromJson` (already existed), any other message type triggers a full
  `_loadParticipantView()` refetch rather than hand-patching lean fields (see Deviations); the
  participant error state's retry button now also calls `_realtime?.connect()`, matching the
  organizer retry button's symmetry. Updated the stale "known gap" doc comment.
- `apps/mobile/integration_test/participant_realtime_test.dart` (new) — real-device proof.

**Docs:**
- `docs/spec/decision-log.md` — D41.
- `docs/design/phase-10-implementation-readiness.md` — implementation note under I2, and the
  I2A+I2B traceability-matrix row's own "known gap" text updated to point at this closure.

## Backend fallback behavior

`getVinkSnapshot` is tried first, unchanged — organizer path is byte-identical to before. On
`FORBIDDEN` (not the organizer) and the flag on, `getParticipantVinkView(store, vinkId,
claims.userId, new Date())` is tried — the exact function the REST `/participant-view` route
already calls, same customer-safe boundary (own contribution only, no roster, no card). If that
also throws `FORBIDDEN` (not an active participant either), the socket closes 4403 as before.
No change to the outbox publisher or `RealtimeHub`: a participant subscribes to the same
`vink:{vinkId}` channel and receives the same lean per-event payloads every other connection on
that vink gets — identical to how guest support (PV10) already works. Only the initial
`snapshot` message's source differs, and only for a non-organizer JWT.

No wire-envelope discriminator was added. The client already knows statically, from which
role/URL it connected with, which shape (`VinkSnapshot` vs `ParticipantVinkView`) to expect on
its own connection — exactly like the guest branch already relies on the client knowing its own
connection used a `vgt_` token.

## Flag-off rollback proof

A new integration test connects as a non-organizer JWT with `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`
left at its default (`'0'`) and asserts the connection still closes with code 4403 — identical
to pre-I2C behavior. Combined with the unchanged organizer path, a flag-off deployment is
byte-identical to before this slice.

## Flutter wiring

Both roles now open a `RealtimeClient` connection on `initState`, in parallel with the existing
HTTP-first-paint fetch (`_loadParticipantView()` for participant, `_loadInitialSnapshot()` for
organizer) — matching the "whichever resolves first shows the lobby" principle ENG1 §3 already
established for the organizer path, now extended to participant. `RealtimeClient` itself needed
no changes — it already accepted any JWT with no organizer-specific logic; the gap was entirely
in whether the Lobby screen chose to call it, and in what the server did with the token once
connected.

## Real-device E2E result

`participant_realtime_test.dart` (new) ran clean on a real booted iOS Simulator against the
real local backend (started with `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL=1`): organizer creates
and opens an $80 Vink with the seeded `demo_member_1` as a second participant; sign out; sign
back in as `demo_member_1`; tap the participant-role card on Home; the Lobby renders from the
live `snapshot` message (`0 of 2 paid`, `Your share`, not stuck on "Loading…"); the organizer
authorizes their own contribution via a raw API call from *outside* the app; the participant's
own Lobby updates to `1 of 2 paid` with no manual reload or navigation of any kind — the direct
proof of "Client Reachability." `e1_test.dart` (flag-off organizer path) was re-run immediately
after and stayed green, confirming no regression to the existing, well-tested organizer flow.

One real test-infrastructure bug was found and fixed while building this: the test originally
tried to simulate "sign out, sign back in as someone else" by calling
`tester.pumpWidget(const ProviderScope(child: VinkinApp()))` a second time with the identical
`const` widget. Flutter's element reconciliation treats an unchanged `const` widget as the same
element and keeps it mounted — the old `ProviderScope`'s state (cached `AuthSignedIn`, the
router's current `/vinks/:id` location) survived untouched, so the "signed out" app was still
showing the organizer's own Lobby. Fixed by unmounting with a throwaway widget
(`tester.pumpWidget(const SizedBox.shrink())`) before re-pumping the real app — the closest a
widget test gets to a genuine relaunch. This is a reusable pattern, not specific to this test,
for any future integration test that needs to switch signed-in identity mid-run.

A second, unrelated environment issue surfaced during this same verification pass: repeated
failed runs of the new test (before the reconciliation bug above was found) had each created
their own "Groceries" Vink with `demo_member_1` as participant, so Home accumulated multiple
identically-labeled cards and made the tap ambiguous. Fixed by truncating the local dev
database's `vinks` table (cascades to all dependent tables) — the same category of dev-data
cruft this codebase's own prior milestones (ENG1-TIMER-SEMANTICS.md) have hit and flagged
before; no product code was at fault.

## Complete validation

- `apps/api`: 133/133 tests green (`VINKIN_INTEGRATION=1`), including the 2 new realtime tests.
- `apps/mobile`: full `flutter test` (no path filter) green; `flutter analyze` clean at the
  same 11 pre-existing info-level lints documented since ENG0 (no new categories).
- Repo-wide `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean.
- Two real-device runs (iPhone 17 Pro simulator, real local Postgres + Redis +
  `apps/api/src/server.ts` with `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL=1`, no mocks):
  `participant_realtime_test.dart` (new) and `e1_test.dart` (regression) both pass.

## Deviations

- **Lean per-event patches are not hand-applied for the participant path.** The organizer path
  patches `state`/`fundedAmountMinor` from the lean payload immediately, then refetches for
  full accuracy. `ParticipantVinkSummary`'s `confirmedAmountMinor`/`confirmedParticipantCount`
  (derived from `contributionProgress`) don't map 1:1 onto the lean payload's
  `fundedAmountMinor`, so hand-patching would either be wrong or require inventing a
  participant-specific lean payload shape server-side. A full HTTP refetch on every event is
  simpler, correct, and consistent with this screen's own documented fallback principle
  ("refetch the authoritative snapshot on every event"). Cost: one extra round trip per event
  for a participant, versus organizer's snappier two-phase update — judged an acceptable
  trade-off for a first close of this gap, not flagged as a further open item since it causes
  no incorrect state, only a marginally later paint.
- **No wire-envelope discriminator added**, as described above — deliberate, matches the
  existing guest-branch precedent.

## Is this gap fully closed?

Yes, for the specific gap I2B flagged (participant realtime). The separately-flagged
Activity-feed gap (row 58 of the phase-10 traceability matrix) remains open and untouched —
out of scope for I2C, unchanged by this work.
