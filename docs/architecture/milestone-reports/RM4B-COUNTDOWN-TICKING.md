# RM4B — Frontend Countdown Ticking

**Date:** 2026-07-29
**Scope:** the frontend half of D47's dual-timer lifecycle — making the existing submission-
deadline countdown in `apps/mobile` and `apps/guest-web` genuinely tick, including seconds-level
display below one minute (owner-approved during RM4A planning), rather than the pre-existing
render-time-only computation that was invisible at the old 24h granularity but would visibly
freeze at RM4A's shortened 7-minute default. Checkpointed independently after RM4A, per the same
split precedent as every other RM slice.

## Audit first

A read-only research pass (not assumptions) found the countdown display already existed on both
platforms as a **pure render-time computation with no periodic re-render**:
- Mobile: two near-identical private `_timeRemainingLabel` helpers (`home_screen.dart`,
  `vink_lobby_screen.dart`), each computing `deadline.difference(DateTime.now())` once per
  widget build, with no `Timer.periodic`/ticking provider anywhere for this purpose (the app's
  only existing `Timer.periodic` is the unrelated realtime heartbeat).
- guest-web: `guest-copy.ts`'s `countdownLabel(deadline, now = new Date())` is itself a correct,
  already-tested pure function (Phase 6 §13's own ratified copy contract — "Closes in N
  minutes"/"Closes in under a minute"), called exactly once in `JoinForm.tsx` with no `now`
  argument supplied, so it froze at whatever value existed at initial render.
- The 10-minute card usage window (RM1/RM4A) is **entirely unsurfaced client-side on both
  platforms** — no field for it exists in either app's Vink/summary model. Confirmed
  deliberately out of scope for this slice (see "What was NOT built," below).
- `SessionView.tsx` (guest-web's post-join/contribute screen) never renders the deadline at
  all — an already-documented, pre-existing gap (`docs/design/phase-3-information-
  architecture.md`), unrelated to and unchanged by this slice.
- `_ActiveVinkCard` (the legacy, flag-off Home card) is explicitly documented
  (`home_screen.dart`'s own I6 comment) as staying **byte-for-byte untouched for rollback** —
  a real constraint respected below.

## What was built

### Mobile (`apps/mobile`)
- New `lib/design_system/components/vink_deadline_countdown.dart`:
  - `VinkDeadlineCountdown` — a `StatefulWidget` that owns a `Timer.periodic(1s)`, rebuilding
    only itself (not its ancestors) via a `builder(context, Duration? remaining)` callback.
    Reschedules on a `deadline` prop change, cancels cleanly on dispose. Takes an injectable
    `now` clock function (defaults to `DateTime.now`) purely for testability — `Timer` is
    already faked under `flutter_test`'s `testWidgets`, but `DateTime.now()` is not, so a test
    proving a real tick changed the rendered label needs to control both.
  - `formatTimeRemaining(Duration? remaining, {String? pastLabel})` — the same "Xm left"/"Xh
    left"/"Xd left" formatting every deadline label already used, extended with seconds-level
    display below one minute (`"Xs left"`). `pastLabel` is a parameter (not hardcoded) so each
    call site keeps its own pre-existing past-deadline behavior — Home's non-null `"Past
    deadline"` string (shown, not hidden) vs. Lobby's `null` (the row disappears entirely).
- **`_ActiveVinkCardV2`** (Home's current flag-on card) and **`vink_lobby_screen.dart`**'s Row
  both migrated to `VinkDeadlineCountdown`. Lobby's own now-redundant private
  `_timeRemainingLabel` was removed (its only call site was replaced). **`_ActiveVinkCard`**
  (Home's legacy flag-off card) and its own private `_timeRemainingLabel` were **deliberately
  left completely untouched** — modifying it would violate the I6-established "byte-for-byte
  untouched for rollback" rule; it keeps its pre-existing frozen-at-render behavior.

### guest-web (`apps/guest-web`)
- New `lib/use-countdown.ts`: `useNow(intervalMs = 1000)` — a small hook ticking a `Date` state
  via `setInterval`, cleaned up on unmount. `guest-copy.ts`'s `countdownLabel` function itself
  is **completely untouched** — its exact, already-ratified Phase 6 §13 copy (and its own
  dedicated test file, `tests/guest-copy.spec.ts`, pinning "Closes in N minutes"/"Closes in 1
  minute"/"Closes in under a minute") stays exactly as approved.
- `JoinForm.tsx` now calls `useNow()` and passes the live value into `countdownLabel(deadline,
  now)`, instead of relying on the implicit `now = new Date()` default evaluated once.

## A real, disclosed judgment call: seconds-level display was NOT added to guest-web

The owner approved "seconds-level display below one minute" during RM4A's planning, and
`formatTimeRemaining` implements it for mobile. For guest-web, adding numeric seconds text
would mean **overriding Phase 6 §13's own already-ratified, already-tested copy** — "Closes in
under a minute" is the exact, deliberate, no-numbers string that contract specifies, with a
dedicated passing test (`tests/guest-copy.spec.ts:143`) pinning it. Mobile has no equivalent
ratified copy contract blocking a numeric-seconds addition; guest-web does. Rather than
silently overriding a UX-track-ratified artifact with an engineering-track decision, this slice
made only the **ticking** fix on guest-web (the label now correctly reflects live time and
correctly disappears at the right real moment, instead of being frozen from initial render) and
left the copy itself untouched. Flagged here, not silently resolved either way — the seconds-
level guest-web question is open, for the owner or the UX track to decide, not this slice.

## What was NOT built (disclosed, out of scope)

- **The 10-minute card usage window is still not surfaced on either client.** Neither app's
  Vink/summary model carries `usageWindowExpiresAt` at all — adding a new countdown for a
  timer that has never been shown to a user on any screen would be inventing a new UI surface,
  not "making an existing countdown tick" (this slice's actual, narrower scope per the RM4A
  report's own framing). Flagged as a real, open gap for a future slice or explicit owner
  direction, not silently added.
- **`SessionView.tsx`'s own pre-existing gap (no deadline shown at all post-join) is unchanged**
  — already documented in `docs/design/phase-3-information-architecture.md`, not this slice's
  defect to fix.
- No visual/animation redesign — Phase 9's "no animation on minute changes" constraint is
  respected by construction (the widget just swaps text on each tick; nothing new animates).

## Tests

**Mobile** — new `test/design_system/vink_deadline_countdown_test.dart` (11 tests):
`formatTimeRemaining`'s full range (null, past-with-label, past-with-null-hiding, seconds,
minutes, hours, days) plus four `VinkDeadlineCountdown` widget tests, including the one that
actually proves the fix: a widget with an injected fake clock, observed through three real
`tester.pump(1s)` ticks, whose rendered text genuinely changes from `"1m left"` → `"55s left"`
→ `"15s left"` → `"Past deadline"` as the injected clock advances — not merely that the
function returns the right string in isolation. Confirms `Timer` cancellation on dispose (no
pending-timer test failure) and correct rescheduling on a `deadline` prop change.

**guest-web** — new `tests/rm4b-countdown-tick.spec.ts` (1 test, real backend + real browser):
creates and opens a real Vink (RM4A's genuine ~7-minute server-computed deadline), then uses
Playwright's `page.clock` to deterministically pause the **browser's** clock 90 seconds before
that real deadline (installed before navigation, so even the first render is controlled),
navigates, and asserts `"Closes in 1 minute"`; `fastForward(35_000)` (letting the real
`setInterval` fire ~35 times) and asserts the text has genuinely changed to `"Closes in under a
minute"`, with the old text gone; `fastForward(120_000)` past the real deadline and asserts the
row disappears entirely — all with **zero page reload** and **zero real wall-clock wait** (the
test runs in ~540ms). This is the fix's own actual proof: the label updates live, driven by the
tick, not by any other trigger.

## Verification

- `flutter analyze`: clean, same 26-issue pre-existing baseline, none introduced.
- `flutter test`: **265/265** (up from 254 — 11 new).
- guest-web `tsc --noEmit`/`eslint`: clean.
- guest-web Playwright: **44 passed** (up from 43 — the 1 new RM4B test), **8 pre-existing
  failures unchanged** (`e9.spec.ts`/`guest-terminal-states.spec.ts` Slice I3/I3A terminal-copy
  tests — confirmed via `git status` that this slice never touched either file; the same
  disclosed-unrelated failure set every prior milestone report since ENG3 has documented), 1
  skipped. Verified against a real local API server (Postgres + Redis + `apps/api/src/
  server.ts`, started with the documented `VINKIN_PUBLIC_BASE_URL=http://127.0.0.1:3100`/
  `OPERATIONS_CONSOLE_BASE_URL=http://127.0.0.1:3200` CORS overrides), not mocked.
- `pnpm typecheck/lint/format:check/guard`: clean, 12/12 packages.

## What did NOT change

`FinancialProvider`, every backend command/route/schema, `packages/domain`, `packages/
application`, `packages/reconciliation` — RM4B is client-only, zero backend files touched.
`guest-copy.ts`'s `countdownLabel` function and its own ratified Phase 6 §13 copy are untouched.
`_ActiveVinkCard` (Home's legacy flag-off card) is untouched, preserving its I6-established
rollback guarantee.

## Next

This closes RM4A/RM4B and, with them, the full D47 Real-Money Beta dual-timer lifecycle work
(RM1 card pool schema → RM2 provider-boundary lifecycle → RM3A capture-immediately funding →
RM3B card-pool cutover → RM4A backend dual-timer lifecycle → RM4B frontend countdown ticking).
Remaining named RM slices per the approved plan: RM5 (wallet provisioning — blocked on external
Apple/Google Wallet credentials, same class of gap as ENG5's Sign in with Apple/Google), RM6
(ops-console dispute review + scoped refund route), RM7 (beta-cap configuration). Awaiting
owner direction on which to take up next.
