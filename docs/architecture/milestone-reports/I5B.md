# Slice I5B — Canonical Create Closure

**Brief:** owner-scoped, verbatim: record D39 (purpose is first-class Vink metadata) and D40
(draft participants are correctable); implement purpose as an additive backend field visible
on the canonical Purpose+Total screen; implement draft-only guest editing and participant
removal on the People+Split screen; repair `e1_test.dart`'s stale positional field
assumptions; prove flag-off/flag-on behavior on a real device; required tests; completion
report. "Stop after I5B."

Preserved without modification: the canonical two-screen navigation, the transient Open Vink
confirmation sheet, the delivery infrastructure (I4B), the split engine, and the feature-flag
mechanism — all Slice I5 work.

## Files changed

**Backend:**
- `apps/api/src/db/migrations/0013_vink_purpose.sql` (new) — nullable `purpose TEXT` column.
- `packages/domain/src/entities.ts` — `Vink.purpose: string | null`.
- `packages/application/src/commands.ts` — `CreateVinkInput.purpose?`, trim-to-null on create.
- `packages/application/src/guest.ts` — `PublicVinkSummary.purpose`; new
  `editGuestParticipantCommand`/`EditGuestParticipantInput`/`EditGuestParticipantResult`.
- `packages/application/src/delivery.ts` — invitation template purpose falls back to category.
- `packages/application/src/ports.ts` — `VinkTx.clearGuestDeliveryToken`/`updateGuestIdentity`.
- `packages/application/src/testing/in-memory.ts` — mirrors the two new port methods; fixes
  `findGuestParticipant` to exclude `REMOVED` participants.
- `apps/api/src/modules/vinks/store.ts` — `purpose` mapped in `rowToVink`/`insertVink`;
  `clearGuestDeliveryToken`/`updateGuestIdentity` added to `PostgresVinkTx`; same
  `findGuestParticipant` REMOVED-status fix as the in-memory store.
- `apps/api/src/modules/vinks/routes.ts` — `createSchema.purpose`; shared
  `superRefineDeliveryMode` extracted from `inviteGuestSchema`, reused by new
  `editGuestSchema`; new `PATCH /api/v1/vinks/:vinkId/participants/:participantId/guest`
  route; guest-dispatch template's purpose falls back to category.
- New integration test: `apps/api/src/vink-purpose-and-participant-editing.integration.test.ts`
  (9 tests, real Postgres).
- `packages/application/src/commands.test.ts`, `packages/application/src/guest.test.ts` — new
  D39/D40 test coverage (15 tests total across both files).

**Flutter:**
- `apps/mobile/lib/features/create_vink/canonical/canonical_create_vink_screen.dart` —
  purpose field + validation on screen 1; edit/remove affordances and handlers on screen 2.
- `apps/mobile/lib/features/create_vink/canonical/canonical_edit_guest_sheet.dart` (new).
- `apps/mobile/lib/features/create_vink/person_entry.dart` — `contactDestination` field.
- `apps/mobile/lib/features/create_vink/canonical/canonical_add_person_sheet.dart` — sets
  `contactDestination` on the returned `PersonEntry`.
- `apps/mobile/lib/features/create_vink/local_draft_store.dart` — `UnsavedDraft.purpose`.
- `apps/mobile/lib/core/models/vink.dart` — `Vink.purpose`.
- `apps/mobile/lib/core/networking/api_client.dart` — `patch`/`delete` methods (first PATCH
  endpoint in the app).
- `apps/mobile/test/support/fake_api_client.dart` — `patch`/`delete` overrides.
- `apps/mobile/test/features/create_vink/canonical/canonical_edit_guest_sheet_test.dart` (new,
  6 tests).
- `apps/mobile/test/features/create_vink/canonical/canonical_create_vink_screen_test.dart` —
  fixed two pre-existing tests for the purpose-field field-index shift; 5 new tests (purpose
  required, organizer has no edit/remove affordance, guest edit updates row, removal
  recalculates Equal, removal unreconciles Custom).
- `apps/mobile/integration_test/e1_test.dart` — `_fieldByLabel` semantic finder replaces
  positional registration-field lookups.
- `apps/mobile/integration_test/canonical_create_test.dart` — extended with purpose entry,
  guest edit, and member removal, plus real-backend assertions that all three persisted.

**Docs:**
- `docs/spec/decision-log.md` — D39, D40.
- `docs/design/phase-10-implementation-readiness.md` — implementation note under I5.

## Purpose schema and compatibility behavior

`purpose` is a nullable `TEXT` column (migration 0013, `ADD COLUMN IF NOT EXISTS`, no
constraint, no backfill). It is optional end-to-end at the data/API layer: `CreateVinkInput`,
the domain `Vink` type, and `createSchema`'s Zod validator all accept it as optional, so the
untouched five-step wizard — which never sends `purpose` — continues to create Vinks exactly
as before, and historical rows simply read back `purpose: null`. Requiring a non-empty value
is enforced only by the canonical screen's own client-side check before `Continue` proceeds
(mirroring how the total field's own validation already worked) — the API itself never
rejects a missing purpose, so no old client or historical record is broken.

## Category-versus-purpose boundary

`purchaseCategory` remains the sole policy input (`packages/domain/src/policy.ts` — fee/limit
rules key off it, unchanged). `purpose` carries no policy weight; it's freeform,
organizer-authored text ("Weekly grocery run") describing what the money is actually for.
Nothing infers one from the other for new canonical Vinks. Consumers that need a display
string when purpose is absent (both invitation-dispatch templates) apply
`vink.purpose ?? vink.purchaseCategory` as a customer-safe fallback — this is a presentation
convenience for old/historical records, not a data-model conflation; the two fields stay
independently stored and independently nullable/required.

## Participant edit/remove contracts

**Edit** (`PATCH /api/v1/vinks/:vinkId/participants/:participantId/guest`,
`editGuestParticipantCommand`): guest-only (a member has nothing client-editable — their
delivery is account-driven per I4). Every call sends the complete resulting state
(`displayName`, `deliveryMode`, conditional `contactDestination`) rather than a sparse patch,
reusing the exact `superRefineDeliveryMode` cross-field validation the invite contract already
enforces. Token handling follows the guest's actual state transition, not the request in
isolation: a fresh token is minted only when moving *into* `MANUAL` from a different mode; the
existing token is cleared only when moving *away from* `MANUAL`; a same-mode edit (e.g.
renaming an SMS guest) never touches `access_token_hash` at all.

**Remove** reuses the existing, unmodified `removeParticipantCommand` /
`DELETE /vinks/:vinkId/participants/:participantId` route — no backend change was needed here;
its organizer-ownership check and DRAFT-only gate were already correct.

## Draft-only authorization

Both paths are gated identically: `editGuestParticipantCommand` throws `INVALID_COMMAND` if
`vink.state !== 'DRAFT'` (checked immediately after `loadOwnedVink`, which itself enforces
organizer ownership via `ctx.actorUserId`); `removeParticipantCommand`'s pre-existing DRAFT
gate is unchanged. Neither path is reachable once a Vink is `OPEN` — the integration test
suite proves the edit route returns 422 post-open, and the Flutter screen only ever renders
edit/remove affordances while still on the pre-open create flow (there is no code path that
reaches `CanonicalCreateVinkScreen` for an already-open Vink).

A real, pre-existing privacy gap was found and fixed while building this: `findGuestParticipant`
(both `apps/api/src/modules/vinks/store.ts` and the in-memory test double) never excluded
`status = 'REMOVED'` participants, so a removed guest's already-issued token could still
authenticate against `/api/v1/guest/session`. This was previously unreachable in practice (no
UI ever removed a guest before I5B); the new integration test proves the fix with a genuine
401 after removal.

## Split-recalculation behavior

Equal is computed live from `_allParticipants` on every build, so a removal or the organizer's
own default inclusion is reflected on the very next frame with no explicit "recalculate" step.
Custom is never auto-rebalanced: removing or editing a participant that changes the assigned
total simply leaves Custom's sum mismatched against the required total, which
`_canContinueToConfirmation` already treats as un-reconciled — `Continue` disables again until
the organizer re-enters amounts, exactly the same mechanism that already gated a fresh Custom
entry. This was a deliberate choice (see Deviations) — silently redistributing money a human
explicitly typed would be a financial-semantics change, which the brief's own instruction not
to introduce post-open participant mutation implies applies with equal caution pre-open too.

## Old-flow E2E result

`e1_test.dart` (flag off) ran clean on a real booted iOS Simulator (iPhone 17 Pro) against the
real local backend: registration via the new `_fieldByLabel` semantic finder (replacing the
positional lookups I4 had silently broken), full five-step create → open → live funding → card
issuance → merchant settlement → COMPLETED. All screenshots captured, all assertions passed —
`All tests passed!`. This proves the old flow remains fully reachable and functionally
unchanged, including registration with the optional email/phone fields left blank.

## Canonical-flow E2E result

`canonical_create_test.dart` (flag on), extended for this slice, also ran clean on the same
simulator: purpose typed on screen 1 alongside category and total; a member and an SMS guest
added; the guest's display name edited in place (real `PATCH`, pre-filled from the real
snapshot, verified via the sheet's own `ChoiceChip` selection state); the member removed (real
`DELETE`), with Equal recalculating from 3-way $30.00 to 2-way $45.00 with no extra action;
Continue → Open Vink confirmation showing "2 people"; Open → live lobby confirming
`$0.00 of $90.00 funded`. Post-run direct backend queries confirmed the purpose
(`"Weekly grocery run"`) was genuinely persisted, and the participant list genuinely reflects
the edit and removal server-side (`Edited SMS Guest` present, `Demo Member One` absent) — not
merely believed client-side.

## Complete validation

- `apps/api`: **107/107** tests green (`VINKIN_INTEGRATION=1`), including the 9 new
  purpose/participant-editing integration tests.
- `packages/application`: **105/105** tests green, including the new D39 (5 tests) and D40 (8
  tests, plus 2 downstream-projection tests) coverage.
- `apps/mobile`: **129/129** tests green (full `flutter test`, no path filter); `flutter
  analyze` clean at the same 11 pre-existing info-level lints documented since ENG0/ENG1 (no
  new categories introduced).
- Repo-wide `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean.
- Two real-device runs (iPhone 17 Pro simulator, real local Postgres + Redis +
  `apps/api/src/server.ts`, no mocks): flag-off `e1_test.dart` and flag-on
  `canonical_create_test.dart` (extended for I5B) both pass.
- `apps/guest-web`: 41 passed / 8 failed under the same `pnpm test` run — these 8 are the
  same pre-existing Slice I3/I3A terminal-copy failures already documented in
  ENG2-CLOSURE-TYPED-CONTRACTS.md and ENG3-SLICE-1-REALTIME-BACKBONE.md as another concurrent
  session's own not-yet-green work; confirmed via `git log` that I5B touched no guest-web
  files, so these are unrelated to this slice.

## Deviations

- **Edit-after-resume pre-fill gap (disclosed, not fixed):** a guest's delivery
  mode/destination can only be accurately pre-filled in the edit sheet within the same session
  the guest was added (carried in-memory via `PersonEntry`). After an app relaunch and DRAFT
  resume, the backend snapshot's participant listing doesn't carry per-guest delivery
  mode/destination, so the edit sheet would start from a blank/MANUAL default rather than the
  guest's true saved configuration. No required test demands "edit after resume," and
  extending the snapshot/participant model to carry this was judged out of this slice's
  effort budget — flagged rather than silently left broken.
- **Custom is never auto-rebalanced on removal**, as described above — a deliberate reading of
  the brief's financial-semantics caution, not an oversight.
- **`purpose` stays optional at the API layer**, enforced only client-side in the canonical
  screen — deliberate, to avoid breaking the five-step wizard or any older client (see D39's
  own "alternatives considered").

## Is I5 fully closed?

Yes. I5 shipped the two-screen navigation, delivery capture, and confirmation sheet; I5B
closes both gaps flagged against it (no purpose field; no in-place participant correction) and
repairs the one real regression in its own E2E proof (`e1_test.dart`'s stale positional
finders). No further I5-scoped work is outstanding. The disclosed edit-after-resume pre-fill
gap is a known, bounded limitation, not an open closure blocker.

Stopping after I5B per the brief.
