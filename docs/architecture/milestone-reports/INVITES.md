# Invites — a real accept/decline gate before Vink membership

**Brief:** owner-directed, arising from a direct comparison between two aspirational mockups
and the shipped app after I6 closed. The mockups showed a "You're invited to… Not now / View"
Home card implying real agency over joining a Vink — the shipped app had none: an organizer
adding an existing member made them a full participant instantly, with no acceptance step.
Presented with three sized options (full feature / lighter dismiss-only card / defer), the
owner chose the full version. See **D44** (`docs/spec/decision-log.md`) for the complete
decision record; this report covers implementation and verification.

## What shipped

A real `INVITED → JOINED` (accept) or `INVITED → REMOVED` (decline) gate, flag-gated end to
end (`VINKIN_INVITES_ENABLED` server-side, `FeatureFlags.invitesEnabled` client-side):

- **Domain:** `Participant` gains `invitedAt` (always set) and a nullable `joinedAt` (null
  while `INVITED`). `ParticipantStatus`'s `INVITED` value — declared in the type and the DB
  CHECK constraint since PV3, never assigned anywhere — is now real.
- **`addParticipantCommand`** (existing-member path only; the separate guest-invite flow is
  untouched): inserts `INVITED`/`joinedAt: null` when the flag is on, emitting a renamed
  `ParticipantInvited` event instead of `ParticipantJoined`. Flag off is byte-for-byte
  unchanged.
- **Two new commands** (`packages/application/src/invites.ts`): `acceptInviteCommand` and
  `declineInviteCommand`, actor-resolved to the invitee themselves (not the organizer).
  Decline reuses `removeParticipantCommand`'s exact allocation-zeroing/`assertNoLiveContributions`
  handling rather than reinventing it, landing on the same `REMOVED` state (D11: canonical
  state names, no fourth value) with a distinct outbox event (D12: the event, not the state,
  carries the semantic distinction).
- **Three new routes:** `POST .../participants/me/accept`, `POST .../participants/me/decline`,
  `GET /api/v1/invites` (deliberately not an extension of `GET /api/v1/vinks` — see D44 for
  why overloading that endpoint's `role` field was rejected).
- **The one required fix, not optional polish:** `listVinksByParticipant` (`GET /api/v1/vinks`'s
  data source) changed from `status != 'REMOVED'` to `status = 'JOINED'` — without this, an
  `INVITED` row would have silently started appearing in Home/Activity's normal "my vinks" list
  the moment the flag went live, regardless of the client's own Invites-tab work.
- **Flutter:** a 4th "Invites" tab (`nav_shell.dart`/`router.dart`, conditional branch count —
  not just a visual toggle), `InvitesScreen` + `invitesProvider` (plain `FutureProvider`, no
  partial-failure wrapper needed since the endpoint is one atomic query), per-row
  `CommandRunner`-based Accept/Decline, and a new `PendingInviteCard` design-system component
  wired into Home as a new top section (dismiss-only "Not now," real Decline lives on the
  Invites tab).

## Deviations from the original plan's stated defaults

- **`packages/client-contracts`' analytics vocabulary was NOT extended.** The original plan
  (written before re-reading that package's own governance) assumed the three new domain event
  names belonged there. On inspection, `client-contracts/src/events.ts` is strictly the C1–C45
  Phase 5 *button-interaction analytics* catalog with an explicit "nothing here is invented"
  rule tied to an approved design doc — a wholly different vocabulary from the domain/outbox
  event names (`ParticipantInvited` etc.) this slice actually added. There is no Phase 5
  contract for Invites analytics events, so none were invented. This screen fires no analytics
  events at all, unlike its sibling screens — flagged here, not silently done.
- **The Invites tab's own `PendingInviteCard`/`InvitesScreen` deliberately do not import the
  `PendingInvite` domain model** into the design-system layer — `PendingInviteCard` takes plain
  primitives, matching every other design-system component's existing decoupling from
  `core/models` (e.g. `VinkAvatar` takes a bare `name`, not a `Participant`).

## Real environment issue found and fixed, not a code defect

Migrations in this project run manually (`node src/db/migrate.ts`), not automatically on server
boot. The first real-device run failed with `column "invited_at" of relation "participants" does
not exist` — migration `0014` had been written but never applied to the long-running local dev
database from earlier in the session. Running the migration and restarting the server resolved
it; this is an environment/process gap (no auto-migrate-on-boot), not a bug in the migration
itself or the application code, consistent with this session's own prior documented cruft
patterns (stale processes, unapplied schema).

## Real-device result

`apps/mobile/integration_test/invites_test.dart` (new), real iOS Simulator, real local
Postgres + Redis + `apps/api/src/server.ts` (`VINKIN_INVITES_ENABLED=1`,
`VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL=1`), `--dart-define=INVITES_ENABLED=true
--dart-define=HOME_ACTIVITY_V2=true`:

1. A freshly registered organizer creates and opens a $60 Vink, adding the seeded
   `demo_member_1` as an existing member through the real UI.
2. Verified directly against the backend: `demo_member_1`'s participant status is `INVITED`
   (not `JOINED`) immediately after being added — the gate is real, not cosmetic.
3. `demo_member_1` signs in; the Invites tab shows the pending invite with the real organizer
   name and assigned share (`demo_member_1` is a long-lived seeded account reused across every
   real-device test this whole session, so the test asserts "at least this invite is present"
   rather than "exactly one," and taps the first — newest-invited-first ordering guarantees
   that's this run's own).
4. Tapping Accept fires the real `POST .../participants/me/accept` call.
5. Verified directly against the backend: status is now `JOINED`, and the Vink now appears in
   `demo_member_1`'s own real `GET /api/v1/vinks` list — the full loop, proven end to end
   against a real database, not a widget test double.

`e1_test.dart` (the E1 golden-path regression) was re-run to confirm the rollback contract:
clean and green **with the server flag off** (default). Running it against a server with the
flag on but no corresponding client build reproduced the exact "stuck INVITED, can't pay"
scenario documented as an operational finding in D44 — confirming the finding is real, not
theoretical, and that this is the correct behavior for a client genuinely unaware of the
feature, not a bug.

## Tests

- `packages/application/src/invites.test.ts` (new, 13 tests): both commands' happy paths,
  wrong-actor rejection (organizer and a stranger, distinguished from a genuine "already
  resolved" case), double-accept/double-decline, wrong-vink-state rejection, decline blocked
  once a live contribution exists (reusing `removeParticipantCommand`'s own fixture pattern),
  `listMyPendingInvites`'s three shapes.
- `packages/application/src/commands.test.ts`: `addParticipantCommand`'s flag-off/flag-on
  branches, and the crux regression — a Vink still opens with an unaccepted `INVITED`
  participant once the split covers them.
- `packages/application/src/contributions.test.ts`: an `INVITED` participant's
  `authorizeContributionCommand` call is rejected `FORBIDDEN` (closes the loop on a dead-code
  path that became live the moment `INVITED` rows started existing).
- `apps/api/src/invites.integration.test.ts` (new, 6 tests, real Postgres): flag-off 404 +
  unchanged-JOINED behavior; flag-on INVITED creation, `GET /api/v1/invites` vs `GET
  /api/v1/vinks` separation; accept moving an invite between those two lists; decline
  reopening the split; 403 for a wrong actor; 409 for a double-resolve; a genuine concurrent
  double-accept race (`Promise.all`) proving the database, not the application pre-check, is
  the real guard.
- Flutter: `pending_invite_card_test.dart` (2), `invites_providers_test.dart` (4),
  `invites_screen_test.dart` (6, including a `CommandRunner`-success test proving Accept
  invalidates both `invitesProvider` and `myVinksProvider`), `nav_shell_test.dart` (3, flag
  off/on tab structure, Invites tab reachability, Profile's shifted index).

## Validation

- `pnpm typecheck / lint / format:check / guard`: clean across all 10 packages.
- `apps/api`: 143/143 (`VINKIN_INTEGRATION=1`, up from 137).
- `packages/application`: 137/137 (up from 120).
- `apps/mobile`: full `flutter test` 219/219 (up from 204); `flutter analyze` clean at the
  documented 11-issue info-level baseline (no new categories).
- Real-device: `invites_test.dart` (new) and `e1_test.dart` (regression) both green.

## Is Invites fully closed?

Yes, for the scope the owner approved. Three items are explicitly flagged in D44 as adjustable
defaults, not settled decisions, should the owner want something different: whether a Vink
should be allowed to open with an unaccepted invitee, whether an invitee should be able to
preview the full participant view pre-acceptance, and whether "Not now" should stay dismiss-only
or become a real decline. No further Invites work is planned unless one of those is revisited.
