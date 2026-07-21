# Milestone Report — ENG1 Slice 3 (Interrupted Setup Recovery)

Date: 2026-07-20 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: interrupted
setup recovery **only**, per the owner's own slice brief — no timer-value changes, no
merchant-payment changes.

## What was implemented

The system distinguishes exactly the states the brief named — unsaved local setup,
server-persisted setup, an opened Vink, and a completed Vink — and the client never uses the
"Draft" UI label to decide how to recover; every decision is made from the server's own
current state (`GET /api/v1/vinks/:id`), read fresh at the moment recovery happens.

**The core defect this slice fixes**: `/vinks/:vinkId` unconditionally routed to
`VinkLobbyScreen` regardless of the Vink's actual state — a screen built for OPEN-and-beyond
live/funding state. Home's own "Finish setup" button for a DRAFT Vink pushed straight into
it, landing the organizer on a page with no way to actually add participants, set a split, or
open the Vink: a dead end for any interrupted setup, every time.

- **Server-persisted setup → resume at its exact valid step.** New route
  `/create-vink/resume/:vinkId`; `CreateVinkScreen(resumeVinkId: ...)` fetches the snapshot
  and lands on Add people / Split / Review via a pure, directly unit-tested function
  (`resumeStepFor`, mirroring `computeAllowedActions` in
  `packages/application/src/queries.ts`): no other participant yet → Add people; split
  incomplete (`unallocatedAmountMinor > 0`) → Split; otherwise → Review, pre-populated exactly
  as the normal flow would have left it. Category and total are always already set (the
  backend requires both to create a Vink), so Purpose/Total are never a resume destination.
- **State decides the destination, not the button.** Two independent paths now agree:
  Home's Active Vinks card routes a DRAFT item to the resume route instead of the Lobby;
  `VinkLobbyScreen` itself also checks its own fetched snapshot and redirects to the resume
  route if the state is DRAFT — so any other path that reaches a DRAFT Vink (a deep link, a
  stale card) still ends up in the right place, not the dead end.
- **Unsaved local form → real restore-or-discard, not silent loss.** Purpose/Total (the only
  pre-network steps) are durably persisted via `LocalDraftStore` — reusing
  `flutter_secure_storage` under its own key rather than adding a new pub dependency for one
  small JSON blob, since nothing in it is actually sensitive. On the next time the user starts
  a Vink, a found draft is offered back ("Continue your last Vink?" / "Continue" / "Start
  over") instead of silently vanishing. Cleared the instant a Vink is actually created
  server-side — the server becomes authoritative from that point, and the two mechanisms
  never overlap.
- **Opened / completed Vinks**: already worked correctly (`VinkLobbyScreen`'s existing
  per-state copy) — re-verified, not changed.

## A ratified decision this slice respected, not reinterpreted

The brief's "discard" requirement was checked against `docs/spec/open-questions.md` **before**
implementing anything: G13 is **CLOSED**, ratified by the owner 2026-07-17 — "DRAFT
cancellation stays unmodeled." This means there is no server-side way to actually cancel/delete
a persisted DRAFT Vink, by owner decision, not oversight. So "discard" here means exactly what
it can honestly mean given that ratified constraint: real discard for the **unsaved local**
form (nothing server-side exists yet, so discarding it is unambiguous), and — for a
server-persisted DRAFT — leaving it exactly as `_confirmLeave()`'s existing copy already
promises ("saved as a draft — you can pick up where you left off"), now actually true. No
fabricated client-only "hide" was added for persisted drafts; that would desync from a Vink
that still genuinely exists and is still reachable by anyone with its participant list.

## Files changed

New: `apps/mobile/lib/features/create_vink/local_draft_store.dart`,
`apps/mobile/test/features/create_vink/resume_step_test.dart`,
`apps/mobile/integration_test/eng1_slice3_setup_recovery_test.dart`, this report.
Modified: `apps/mobile/lib/app/router.dart`, `apps/mobile/lib/features/create_vink/
create_vink_screen.dart`, `apps/mobile/lib/features/home/home_screen.dart`,
`apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart`.

## Tests added

4 new unit tests (`resumeStepFor` — all four step-selection branches, directly testable with
no I/O) + 2 new real-device integration tests. Repo totals: **27 Flutter tests** (up from 23),
`flutter analyze` unchanged at its documented 7 pre-existing info-level issues (see ENG0
baseline — none new).

Real-device proof (`eng1_slice3_setup_recovery_test.dart`, real touch injection on a booted
iOS Simulator, real local Postgres/Redis/API, no mocks — same discipline as `e1_test.dart`):
1. Organizer creates a Vink, adds one participant, deliberately does **not** finish the split
   — then the app is "relaunched" (a fresh `VinkinApp()` widget tree re-pumped from scratch,
   the closest a single test process can get to a real OS-level kill: every provider
   reconstructed, nothing carried over but the Keychain session and whatever's in Postgres).
   Home shows "Finish setup"; tapping it lands **directly on the Split step**, the already-
   added participant still there — not the old dead-end Lobby. The resumed setup is then
   actually finished end-to-end (Split → Review → Open → live-funded lobby), and a final API
   check confirms exactly one Vink exists for that organizer — the relaunch didn't fork a
   duplicate.
2. A pre-network draft (category + partial total, never submitted) survives the same
   relaunch; the app offers "Continue your last Vink?" the next time the user starts a Vink,
   and choosing "Continue" restores the category and total exactly as left.

## A real defect this milestone's own verification surfaced (environment, not product)

Getting the real-device test green took far longer than the fix itself, entirely due to two
compounding **local environment** issues, not product bugs:
1. The Mac's disk filled to 98% during this session (repeated Xcode builds/simulator churn
   across ENG0/ENG1 work) — this alone produced misleading, differently-shaped failures on
   every retry (`FileSystemException`, corrupted font caches from failed writes, focus-manager
   assertion failures), none of them real. Freed by erasing an unused stale simulator device
   and clearing Xcode's DerivedData (safe, regenerable caches only).
2. Independently, `xcrun simctl erase` + reboot cycles repeated in quick succession degraded
   the CoreSimulator daemon itself until an *install* (not a test-code) step started failing
   with `Mach error -308 (ipc/mig) server died)`. Fixed by fully killing
   `Simulator.app`/`com.apple.CoreSimulator.CoreSimulatorService` and letting them cold-start,
   not just re-erasing the device.
Once both were resolved, the test passed cleanly and repeatably. Worth remembering for future
sessions doing heavy real-device iOS Simulator verification: watch disk headroom, and don't
chase simulator flakiness by re-erasing the same device over and over — a full CoreSimulator
service restart is the actual fix.

## Known limitations

1. A resumed Split step always defaults to Equal mode, even if the interrupted attempt had
   partial Custom amounts entered — the user re-enters those if they'd switched modes before
   being interrupted. A real gap, but re-seeding `PersonEntry` with the server's current
   per-participant `allocatedAmountMinor` was judged a nice-to-have beyond this slice's core
   "land on the right step" requirement, not a silent product decision — flagged here for a
   future pass, not fixed in the dark.
2. A resumed guest participant's "Copy link again" affordance is unavailable
   (`guestJoinUrl: null`) — by design, not a gap: D14's raw guest token is returned exactly
   once, at invite time, and only its hash is ever stored thereafter, so it genuinely cannot
   be recovered from the snapshot.
3. Genuine setup expiry does not exist to recover from: the domain state machine
   (`packages/domain/src/vink-state-machine.ts`) has exactly one DRAFT transition
   (`VINK_OPENED → OPEN`) — a DRAFT Vink never times out or auto-expires on its own. The
   brief's "expired setup → explain and safely archive" case is therefore a non-issue for the
   *current* domain rather than something silently skipped; if a future decision adds DRAFT
   expiry, this slice's resume path is where that state would need a new branch.

## Next milestone

Per the owner's stated order: **ENG1 Slice 4 — typed retry classification and broader
duplicate-action protection** across the remaining mutating commands (add participant, split,
open, contribute, resend invitation, merchant payment actions, cancel), building on this
slice's and Slice 2's foundations.
