# Phase 10 — Implementation Readiness, Sequencing, and Verification Plan

_UI/UX Engineering Plan, Phase 10 (final documentation phase) output: an executable
engineering plan converting Phases 0–9's completed UX system into sequenced, testable,
independently-releasable work. Source of truth: `docs/design/phase-0-product-behavior.md`
through `docs/design/phase-9-motion-system.md`, `docs/spec/decision-log.md` (D1–D36),
`docs/spec/open-questions.md`, `docs/product-validation/00-governance.md` (real feature-flag/
environment practice), and direct inspection of the current Flutter/Next.js/API/domain/
persistence/realtime/auth/test source._

**Status:** DRAFT. **Documentation only — no Flutter, Next.js, backend, API, authentication,
notification delivery, database, infrastructure, design-token, test, or CI code was
modified.** This document designs no new screens, copy, states, financial behavior, or
provider functionality — everything referenced below was already decided in Phases 0–9 or
D1–D36; this phase only sequences and specifies how to build it.

---

## 0. Executive implementation strategy

VinkIn's redesign is **not a rewrite**. Phases 0–9 repeatedly found the same shape: real,
working financial machinery (`packages/domain`'s two state machines, the D5 single resolver,
the ledger's append-only/balanced triggers) sitting under a UI layer with specific, nameable
gaps — a handful of missing read projections (`contributionProgress`, guest
`contributionStatus`), one missing query shape (participant-inclusive retrieval), a few
genuinely live defects (destructive-button contrast, button-width jump, three bare "Loading…"
screens), and a visual/copy/motion system that's now fully specified but not yet wired in.

The strategy follows directly from that finding: **twelve small, independently-releasable
vertical slices**, each landing a real user-visible improvement without touching the state
machines, the ledger, or any already-verified financial transition. Read-model work (I1)
lands before any client consumes it. Accessibility/contrast fixes (I0) land first and alone,
since they're real defects independent of everything else. The one genuinely provider-blocked
piece (the payment-presentment module inside Ready-to-Pay, I11) is scoped down to its stable
shell and explicitly left open pending the M0 gate — never faked, never treated as available.

**What this plan protects, unconditionally, across every slice:** the D5 single-resolver
funding decision, the append-only/balanced ledger, the two domain state machines exactly as
`packages/domain` defines them today, D13's command-layer boundary (no transport ever mutates
an aggregate directly), and the provider-import CI guard
(`tooling/scripts/check-provider-imports.mjs`). No slice below touches any of these — every
slice is additive reads, new client consumption of existing/new reads, or corrections to
already-broken UI code.

---

## 1. Requirement traceability matrix

| Requirement | Origin | Current status | Affected code | Backend dep. | Mobile dep. | Guest Web dep. | Test requirement | Rollout risk | Priority |
|---|---|---|---|---|---|---|---|---|---|
| D19/D27 automatic SMS/email delivery | D19, D27 | **Member path shipped end-to-end (I4, 2026-07-21); guest path deliberately deferred — a real architectural finding, not a scope choice.** `packages/delivery` (new package, mirrors `FinancialProvider`) + `packages/application/src/delivery.ts` dispatch a member's invitation automatically at `VINK_OPENED` (or immediately, if added once already OPEN) using their own captured `users.email`/`users.phone`. Guest dispatch cannot live in the application layer at all: the raw guest join token is minted by the transport and only its hash ever reaches the command (D14, hard rule) — the link a delivery message needs literally cannot be assembled where `inviteGuestCommand` runs. `inviteGuestCommand` still captures and stores the guest's contact destination now; the transport-layer send call site (`apps/api/src/modules/vinks/routes.ts`, where the raw token is minted) is the deferred piece — that file was under active, unrelated concurrent edit for this entire pass. | `packages/delivery/*` (new), `packages/application/src/delivery.ts` (new), `commands.ts`, `guest.ts`, `apps/api/src/modules/vinks/{routes,store}.ts`, `apps/api/src/config/env.ts`, `apps/api/src/server.ts` | Shipped (member path) | n/a this pass | n/a (organizer-side only) | `invitation-delivery.integration.test.ts` (2/2, real Postgres): dispatch-ordering (never before `VINK_OPENED`) + partial-failure (one delivery failing never blocks the vink's own OPEN transition or the other participant's delivery); **external dependency: provider selection (§4)** for the real send | Medium — new external integration surface | I4 member path done; guest transport wiring open |
| Guest/member contact capture | D19/D27 prerequisite | **Real finding, not "not built": `users.email` has existed since migration 0001 (PV1) and was already wired into registration — verified by reading the whole auth module before writing any code, per this slice's own instruction. `users.phone` existed in the schema but was completely dead code (never read or written anywhere) until this slice. `guest_identities` genuinely had no contact field at all — that part of "not built" was accurate.** Migration 0011 adds `guest_identities.contact_destination`/`contact_method` and a new `invitation_deliveries` audit table (delivery is infrastructure, not domain state — no `participants` column, `packages/domain` untouched). `phone` now wired through `registerUser`/`PublicUser`/`findUserById` exactly like `email` already was. New `PATCH /api/v1/me` (didn't exist before) lets a signed-in user set/change/clear either field — Register captures once at signup, Profile is the only other place it could ever be revisited, though no Profile *screen* consumes the new route yet (Register does; Profile editing UI deferred, flagged not silently dropped) | `apps/api/src/db/migrations/0011_contact_capture.sql`, `apps/api/src/modules/auth/{service,routes}.ts`, `apps/mobile/lib/features/onboarding/register_screen.dart`, `apps/mobile/lib/core/auth/auth_controller.dart`, `apps/mobile/lib/core/models/user.dart` | Shipped | Register done; Profile deferred; Add-Participant delivery-choice control not built (no real provider to choose between yet — moot until one exists) | n/a | `auth.integration.test.ts` (2 new tests, real Postgres): phone registration, full PATCH /me set/change/clear/unauthenticated cycle | Low — additive schema, additive route | I4 done (Register); Profile/Add-Participant UI open |
| D23 guest "not open yet" | D23 | **Shipped end-to-end (I1 backend 2026-07-20 + I3 client 2026-07-21)** — `getPublicVinkView`/`getGuestVinkView` gate on `DRAFT` behind `VINKIN_CONTRIBUTION_PROJECTION_ENABLED`; `JoinExperience`/`app/g/[token]/page.tsx` now decide by `vinkOutcome === 'not_open_yet'` (works correctly whether the backend flag is on or off), rendering "Not open yet — Check back soon." and withholding the amount/split. | `packages/application/src/guest.ts`, `apps/api/src/modules/sharing/routes.ts`, `apps/api/src/config/env.ts`, `apps/guest-web/lib/guest-view-guards.ts`, `features/join/JoinExperience.tsx`, `app/g/[token]/page.tsx` | Shipped | n/a | Shipped | Contract: `guest-projections.test.ts`; Playwright: `e9.spec.ts` "I3 D23" (real DRAFT vink, real browser) | High priority (hard-rule fix) — low technical risk | I1 + I3 done |
| D24 `contributionProgress` | D24 | **Backend shipped (I1, 2026-07-20)** — `VinkSnapshot.contributionProgress` (unconditional/additive) and the same shape on the guest views; clients still read `fundedAmountMinor` (I7/I8's job) | `packages/application/src/queries.ts` (`computeContributionProgress`, exported), `guest.ts` | Shipped | Consume, replace linear bar — I7 | Consume, replace bar — I8 | Contract tests across split/state combinations: `queries.test.ts` (8/8), `guest-projections.test.ts` (§12) | Low — additive, old field untouched during rollout | I1 done, I7/I8 pending |
| Guest viewer-specific `contributionStatus` | D24 | **Shipped end-to-end (I1 + I3)** — `SessionView.tsx` now gates the "Approve" action on `participant.contributionStatus` (server truth) instead of local component state, closing P0-2's reload-reoffer defect. | `packages/application/src/guest.ts`, `apps/guest-web/features/join/SessionView.tsx`, `use-guest-realtime.ts` (new `refetch`), `lib/guest-copy.ts` (`contributionStatusWord`/`contributionStatusSentence`, Phase 6 §10, exhaustive) | Shipped | n/a | Shipped | `guest-projections.test.ts`; `tests/guest-copy.spec.ts` (16/16 exhaustive copy); Playwright `e9.spec.ts` "I3 reload-safety" (real reload, real browser, proves the actual regression fix) | High priority (safety-critical: D25's never-re-offer guarantee) | I1 + I3 done |
| D25 differentiated guest terminal outcomes | D25 | **Shipped end-to-end, all six outcomes (I1 + I3 + I3A, 2026-07-21)** — the 8-value `GuestVinkOutcome`/`GuestContributionStatus` enums drive `SessionViewV2`'s composition via the new `guestTerminalSentence` (prioritizes the guest's own `contributionStatus` over the vink-level `vinkOutcome` for `return_pending`/`returned`/`recovery_required` — a real correctness gap I3A found and fixed: a guest whose captured contribution is being refunded typically sits on a vink whose own `vinkOutcome` reads `expired`, and the vink-level sentence alone — "You weren't charged." — would be factually wrong for them). `recovery_required` now shows the canonical sentence to the guest too (**D37** corrects §16/§18's original organizer-only annotation and I3's own prior "stays null" interpretation), with its own stricter treatment: no `StatusBadge` (its raw-state label "Resolving a shortfall" is organizer-facing recovery language), no `SignupConversion` (extended to `return_pending`/`returned` too — none of the three are a "done, go tell your friends" moment), and a conditionally-rendered "Contact support" link gated on a real `NEXT_PUBLIC_SUPPORT_CONTACT_URL` being configured (unset by default — no invented destination, Phase 6 §21's own rule). | `packages/application/src/guest.ts`, `apps/guest-web/lib/guest-copy.ts` (`guestTerminalSentence`), `apps/guest-web/lib/config.ts` (`SUPPORT_CONTACT_URL`), `features/join/SessionView.tsx` | Shipped | n/a | Shipped | `guest-projections.test.ts`; `tests/guest-copy.spec.ts` exhaustive (all 8 outcomes × all 8 statuses + `guestTerminalSentence`'s priority logic); Playwright: `e9.spec.ts` proves `completed`/`cancelled`/`expired` live against a real backend; new `tests/guest-terminal-states.spec.ts` proves `return_pending`/`returned`/`recovery_required` deterministically via fixture interception (real browser, real DOM, no real backend needed for these three, per I3A's own explicit instruction not to build new financial workflows to manufacture them) — copy exactness, absence of contribution controls, absence of promotional content, absence of raw terminology, and accessible heading/reading order all asserted per state; plus the support-link on/off pair (2 builds) | High priority — trust-critical | I1 + I3 + I3A done — all six D25 outcomes now verified, five of six through some form of real-browser Playwright proof |
| Participant-inclusive Home retrieval | Phase 3 §1 | **Shipped end-to-end (I2A+I2B, 2026-07-21)** — `listMyVinksWithRole` (I2A) backs a flag-gated `GET /api/v1/vinks` (`VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`) returning the organizer∪participant union with an additive per-entry `role`; Home's `myVinksProvider`/`activeVinksProvider` consume it, routing a participant-role card to a new customer-safe `GET /api/v1/vinks/:vinkId/participant-view` (new `getParticipantVinkView`, guest-view-shaped, own-contribution-only) instead of the organizer-only snapshot route, which would 403 for a mere participant. RESTRICTED is deliberately not filtered out of Home's Active Vinks list for a participant-role entry (unlike for the organizer) so it stays reachable, per this slice's own explicit requirement. **Known gap, flagged not silently assumed**: the participant lobby view is HTTP-only, no realtime channel — `GET /api/v1/vinks/:vinkId/live` also resolves non-guest tokens via the organizer-only `getVinkSnapshot` (`apps/api/src/modules/realtime/routes.ts`), so it would 403 for a participant exactly like the REST route did before this slice; wiring participant realtime is out of I2B's scope. | `packages/application/src/guest.ts` (`getParticipantVinkView`), `apps/api/src/config/env.ts`, `apps/api/src/modules/vinks/routes.ts`, `apps/mobile/lib/core/models/vink.dart` (`role`, `ParticipantVinkView`), `apps/mobile/lib/features/home/home_providers.dart`, `home_screen.dart`, `apps/mobile/lib/app/router.dart`, `apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart` (`_ParticipantLobbyBody`) | Shipped | Shipped | n/a | Contract: `participant-view.test.ts` (6/6); real-Postgres transport contract: `participant-inclusive-transport.integration.test.ts` (10/10, incl. the named E2E regression); Flutter: `vink_role_test.dart`, `home_screen_test.dart`, `activity_screen_test.dart` (10/10) | Low — additive, both flag-off paths byte-identical to pre-I2B | I2 done |
| Participant-inclusive Activity retrieval | Phase 3 §4 | **Partially shipped (I2B, 2026-07-21)** — Activity's underlying vink list is participant-inclusive same as Home's, and the screen renders without regression under the new response shape (`activity_screen_test.dart`). **Known gap, flagged**: `recentActivityProvider`'s per-vink `GET /api/v1/vinks/:vinkId/activity` fetch (`getVinkActivity`) is organizer-only in the domain (`loadOwnedVinkForRead`) — a participant-role vink's own events don't appear in "Recent activity" yet; building a customer-safe activity feed for a mere participant is a genuinely new read surface (filtering which events are safe to show a non-organizer), judged out of I2B's "smallest client changes" scope. | Same as Home row above, plus `apps/mobile/lib/features/activity/activity_providers.dart` (unchanged — the gap is exactly that it's unchanged) | Not built (organizer-only) | Screen renders without crashing; feed content still organizer-only | n/a | `activity_screen_test.dart` | Low | Vink list union done; per-participant activity feed still open — candidate for I3/I6 |
| D26 in-place reauthentication | D26 | Not built — `isAuthError` defined, unconsumed | `apps/mobile/lib/core/networking/api_client.dart`, `auth_controller.dart`, Create/Lobby state preservation | n/a (client-only) | New global listener + overlay + state preservation | n/a (Guest Web has its own separate token-expiry gap, tracked in I3) | Widget tests: no action replay, state preserved | Medium — touches app-wide session handling, needs security review | I9 |
| D30 two-screen Create flow | D30 | Not built — five-step wizard today | `apps/mobile/lib/features/create_vink/*` | n/a | Full screen restructure | n/a | Widget tests: idempotent Open Vink, split validation retained | Medium — user-facing flow restructure of a well-tested screen | I5 |
| D31 Vink Details naming/ownership | D29, D31 | Not built — Activity is non-interactive today | New `apps/mobile` screen, possibly a small application-layer read | Possibly a small additive read | New screen | n/a (no Guest Web equivalent) | Widget test: never renders "Receipt" | Low | I6 |
| D32/D35 provider-dependent Ready-to-Pay boundary | D32, D35 | Not built | `apps/mobile` Lobby → new shell screen | n/a (shell only; module itself blocked) | New shell, bounded unstyled module | n/a | Widget test: module never auto-reveals, deliberate tap required | **Blocked by M0 for the module; shell itself is buildable now** | I11 |
| D33 contribution action is the confirmation | D33 | Already matches — no separate sheet exists today | n/a | n/a | n/a | n/a | Regression test confirming no sheet is ever added | n/a | Preserved, not a slice |
| D34 canonical money-outcome language | D34 | Not built in Guest Web; partially correct in mobile | `apps/mobile`, `apps/guest-web` copy layers | n/a | Apply Phase 6 §18/§25 strings | Apply same strings | Snapshot/string tests per outcome | Low | I3 (guest), I6 (mobile Vink Details) |
| D36 semantic-role-specific contrast | D36 | **Fixed in I0 (shipped 2026-07-20)** — `VinkDestructiveButton`, `VinkStatusBadge`'s `attention` tone, `VinkInlineError`, `VinkAmountSummary`, `InputDecorationTheme.errorStyle`, and Guest Web's `StatusBadge`/`JoinForm`/`SessionView`/token-redeem error text all moved from `danger` to `text.primary` foreground; tool-verified (§14, `contrast_test.dart`) | `apps/mobile/lib/design_system/components/{vink_buttons,vink_status_badge,vink_inline_error,vink_amount_summary}.dart`, `vink_theme.dart`, `apps/guest-web/components/StatusBadge.tsx`, `apps/guest-web/features/join/{JoinForm,SessionView}.tsx`, `apps/guest-web/app/g/[token]/page.tsx` | n/a | Shipped | Shipped | Automated contrast tooling (§14) — `apps/mobile/test/design_system/contrast_test.dart`, 10/10 passing | Resolved | I0 |
| Shared Guest Web spacing/radius tokens | Phase 8 §6/§7 | Not built — ad hoc Tailwind defaults | `apps/guest-web/app/globals.css`, component styles | n/a | n/a | New token layer | Visual regression / manual audit | Low | I8 |
| Ink Progress visual and motion behavior | Phase 8 §15, Phase 9 §10 | Not built — linear bar everywhere | `apps/mobile` `VinkProgressIndicator`, `apps/guest-web` `ProgressBar.tsx` | Depends on `contributionProgress` (I1) | New component | New component (replaces `ProgressBar.tsx`) | Widget/component tests per §10's state table | Medium — visible on every high-traffic screen | I7/I8 |
| Reduced-motion behavior | Phase 9 §23 | **Absent everywhere** (no handling found) | New cross-cutting utility, both platforms | n/a | New | New | Reduced-motion-on test runs (§14) | Low | I10 |
| Fixed-width button loading treatment | Phase 9 §2/§7 | **Live defect today** (§2) | `apps/mobile/lib/design_system/components/vink_buttons.dart` | n/a | Component fix | Guest Web's own two buttons need the equivalent audit | Widget test: width delta == 0 during loading | **High priority — live, low-risk fix** | I0 |
| Guest Web deadline rendering | Phase 3 §6, Phase 8 §16/§22 | **Live gap today** — field exists, never rendered (§2) | `apps/guest-web/features/join/SessionView.tsx`/`JoinForm.tsx` | None — field already in `GuestVinkView` | n/a | Pure rendering addition | Playwright: deadline visible while `OPEN` | **Low risk, no backend dependency — buildable immediately** | I3 |

---

## 2. Verified implementation-defect register

Every entry below was confirmed against real source during Phases 1, 8, and 9 — none are
hypothetical.

### P0 — live, user-facing, fix before anything else in I0

**P0-1. Destructive-control contrast (D36 violation, live today). — FIXED in I0
(2026-07-20).**
`apps/mobile/lib/design_system/components/vink_buttons.dart:126-172` — `VinkDestructiveButton`
rendered `danger`-colored text (`buttonLabel`, 15px/700) on a transparent/white surface.
Tool-verified contrast (`contrast_test.dart`): `danger`/`white` ≈4.38:1, `danger`/`paper`
≈3.96:1, both under the 4.5:1 AA floor for normal-size text — confirming `buttonLabel`'s bold
weight at 15px does **not** qualify for the relaxed large-text threshold (needs ≥18.66px bold
or ≥24px any weight). **Fix shipped:** label/spinner moved to `VinkColors.ink` (`text.primary`
interim default, Phase 8 §4/§10/D36); the `danger`-tinted border is kept (non-text, verified
≥3.0:1) so the destructive signal still reads. **Same defect class also found and fixed,
during I0's own source audit, in:** `VinkStatusBadge`'s `attention` tone (badge text),
`VinkInlineError`, `VinkAmountSummary`'s over-assignment figure/sentence,
`InputDecorationTheme.errorStyle` (field error text, previously inherited
`ColorScheme.error` = `danger`), and Guest Web's `StatusBadge.tsx`, `JoinForm.tsx`,
`SessionView.tsx`, and `app/g/[token]/page.tsx` (all four used bare `text-danger` on
explanatory error copy). None of these six additional sites were named in this document's
original P0-1 text — found by grepping for `VinkColors.danger`/`text-danger` across both
apps per I0's own "inspect the referenced source" instruction, and fixed under the same
semantic-role correction, not as separate scope creep.

**Final I0 evidence (preflight, 2026-07-20):** tool contrast suite
(`flutter test apps/mobile/test/design_system/contrast_test.dart`) — 10/10 passing.
Guest-web E9 Playwright suite (`API_BASE_URL=http://127.0.0.1:3055 npx playwright test
tests/e9.spec.ts`, run against an isolated API instance on port 3055, not the port an
unrelated concurrent session had bound on 3000) — 1/1 passing. Full mobile suite
(`flutter test`) — 54/54 passing; `flutter analyze` — 7 issues, all pre-existing `info`-level
(none in I0's touched files beyond the pre-existing `hasFlag` deprecations already present
before I0 began). A transient, unrelated failure (`lib/features/vink_lobby/vink_lobby_screen.dart`
— `humanErrorMessage` undefined) was observed mid-session in files already modified by a
separate, concurrent work session before I0 began (visible in `git status` at I0's own start)
— confirmed resolved by that other session's own subsequent edit (`flutter analyze
lib/features/vink_lobby/vink_lobby_screen.dart lib/core/errors/human_errors.dart` → "No
issues found!"), not by any I0 change. **Not an I0 defect — recorded here only for
traceability, not added to this register as an I0 item.**

**P0-2. Guest financial-state correctness (multiple compounding gaps).**
- `apps/guest-web/components/StatusBadge.tsx:5` renders literal `"Draft"` for guests — a
  state-name-hiding hard-rule violation, reachable because `inviteGuestCommand`
  (`packages/application/src/guest.ts:155`) allows guest add pre-open and
  `getPublicVinkView` (`guest.ts:201-212`) returns a summary for any state including `DRAFT`.
- `apps/guest-web/features/join/SessionView.tsx:46` — `hasAuthorized` is component-local
  state, reset on every reload; a guest who already paid is re-offered "Approve $X" after
  reloading mid-`OPEN`, violating D25's never-re-offer guarantee (the backend call is
  idempotent, so no double-charge occurs, but the UI actively misrepresents what's still
  needed).
- `SessionView.tsx:128-130` — every non-contributable state (completed, expired, cancelled,
  return-pending, returned, recovery-required) collapses into one identical sentence, "This
  Vink is no longer accepting contributions."
- **Root cause, all three:** `GuestVinkView`/`GuestParticipant`
  (`apps/guest-web/lib/types.ts:18-30`, `packages/application/src/guest.ts:214-227`) carries
  no viewer-specific payment-outcome field and no pre-open gate — this is a read-model gap
  (I1), not three separate UI bugs.

**P0-3. Progress-source correctness.**
Every progress bar in both apps — `apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart:272`,
`apps/mobile/lib/features/home/home_screen.dart:123`, `apps/guest-web/components/ProgressBar.tsx:13`
(fed from `SessionView.tsx:86-89`) — computes `fundedAmountMinor / requiredAmountMinor`.
`fundedAmountMinor` is written exactly once, atomically, only once every participant is
captured (`packages/application/src/contributions.ts:342-385`) — it cannot represent
incremental progress by construction, not by oversight. **Fix:** `contributionProgress` (I1),
never a client-side reinterpretation of `fundedAmountMinor`.

### P1 — real, lower blast-radius, fix in I0/I2/I3

**P1-1. Button loading width. — FIXED in I0 (2026-07-20).**
`vink_buttons.dart:57-66,105-110,155-160` swapped `Text` for a `CircularProgressIndicator`
with no reserved width and no cross-fade — confirmed via source read (Phase 9 §2), not
simulated. **Fix shipped:** a shared `_ButtonContent` widget (Phase 9 §7) used by all three
buttons — the label stays mounted (opacity-toggled, never removed) so it always reserves the
button's natural width; the spinner only mounts while loading and can't make the Stack
narrower. Verified by a widget test measuring rendered `Size` before/after `loading: true`
for all three button tiers (`accessibility_test.dart`).

**P1-2. Guest deadline parity.** `GuestVinkView`/`GuestSession` types already carry
`submissionDeadline` (`apps/guest-web/lib/types.ts:13`); zero references to it exist in
`JoinForm.tsx`/`SessionView.tsx` (confirmed by grep, Phase 3). Pure rendering gap, no backend
change needed.

**P1-3. Participant discovery.** `packages/application/src/queries.ts:137-139`'s
`listMyVinks` calls `listVinksByOrganizer` exclusively — confirmed by reading the function
body directly. A member added by username has **no in-app discovery path at all**, not even
passive (Phase 2's own earlier draft understated this before correction). No link is even
generated for a member-add today (only `inviteGuestCommand` mints a `joinUrl`).

### Additional defects found during this phase's own source audit

**P1-4. Guest Web has no human-error-message layer.** `JoinForm.tsx:91-96`,
`SessionView.tsx:111-116` render `error.message` directly; several backend
`ApplicationError` messages are internal debug strings not meant for users — one leaks a raw
internal Vink id (`packages/application/src/contributions.ts:134`). Mobile has an equivalent
layer (`core/errors/human_errors.dart`); Guest Web does not.

**P1-5. "No longer accepting new participants" misfires pre-open.** `isJoinable()`
(`packages/application/src/guest.ts:40-42`) requires `state === 'OPEN'`; a guest opening a
link while `DRAFT` sees "no longer" language implying a closure that never happened. Same
root cause as P0-2 (D23's pre-open gate), fixed by the same I1 work.

**P1-6. `RESTRICTED` Vinks are a navigational dead end.** `home_providers.dart:13` filters
`RESTRICTED` out of Home's active list entirely; `home_screen.dart:189` still defines a
`'RESTRICTED' => 'Needs attention'` label that can never render given that filter — dead
code, and a real dead end for an organizer whose Vink needs attention. Fixed by I2's
participant/organizer-inclusive, correctly-classified retrieval.

**Not classified as defects (explicitly, per instruction):** the absence of dark mode, the
absence of a support-response-time promise, the absence of card display in Guest Web, and the
absence of a fee model are **not** defects — none is required by any approved decision;
several (dark mode, fee, support SLAs) are explicitly excluded by D21/D25/Phase 8 §25.

---

## 3. Dependency graph

```
Database/persistence ──> Domain projections ──> API response contracts ──> Realtime events
        │                        │                        │
        │                        │                        ├──> Mobile UI
        │                        │                        └──> Guest Web UI
        │                        │
        │                        └──> Participant-inclusive queries ──> Mobile Home/Activity
        │
        └──> Contact-capture columns ──> Invitation delivery (external provider) ──> Delivery-state UI

Shared copy/state mapping ──> both UIs (must not diverge, §8)
Visual tokens ──> both UIs (independent of backend work, can proceed in parallel)
Motion ──> both UIs, depends on visual tokens landing first (needs components to attach to)
Accessibility ──> cross-cuts everything, front-loaded in I0, re-verified per slice
Tests ──> written alongside every slice, never a trailing phase
Feature flags ──> gate every slice with a client-visible change (§11)
```

**Work that can proceed independently, right now, in parallel:** I0 (accessibility/contrast
fixes — pure client-side), the visual-token/motion-token work underlying I7/I8/I10 (no
backend dependency), Guest Web's deadline rendering (P1-2, no backend dependency).

**Work that must land before client implementation:** I1 (read-model foundation) before any
of I3/I6/I7/I8 consume it; I2 (participant-inclusive retrieval) before I6; contact-capture
schema before I4.

**Work that may be built behind flags:** every slice from I1 onward that changes a
client-visible contract (§11) — new projections, the new Create flow, automatic delivery,
the new Guest Web state model, Ink Progress, in-place reauth, motion adoption.

**Work blocked by M0:** only the actual `[provider-supported payment method]` module content
inside I11 — nothing else in this plan is provider-blocked.

**Work blocked by counsel, support operations, or delivery-provider selection:** SMS/email
provider selection, sender identity, consent/carrier compliance language (I4, §4); any
support-response-time commitment (explicitly excluded, not planned); Terms/Privacy content
(D28, explicitly deferred).

---

## 4. Provider/legal/support dependency boundary

| Item | Blocked by | Status |
|---|---|---|
| `[provider-supported payment method]` module content | M0 gate (G1) | Genuinely unresolved — shell only is in scope (I11) |
| SMS/email delivery provider, credentials, sender identity | Provider selection (owner/ops decision, not M0) | Not started — I4 defines the pipeline shape, not the vendor |
| SMS carrier/consent/opt-out language | Legal review | Not started — marked external dependency in Phase 6 §29, unchanged here |
| Terms/Privacy/cardholder terms/refund policy | Legal counsel engagement (D28, ties to G2) | Explicitly deferred |
| Support response-time commitments | Operational staffing decision | Explicitly excluded from this plan |
| Support channel destination (email/address) | Deployment configuration | Not a code change — I4/I6's support-entry point reads a config value, never a hardcoded address (Phase 6 §21) |

None of these block I0–I3, I5–I10, or I11's shell. Only I11's payment-presentment content and
I4's actual send-provider integration (as opposed to its pipeline shape) are gated by
external decisions outside this plan's authority.

---

## 5. Canonical implementation sequence

The user's proposed I0–I11 ordering was validated against the real dependency graph (§3) and
**is retained as proposed, with one refinement**: I3 (Guest Web correctness) is confirmed to
depend on I1 only, not I2 (Guest Web has no Home/Activity equivalent, so participant-inclusive
retrieval is irrelevant to it) — this matches the user's own scoping already, stated here
explicitly since the prompt asked for validation, not blind acceptance. No other reordering,
split, or merge was found necessary — every proposed slice's scope maps to a coherent,
independently-testable unit of the real dependency graph.

| Slice | Depends on | Unlocks |
|---|---|---|
| I0 — Accessibility/shared-control corrections | none | Ships alone, immediately |
| I1 — Consumer read-model foundation | none (additive reads over existing tables) | I3, I6, I7, I8 |
| I2 — Participant-inclusive retrieval | none (additive reads) | I6 |
| I3 — Guest Web correctness | I1 | I8 |
| I4 — Contact capture and invitation delivery | none for the pipeline shape; external for the actual send | I5 (contact field integrated into participant entry) |
| I5 — Canonical Create flow | I4 (for contact-capture integration; may ship with "manual only" if I4's provider isn't ready) | — |
| I6 — Home, Activity, Vink Details | I1, I2 | — |
| I7 — Live Vink and Ink Progress | I1 | I10 |
| I8 — Guest Web visual/responsive convergence | I1, I3 | I10 |
| I9 — In-place reauthentication | none (client-only) | — |
| I10 — Cross-platform motion adoption | I7, I8 (needs the components motion attaches to) | — |
| I11 — Ready-to-Pay shell | none for the shell; M0 for the module | — |

---

## 6. Slice-by-slice engineering contracts

### I0 — Accessibility and shared-control corrections

- **User value:** destructive actions and loading buttons behave correctly and legibly for
  every user, including assistive-technology users, immediately.
- **Requirements satisfied:** D36, Phase 9 §2/§7 (P0-1, P1-1).
- **Current behavior:** `VinkDestructiveButton` renders `danger` text that fails AA (§2);
  button loading swaps resize the button.
- **Target behavior:** destructive controls use `text.primary`-tier styling pending a
  verified `dangerText`/fill candidate (Phase 8 §10); all three button tiers reserve label
  width and cross-fade into their loading state (Phase 9 §7).
- **Code areas:** `apps/mobile/lib/design_system/components/vink_buttons.dart`,
  `vink_status_badge.dart` (badge text color per Phase 8 §4's corrected `status.warning` row),
  `apps/guest-web`'s two buttons (`JoinForm.tsx:101`, `SessionView.tsx:122` — audit for the
  same class of issue even though their current color usage is `white`-on-`blue`, not
  `danger`, per Phase 9 §2's finding that Guest Web's own `danger` usage wasn't separately
  audited yet).
- **DB changes:** none. **Domain changes:** none. **API changes:** none. **Realtime
  changes:** none.
- **Flutter changes:** `VinkDestructiveButton`'s color logic, all three buttons' loading-state
  layout (reserved-width container + `AnimatedSwitcher`-equivalent cross-fade, respecting
  Phase 9's "no `AnimationController` sprawl" — a single shared implicit-animation widget is
  sufficient).
- **Guest Web changes:** contrast audit of existing button/text color usage; no visual
  change expected unless the audit finds a real fail.
- **Shared-token changes:** Phase 8 §4's `status.destructive.solid`/`status.dangerText`
  rows move from "proposed" to "verified" only once a real contrast tool confirms a
  candidate — this slice may ship with the interim `text.primary` treatment without waiting
  for that verification, per Phase 8 §10's own interim-default guidance.
- **Migration/compat strategy:** none needed — pure component-level visual fix, no data
  shape change.
- **Feature flags:** none — a correctness fix, not a new surface (matches governance's own
  distinction between yellow-flagged new work and plain bug fixes).
- **Observability:** none new.
- **Security/privacy:** none.
- **Accessibility:** this slice **is** the accessibility work — verified via automated
  contrast tooling (§14), not hand calculation.
- **Unit tests:** button-width-delta test (render loading vs. non-loading, assert layout
  width unchanged). **Integration tests:** n/a. **Contract tests:** n/a. **Flutter widget
  tests:** `VinkDestructiveButton` renders with the corrected color role; loading-state
  golden/width test for all three button tiers. **Guest Web component tests:** contrast
  assertion on the two audited buttons. **E2E tests:** n/a (component-level fix).
- **Regression risks:** low — visual-only change to widely-used shared components; verify no
  screen assumed the old (broken) sizing behavior anywhere.
- **Rollback approach:** revert the component change; no data/contract implications.
- **Entry criteria:** Phase 8/9 documents approved (already true).
- **Acceptance criteria:** automated contrast tool confirms the shipped destructive-button
  treatment passes AA at its actual rendered size; button width is provably stable across
  loading transitions.
- **Exit gate:** contrast tool report attached to the PR; widget tests green.
- **Dependencies:** none.
- **Work explicitly excluded:** the `dangerText`/darker-fill *token itself* is not finalized
  in this slice if tool verification isn't yet available — the interim `text.primary`
  treatment is an acceptable, shippable stopping point.

### I1 — Consumer read-model foundation

- **User value:** every later slice (progress, guest safety, deadlines) becomes buildable on
  real data instead of an approximation.
- **Requirements satisfied:** D20, D23, D24, D25 (P0-2, P0-3, P1-2's backend prerequisite —
  though P1-2 itself needs no backend change, its data source `submissionDeadline` is
  confirmed already present).
- **Current behavior:** clients read `fundedAmountMinor` (jumps 0→100%) and no viewer-scoped
  guest status exists; pre-open Vinks return full summaries to any guest.
- **Target behavior:** a `contributionProgress` projection and a guest `contributionStatus`
  field exist on the relevant API responses; `getPublicVinkView` gates on `DRAFT`.
- **Code areas:** `packages/application/src/queries.ts` (new read, likely alongside/replacing
  `listContributionsByVink`), `packages/application/src/guest.ts` (`GuestVinkView`,
  `getPublicVinkView`), `apps/api` routes serving the organizer snapshot and the guest view.
- **DB changes:** **none required** — every input (`participants.allocatedAmount`,
  `contributions.status`) already exists; this is a derived read, not new storage.
- **Domain changes:** **none** — `packages/domain`'s state machines are untouched; this is
  an application-layer read composing existing domain facts.
- **API changes:** additive fields on existing response shapes (§7) — `contributionProgress`
  object added to the organizer Vink snapshot and the guest view; `contributionStatus`
  string added to the guest view only; the pre-open guest response shape gains an explicit
  `notOpenYet` variant (§7).
- **Realtime changes:** the existing outbox-driven snapshot push (PV8/PV8.5) needs no new
  event type — it already pushes on every relevant state/contribution transition; the
  *payload* it pushes gains the new fields, same delivery mechanism.
- **Flutter changes:** none in this slice (consumption happens in I7).
- **Guest Web changes:** none in this slice (consumption happens in I3).
- **Shared-token changes:** none.
- **Migration/compat strategy:** purely additive fields — existing clients ignoring the new
  fields continue to work unmodified; `fundedAmountMinor` stays present and correct
  throughout (not removed until every consumer has migrated, tracked as I7/I8's own exit
  gate, not this slice's).
- **Feature flags:** `contribution_progress_projection` (default off outside
  development/test; §11).
- **Observability:** none new beyond existing request logging.
- **Security/privacy:** the guest `contributionStatus` field must be verified, by test, to
  never expose another participant's data — this is the single most important privacy
  property in this slice.
- **Accessibility:** n/a (backend-only slice).
- **Unit tests:** `contributionProgress` computation across equal/custom splits, zero/
  partial/full progress, organizer-as-participant. **Integration tests:** real-PG contract
  tests per Vink/contribution state combination (§12). **Contract tests:** the guest
  pre-open response shape; the guest `contributionStatus` privacy boundary. **Flutter widget
  tests:** n/a. **Guest Web component tests:** n/a. **E2E tests:** n/a (no client changes
  yet).
- **Regression risks:** low — additive; the real risk is an incorrect "confirmed" threshold
  (must be `AUTHORIZED`-or-later per D24, not `CAPTURED`-or-later) — covered by the state-
  combination test matrix (§12).
- **Rollback approach:** feature-flag off; additive fields simply go unused.
- **Entry criteria:** D24/D25 approved (already true).
- **Acceptance criteria:** contract tests green across every state combination in §12's
  backend matrix; privacy-boundary test proves no cross-participant leak.
- **Exit gate:** flag can be enabled in `test`/`development` with green contract-test suite.
- **Dependencies:** none.
- **Work explicitly excluded:** no client consumes this yet — that's I3/I7/I8. No change to
  `fundedAmountMinor`'s own semantics or the D5 resolver.

### I2 — Participant-inclusive retrieval

- **User value:** a member can actually find a Vink they didn't organize, in-app, without
  relying on a one-time link.
- **Requirements satisfied:** Phase 3 §1 (P1-3, P1-6).
- **Current behavior:** `listMyVinks` → `listVinksByOrganizer` only; `RESTRICTED` filtered
  from Home with no path back.
- **Target behavior:** Home/Activity list the union of organizer-owned and
  participant-in Vinks, deduplicated when both apply, correctly classified (active vs.
  historical, including `RESTRICTED` as "needs attention").
- **Code areas:** `packages/application/src/ports.ts` (`listVinksByOrganizer` gains a sibling
  or is superseded by a role-aware query), `queries.ts`, `apps/api/src/modules/vinks/routes.ts`,
  `apps/mobile/lib/features/home/home_providers.dart`, `activity_providers.dart`.
- **DB changes:** **likely none** — a participant-inclusive query is a `JOIN`/`UNION` over
  existing `vinks`/`participants` tables, not new storage; confirm at implementation time
  whether an index is warranted for the new query shape (a genuine implementation detail,
  not decided here).
- **Domain changes:** none.
- **API changes:** `GET /api/v1/vinks` (and the Activity-equivalent) response gains a
  `role: 'organizer' | 'participant'` field per entry (§7); response otherwise
  backward-compatible in shape.
- **Realtime changes:** none required — this is a list-fetch change, not a live-push change.
- **Flutter changes:** Home/Activity providers consume the new query; the "needs attention"/
  "waiting on others" grouping (Phase 3 §1) is built from the `role` field plus existing
  state.
- **Guest Web changes:** none (no Home/Activity surface exists there).
- **Shared-token changes:** none.
- **Migration/compat strategy:** additive query, additive response field; existing organizer-
  only behavior is a strict subset of the new result set, so no data migration needed.
- **Feature flags:** `participant_inclusive_retrieval` (default off; §11).
- **Observability:** none new.
- **Security/privacy:** verify a participant only ever sees their own role-appropriate view
  of a Vink they're part of (matches Phase 0 §2 — members already see full detail, unlike
  guests, so this is a straightforward extension, not a new privacy boundary).
- **Accessibility:** Home/Activity's existing accessible-label patterns (Phase 4 §4/§10)
  extend to the new `role`-aware grouping without new rules.
- **Unit tests:** union/dedup logic (an organizer who is also a participant appears once).
  **Integration tests:** real-PG contract test for the combined query. **Contract tests:**
  response shape including `role`. **Flutter widget tests:** Home's two-section grouping
  renders correctly from mixed-role data. **Guest Web component tests:** n/a. **E2E tests:**
  a member added by username can navigate to their Vink from Home (this is the actual bug
  P1-3 describes — the E2E test for this slice is the direct regression test for that bug).
- **Regression risks:** low — additive; verify existing organizer-only queries used
  elsewhere (e.g. Activity's `/activity` endpoint) aren't accidentally narrowed.
- **Rollback approach:** flag off, reverts to organizer-only retrieval.
- **Entry criteria:** none beyond Phase 3 approval (already true).
- **Acceptance criteria:** a member's own Vinks appear on their Home/Activity without any
  link; `RESTRICTED` Vinks are reachable from Home again.
- **Exit gate:** E2E regression test for P1-3/P1-6 green.
- **Dependencies:** none.
- **Work explicitly excluded:** **no invitation inbox** (explicit instruction) — this slice
  is a retrieval-query change, not a new notification surface.

### I3 — Guest Web correctness before visual redesign

- **User value:** a guest can trust what the screen tells them about their own money, every
  time, including on reload.
- **Requirements satisfied:** D23, D24, D25, D34 (P0-2, P1-2, P1-4, P1-5).
- **Current behavior:** raw `DRAFT` exposure, reload-resets `hasAuthorized`, one flat
  terminal message, no deadline, raw error strings, misfiring "no longer accepting" copy.
- **Target behavior:** the D23 pre-open state, server-resolved `contributionStatus` driving
  the contribution action and terminal messaging, the deadline rendered, a human-error-
  message layer, D34's exact phrases.
- **Code areas:** `apps/guest-web/features/join/{JoinExperience,JoinForm,SessionView}.tsx`,
  `components/StatusBadge.tsx`, new `lib/human-errors.ts` (mirroring
  `apps/mobile/lib/core/errors/human_errors.dart`'s pattern).
- **DB changes:** none (consumes I1). **Domain changes:** none. **API changes:** none new in
  this slice beyond consuming I1's additions. **Realtime changes:** none new.
- **Flutter changes:** none in this slice.
- **Guest Web changes:** the bulk of this slice — six terminal compositions (Phase 8 §22),
  the D23 not-open-yet state, deadline rendering, error-message mapping.
- **Shared-token changes:** none yet (I8 handles visual convergence; this slice is
  correctness-first, per its own name).
- **Migration/compat strategy:** n/a — client-only change consuming already-additive I1
  fields.
- **Feature flags:** `guest_contribution_status_ui` (default off; §11), gated on I1's
  `contribution_progress_projection` flag also being on.
- **Observability:** `terminal_money_outcome_rendered{category}` (§16).
- **Security/privacy:** verify the guest never receives another participant's data via the
  new fields (re-verifies I1's own guarantee at the client-integration level).
- **Accessibility:** the outcome sentence is the primary announced content on arrival (Phase
  4 §9); D25's six states each get distinct, correctly-announced copy.
- **Unit tests:** copy-mapping function (state → exact D25/D34 phrase). **Integration
  tests:** n/a (Guest Web has no integration-test layer of its own beyond Playwright).
  **Contract tests:** n/a (covered by I1). **Flutter widget tests:** n/a. **Guest Web
  component tests:** each terminal composition renders the correct phrase for its category.
  **E2E tests:** Playwright — reload after confirming never re-offers the action (the direct
  regression test for the P0-2 defect); all six terminal states reachable and distinct;
  pre-open link shows "not open yet," never "Draft."
- **Regression risks:** medium — this touches the guest's core money-trust surface; the
  existing `e9.spec.ts` Playwright suite must be extended, not replaced, so prior coverage
  isn't silently dropped.
- **Rollback approach:** flag off reverts to the current flat-message behavior (a real
  regression, but a known, already-shipped one — not a new risk introduced by rolling back).
- **Entry criteria:** I1 shipped and flagged on in `test`.
- **Acceptance criteria:** `e9.spec.ts` extended and green for all six outcomes plus the
  reload-safety case; contrast/copy match Phase 6/8 exactly.
- **Exit gate:** Playwright suite green, human-error layer covers every `ApplicationError`
  code reachable from Guest Web.
- **Dependencies:** I1.
- **Work explicitly excluded:** visual/spacing convergence with the mobile design system
  (that's I8) — this slice may ship with today's existing Guest Web visual treatment, only
  the *correctness* of what's shown changes.

### I4 — Contact capture and invitation delivery

- **User value:** organizers stop being the sole delivery mechanism for every invitation.
- **Requirements satisfied:** D19, D27 (traceability row 1/2).
- **Current behavior:** no contact field exists anywhere; manual share is the only path.
- **Target behavior:** Register/Profile/Add-Participant capture a contact destination
  separate from display name; automatic delivery fires at `VINK_OPENED`; manual sharing
  remains a first-class fallback in one owned sheet.
- **Code areas:** `apps/api/src/modules/auth/*` (contact column), a new migration, a new
  delivery module (provider-agnostic interface, mirroring the `FinancialProvider` abstraction
  pattern already used for payments — **not** importing a specific SMS/email SDK outside an
  approved adapter directory, matching the provider-import guard's own discipline extended
  to a second external-service boundary), `apps/mobile` Register/Profile/Add-Participant.
- **DB changes:** new nullable `contact_destination`/`contact_method` columns on `users` (and
  wherever guest identity capture lives) — an additive migration, no backfill required (null
  = "no automatic delivery possible yet, manual only").
- **Domain changes:** none — delivery is an infrastructure concern, not a domain state.
- **API changes:** `POST /auth/register`, `PATCH /profile` (or equivalent) gain optional
  contact fields; `POST /vinks/:id/participants` gains a `deliveryChoice` field.
- **Realtime changes:** delivery-status changes push through the existing realtime channel
  as part of the participant's row data (no new event *type*, an additional field on the
  existing participant-update payload).
- **Flutter changes:** Register/Profile new fields; Add-Participant sheet's delivery-choice
  control (Phase 4 §5b, Phase 5 §8).
- **Guest Web changes:** none.
- **Shared-token changes:** none.
- **Migration/compat strategy:** nullable columns, fully backward-compatible; a user with no
  contact info captured simply can't be auto-delivered to yet — falls back to manual, never
  errors.
- **Feature flags:** `automatic_invitation_delivery` (default off, blocked from `staging`/
  `production` until a provider is actually selected — matches governance's own "never
  enabled in an environment its row does not list" rule; §11).
- **Observability:** `invitation_send_accepted`, `invitation_delivery_failed{reason}` (§16 —
  no phone/email logged, per the observability boundary).
- **Security/privacy:** contact info at rest (encryption-at-rest is an infrastructure
  question, not decided here); resend-abuse throttling (Phase 5 C18's cooldown, server-side
  enforced per §15's security review); invitation enumeration risk (a guest link must not be
  guessable/enumerable — already true today via the existing 32-byte token, unaffected by
  this slice).
- **Accessibility:** standard form-field accessibility (Phase 8 §11/§24), no new pattern.
- **Unit tests:** delivery-choice validation, contact-format validation. **Integration
  tests:** dispatch-after-`VINK_OPENED` ordering (never before), partial-failure handling
  (one participant's delivery failing never blocks or misrepresents the Vink's own open
  status — direct test of the locked rule in Phase 5 §2). **Contract tests:** delivery-
  status field shape. **Flutter widget tests:** delivery-choice control, contact-field
  validation. **Guest Web component tests:** n/a. **E2E tests:** end-to-end dispatch against
  a test/mock delivery adapter (never a real SMS/email provider in CI).
- **Regression risks:** medium — touches Register/Profile, well-established screens; the
  delivery module itself is new and isolated, lower risk.
- **Rollback approach:** flag off reverts to manual-only, the exact current behavior — zero
  risk of stranding a Vink without any delivery path.
- **Entry criteria:** a delivery provider is selected (external dependency, §4) **for the
  actual send integration**; the pipeline shape/contact-capture/UI work can proceed and merge
  behind the flag before that selection, using a mock adapter in tests.
- **Acceptance criteria:** a guest/member with contact info captured receives a dispatch
  attempt at `VINK_OPENED`, never earlier; failure never blocks Vink opening.
- **Exit gate:** contract tests green against the mock adapter; real-provider integration
  tracked as a separate, later swap-in once selected (this slice's exit gate does not require
  a real provider).
- **Dependencies:** none blocking the pipeline shape; the real send integration is externally
  blocked (§4).
- **Work explicitly excluded:** carrier/consent/regulatory copy (external, §4); contacts
  sync (explicitly excluded); any delivery-guarantee claim in copy or behavior.

### I5 — Canonical Create flow

- **User value:** creating a Vink takes two screens and a confirmation, not five pages.
- **Requirements satisfied:** D30.
- **Current behavior:** five-step wizard, standalone Review screen.
- **Target behavior:** Purpose+Total, People+Split, transient Open Vink confirmation sheet
  (Phase 4 §5).
- **Code areas:** `apps/mobile/lib/features/create_vink/*` — substantial restructure of an
  existing, well-tested feature area.
- **DB changes:** none. **Domain changes:** none. **API changes:** none — the same
  `createVinkCommand`/`setSplitCommand`/`VINK_OPENED` commands are called, just from a
  different screen sequence; **the idempotent Vink-creation guarantee already covered by
  existing tests must be preserved exactly**, not re-implemented. **Realtime changes:** none.
- **Flutter changes:** the entire slice — merge Purpose+Total into one screen, merge
  Add-people+Split into one screen, convert Review into the transient confirmation sheet
  (Phase 5 C5–C15).
- **Guest Web changes:** none. **Shared-token changes:** none (visual tokens from Phase 8
  apply, no new tokens).
- **Migration/compat strategy:** n/a — no data shape change, pure UI restructure.
- **Feature flags:** `canonical_create_flow` (default off; §11) — **this flag must gate the
  entire screen sequence as one unit**, never a half-migrated hybrid (e.g. never ship the
  merged Purpose+Total screen while Split remains a separate step) — an explicit rollout
  rule, not left implicit.
- **Observability:** `vink_open_attempted`/`vink_opened`/`vink_open_failed` (already
  specified, Phase 5 C15) — reused, not reinvented.
- **Security/privacy:** none new — same commands, same idempotency guarantees.
- **Accessibility:** step-progress announcement changes from "Step N of 5" to "Step N of 2"
  (Phase 4 §5) — a copy change, not a new accessibility requirement.
- **Unit tests:** n/a (widget-level feature). **Integration tests:** existing PV3/PV13
  integration coverage for Vink creation/opening must stay green, unmodified in its
  assertions about backend behavior. **Contract tests:** n/a (no API change). **Flutter
  widget tests:** exact-split validation (Custom must reconcile exactly), automatic organizer
  inclusion, back-navigation data preservation (Phase 5 §12), duplicate-tap prevention on
  "Open Vink" (Phase 5 C15). **Guest Web component tests:** n/a. **E2E tests:**
  `integration_test/e1_test.dart`'s existing full-journey coverage must be updated to the new
  flow, not duplicated as a second parallel suite.
- **Regression risks:** **high, relative to other slices** — this is the most-tested existing
  screen area (Phase 13's own milestone report cites four defects caught by its first E2E
  run); the exact idempotency/split-validation guarantees must transfer, not be
  reimplemented from scratch, and every existing test asserting on the old five-step flow's
  own structure needs deliberate migration, not silent breakage.
- **Rollback approach:** flag off reverts to the five-step wizard, which remains in the
  codebase (not deleted) until this slice's flag is fully rolled out and the old flow is
  formally retired in a later, separate cleanup — **the old flow is not deleted as part of
  this slice**.
- **Entry criteria:** I4's contact-capture UI exists (for the People+Split screen's delivery-
  choice control) — may ship with manual-only if I4's automatic path isn't ready yet, per I4's
  own fallback guarantee.
- **Acceptance criteria:** `e1_test.dart` passes end-to-end against the new flow; split/
  idempotency guarantees provably unchanged.
- **Exit gate:** old and new flows both pass their respective test suites while the flag is
  in rollout; old flow formally retired only after full rollout, in a follow-up slice not
  defined here.
- **Dependencies:** I4 (soft — for delivery-choice integration only).
- **Work explicitly excluded:** deleting the five-step wizard's code (a later cleanup, not
  this slice); any change to split math, category policy, or idempotency semantics.

### I6 — Home, Activity, and Vink Details

- **User value:** Home tells an organizer/member what needs attention; Activity has real
  history; Vink Details answers "what happened to my money" without contacting support.
- **Requirements satisfied:** Phase 3 §1/§4, D29, D31.
- **Current behavior:** flat lists, non-interactive Activity, no detail view.
- **Target behavior:** Phase 3 §1's two-section Home, Phase 8 §22's compositions, a new Vink
  Details screen (never "Receipt").
- **Code areas:** `apps/mobile/lib/features/home/*`, `features/activity/*`, new
  `features/vink_details/*`.
- **DB changes:** none beyond I2's. **Domain changes:** none. **API changes:** possibly a
  small additive read if today's `/activity` response doesn't carry everything Vink Details
  needs (an implementation-time determination, not decided here — flagged, not assumed).
  **Realtime changes:** none new.
- **Flutter changes:** the bulk of this slice.
- **Guest Web changes:** none. **Shared-token changes:** none (consumes Phase 8's existing
  tokens).
- **Migration/compat strategy:** n/a.
- **Feature flags:** `home_activity_v2` (default off; §11), depends on I1/I2's flags also
  being on.
- **Observability:** `activity_row_opened{vinkId}`, `vink_details_opened{vinkId}` (Phase 5
  C33/C34).
- **Security/privacy:** Vink Details' organizer/participant view shows full detail (matches
  Phase 0 §2 — not a new privacy boundary, an extension of the existing one).
- **Accessibility:** per-card/per-row accessible labels (Phase 4 §4/§10).
- **Unit tests:** Home's needs-attention/waiting-on-others classification logic.
  **Integration tests:** n/a beyond I1/I2's own. **Contract tests:** n/a unless the small
  additive read above proves necessary. **Flutter widget tests:** compact vessel rendering
  (depends on I7 or ships with the old linear bar if I7 hasn't landed yet — an explicit
  sequencing choice, not an oversight), Vink Details never renders "Receipt" anywhere
  (a direct regression test for D31). **Guest Web component tests:** n/a. **E2E tests:**
  `RESTRICTED` Vink reachable from Home (P1-6 regression test).
- **Regression risks:** low-medium — mostly new screens; Home/Activity's existing data
  providers are being replaced, so existing tests referencing the old organizer-only
  behavior need updating.
- **Rollback approach:** flag off reverts to today's Home/Activity.
- **Entry criteria:** I1, I2 shipped and flagged on in `test`.
- **Acceptance criteria:** Vink Details never uses receipt language (grep-able regression
  test); Home correctly classifies `RESTRICTED`.
- **Exit gate:** widget tests green, `RESTRICTED` regression test green.
- **Dependencies:** I1, I2.
- **Work explicitly excluded:** the compact Ink vessel's actual data source is I7's — this
  slice may ship against the old linear bar temporarily if sequenced before I7, explicitly
  noted as acceptable per §5's dependency graph (I6 depends on I1/I2, not I7).

### I7 — Live Vink and Ink Progress

- **User value:** the Lobby shows real, incremental progress instead of a bar that jumps from
  0% to 100%.
- **Requirements satisfied:** D20, D24, Phase 8 §15, Phase 9 §10.
- **Current behavior:** linear `VinkProgressIndicator`, `fundedAmountMinor`-driven.
- **Target behavior:** the Ink vessel, `contributionProgress`-driven, per Phase 8/9 in full.
- **Code areas:** `apps/mobile/lib/features/vink_lobby/*`, new
  `design_system/components/vink_progress_vessel.dart`.
- **DB/domain/API/realtime changes:** none beyond I1's (this slice is pure consumption).
- **Flutter changes:** the vessel component (primary + compact variants), participant-row
  consolidation (Phase 1 §F.1's fix — the duplicate "Your share" card removed, per Phase 8
  §13/§27), invite-control reframing (manual as fallback, per D19 — pending I4 for the
  automatic path; may ship with "Share manually instead" as the only visible option until I4
  lands, which is honest per Phase 2 §E, not a regression).
- **Guest Web changes:** none (that's I8). **Shared-token changes:** none new (Phase 8's
  tokens already define the vessel).
- **Migration/compat strategy:** n/a.
- **Feature flags:** `ink_progress_vessel` (default off; §11), depends on I1's flag.
- **Observability:** none new beyond what I1 already defines.
- **Security/privacy:** none new.
- **Accessibility:** Phase 8 §0/§15/Phase 9 §10's exact screen-reader pattern, decoupled from
  the decorative animation (Phase 9 §10's core lock).
- **Unit tests:** vessel-level computation from `contributionProgress` (fraction, waiting-
  clause name/count logic, Phase 6 §12/Phase 8 §27's refined 1/2/3+ rule). **Integration
  tests:** n/a (client-only slice). **Contract tests:** n/a (I1's). **Flutter widget tests:**
  every state in Phase 8 §15's table (empty/partial/near-complete/complete/reduced-motion);
  the "never animates a processing contribution as confirmed" lock rule, directly tested.
  **Guest Web component tests:** n/a. **E2E tests:** a real multi-participant Vink's Lobby
  shows the vessel rising per-contribution, not jumping at the end (the direct regression
  test for P0-3).
- **Regression risks:** medium — visible on the highest-traffic screen in the app; the
  consolidation of the duplicate "Your share" card touches existing, tested layout.
- **Rollback approach:** flag off reverts to the linear bar (still present, not deleted,
  same pattern as I5).
- **Entry criteria:** I1 shipped and flagged on in `test`.
- **Acceptance criteria:** vessel never fills for a `pending`/processing contribution; matches
  Phase 8 §15's full state table.
- **Exit gate:** widget tests green across every state; E2E regression test for P0-3 green.
- **Dependencies:** I1.
- **Work explicitly excluded:** no change to `packages/domain`'s contribution state machine
  or the D5 resolver; no linear bar removal from the codebase until this slice's flag is
  fully rolled out (parallel-available, same pattern as I5's old flow).

### I8 — Guest Web visual and responsive convergence

- **User value:** Guest Web looks and feels like a deliberately-designed web experience, on
  the same design language as the app, not a generic web form.
- **Requirements satisfied:** Phase 8 §6/§7/§23, Phase 9 §18.
- **Current behavior:** ad hoc Tailwind defaults, the old `ProgressBar.tsx`, repeated centered
  cards (per Phase 8's own audit).
- **Target behavior:** the shared spacing/radius scale, the vessel's guest variant, Phase 8
  §23's responsive breakpoint system.
- **Code areas:** `apps/guest-web/app/globals.css`, all `features/join/*` components,
  `components/ProgressBar.tsx` → replaced by a new vessel component.
- **DB/domain/API/realtime changes:** none beyond I1/I3's.
- **Flutter changes:** none. **Guest Web changes:** the bulk of this slice.
- **Shared-token changes:** new CSS custom properties mirroring `vink_spacing.dart`/
  `vink_radius.dart` exactly (Phase 8 §6/§7) — the first time these are formalized for this
  platform.
- **Migration/compat strategy:** n/a (visual-only).
- **Feature flags:** `guest_web_visual_v2` (default off; §11), depends on I1/I3's flags.
- **Observability:** none new.
- **Security/privacy:** none new.
- **Accessibility:** Phase 8 §23/§24's keyboard-navigation and responsive-text requirements;
  hover-lift addition is decorative-only per Phase 9 §18/§23 (omitted entirely under reduced
  motion, never load-bearing).
- **Unit tests:** n/a. **Integration tests:** n/a. **Contract tests:** n/a. **Flutter widget
  tests:** n/a. **Guest Web component tests:** the vessel's guest (aggregate-only) variant;
  responsive breakpoint rendering at each of Phase 8 §23's five ranges. **E2E tests:**
  Playwright viewport tests across narrow-mobile through very-wide-desktop; keyboard-only
  navigation of the fallback sheet's equivalent (invitation delivery is organizer-side, but
  any Guest Web interactive element — the "Approve $X" flow — gets a keyboard-only pass).
- **Regression risks:** low-medium — the existing `e9.spec.ts`/`screenshots.spec.ts` suites
  need updating to the new visual layer, not silently invalidated.
- **Rollback approach:** flag off reverts to today's Guest Web visual treatment (I3's
  correctness fixes remain in effect either way, since they're a separate flag).
- **Entry criteria:** I1, I3 shipped and flagged on in `test`.
- **Acceptance criteria:** matches Phase 8 §22's Guest Web compositions and §23's responsive
  system; no repeated centered white cards remain (a direct regression test against Phase 8
  §27's removal list).
- **Exit gate:** Playwright visual/responsive suite green across all five breakpoints.
- **Dependencies:** I1, I3.
- **Work explicitly excluded:** dark mode (explicitly deferred, Phase 8 §25); any change to
  Guest Web's actual data/correctness behavior (that's I3's, already shipped by this point).

### I9 — In-place reauthentication

- **User value:** a dead session never costs an organizer their half-finished work.
- **Requirements satisfied:** D26.
- **Current behavior:** `isAuthError` defined, unconsumed; a mid-session 401 hits generic
  per-screen error handling.
- **Target behavior:** Phase 4 §14/Phase 5 §20/Phase 9 §21 in full — silent refresh first (the
  existing single-retry behavior, unchanged), an in-context overlay only when that genuinely
  fails, state preservation, post-auth refetch, no action replay.
- **Code areas:** `apps/mobile/lib/core/networking/api_client.dart`,
  `core/auth/auth_controller.dart`, new global-listener plumbing, Create-flow and Lobby state
  preservation.
- **DB/domain/API/realtime changes:** none — client-only.
- **Flutter changes:** the entire slice.
- **Guest Web changes:** none (Guest Web's own token-expiry gap — silent fallback to the join
  form, Phase 2 §3 — is a separate, smaller, already-identified item folded into I3's error-
  layer work, not this slice).
- **Shared-token changes:** the reauth sheet uses Phase 8 §14's existing sheet system, no new
  tokens.
- **Migration/compat strategy:** n/a.
- **Feature flags:** `in_place_reauth` (default off; §11).
- **Observability:** `reauthentication_required`, `reauthentication_restored` (§16).
- **Security/privacy:** **explicit security review required** (per instruction) — verify the
  reauth sheet cannot be used to phish a credential re-entry in a way indistinguishable from
  a malicious overlay (mitigated by it being an in-app-rendered, non-navigable overlay, not a
  webview); verify no token is logged; verify the underlying screen is genuinely
  non-interactive (not just visually dimmed) while the overlay is present, so a stale
  pre-auth tap can't queue up and fire post-auth.
- **Accessibility:** focus management into/out of the overlay (Phase 4 §14, Phase 9 §21).
- **Unit tests:** the global 401-listener's trigger logic (fires only after the existing
  single silent refresh fails). **Integration tests:** n/a. **Contract tests:** n/a.
  **Flutter widget tests:** Create-flow state survives the overlay (direct D26 regression
  test); Lobby state refetches fresh rather than resuming a stale snapshot; **the specific
  action that hit the 401 is never automatically replayed** (the single most safety-critical
  test in this slice). **Guest Web component tests:** n/a. **E2E tests:** simulate an expired
  refresh token mid-Create-flow and mid-Lobby, verify recovery in both.
- **Regression risks:** medium — touches app-wide networking, must not introduce a scenario
  where a legitimate action *appears* to fail when it actually succeeded server-side (the
  "never replay" rule must not become "never confirm," which would be its own new bug).
- **Rollback approach:** flag off reverts to today's per-screen generic error handling (a
  known gap, not a new risk).
- **Entry criteria:** none beyond Phase 4/5/9's approval (already true).
- **Acceptance criteria:** the three widget-test scenarios above all green; security review
  sign-off obtained.
- **Exit gate:** security review complete and documented.
- **Dependencies:** none.
- **Work explicitly excluded:** Guest Web's own session-expiry UX (folded into I3); any
  change to the token-issuance/refresh mechanism itself on the backend (D26 is a client-side
  recovery pattern around the existing mechanism, not a new auth design).

### I10 — Cross-platform motion and state-feedback adoption

- **User value:** state changes are visually legible and calm across both platforms,
  consistently.
- **Requirements satisfied:** Phase 9 in full (§3–§21), for everything not already covered by
  I0's narrow fixes.
- **Current behavior:** almost no motion exists anywhere (Phase 9 §2's audit); the few
  transitions that exist use inconsistent, unaudited durations.
- **Target behavior:** Phase 9's five duration tokens, small easing set, and per-moment specs
  applied across both platforms.
- **Code areas:** shared motion-token definitions (new `design_system/vink_motion.dart`
  mirroring `vink_spacing.dart`'s own pattern; a Guest Web CSS custom-property equivalent),
  every component touched by I5–I9's own work (participant rows, buttons, sheets, the
  vessel).
- **DB/domain/API/realtime changes:** none.
- **Flutter changes:** motion applied to rows/sheets/buttons/vessel (already built by I0/I5–
  I9; this slice adds the *timing*, not new components). **Guest Web changes:** same,
  including the hover-lift addition (Phase 9 §18).
- **Shared-token changes:** the motion-token system itself, net new.
- **Migration/compat strategy:** n/a.
- **Feature flags:** `motion_system_v1` (default off; §11) — **and a separate, orthogonal
  reduced-motion respect that is never behind a flag** — reduced-motion support ships
  unconditionally wherever motion exists, per Phase 9 §1.6/§23's own framing as a hard
  requirement, not an optional enhancement.
- **Observability:** none new.
- **Security/privacy:** none.
- **Accessibility:** this slice **is** largely accessibility work — Phase 9 §23's full
  reduced-motion matrix, verified per item.
- **Unit tests:** n/a. **Integration tests:** n/a. **Contract tests:** n/a. **Flutter widget
  tests:** reduced-motion variants render the correct static end-state for every item in
  Phase 9 §23's matrix. **Guest Web component tests:** same, via `prefers-reduced-motion`
  media-query testing. **E2E tests:** a full journey run with the OS/browser reduced-motion
  setting on, asserting no information is lost (Phase 9 §1.6's core guarantee, tested
  directly).
- **Regression risks:** low — additive timing/motion on top of already-shipped components
  from earlier slices; the main risk is scope creep into new decorative motion not specified
  in Phase 9 (explicitly guarded against by Phase 9 §30's own dependency list).
- **Rollback approach:** flag off reverts to instant/no-transition state changes (never a
  broken state, just an undecorated one) — reduced-motion behavior remains available
  regardless of the flag, since it's the same code path as "flag off" in most cases.
- **Entry criteria:** I5–I9 substantially landed (motion attaches to components those slices
  build).
- **Acceptance criteria:** Phase 9 §23's reduced-motion matrix fully covered by tests.
- **Exit gate:** reduced-motion E2E run green on both platforms.
- **Dependencies:** I7, I8 (per §5's graph).
- **Work explicitly excluded:** haptics beyond Phase 9 §22's exact list; any new duration/
  easing token beyond Phase 9 §3/§4's five-token, small-easing-set system.

### I11 — Ready-to-Pay provider-independent shell

- **User value:** the organizer sees a calm, honest "ready to pay" moment, with no false
  promise about how payment actually completes.
- **Requirements satisfied:** D32, D35, Phase 8 §19, Phase 9 §16.
- **Current behavior:** the temporary card's last-four/limit display passively, inline in the
  Lobby, no deliberate-tap gate.
- **Target behavior:** the "Ready to pay" heading (automatic on `CARD_READY`), the deliberate
  "Pay now" tap, a bounded, unstyled `[provider-supported payment method]` region.
- **Code areas:** `apps/mobile/lib/features/vink_lobby/*` (or a new pushed screen, per Phase 4
  §4's contract), new shell component.
- **DB/domain/API/realtime changes:** none — this slice consumes existing `CARD_READY`/card
  data, unchanged.
- **Flutter changes:** the shell (heading, amount, safe last-four/limit summary, deliberate-
  tap gate, the bounded neutral module).
- **Guest Web changes:** none (guests never see the card, unresolved scope question per
  Phase 3 §3/§6, not decided by this slice either).
- **Shared-token changes:** none new (Phase 8 §19 already specifies the shell's tokens).
- **Migration/compat strategy:** n/a.
- **Feature flags:** `ready_to_pay_shell` (default off; §11) — **the bounded module itself
  carries no flag of its own, because it renders nothing** (there is no content to gate).
- **Observability:** `pay_now_entered` (Phase 5 C31, reused).
- **Security/privacy:** the shell must not display anything beyond the already-approved
  safe-summary fields (last-four, spending limit) — **no PAN/CVV, no wallet integration, no
  copy-number control** is implemented in this slice, by explicit instruction; this is a
  security boundary as much as a scope one.
- **Accessibility:** "Ready to pay — $X available" announced on entry (Phase 8 §19/Phase 9
  §16).
- **Unit tests:** n/a. **Integration tests:** n/a. **Contract tests:** n/a. **Flutter widget
  tests:** the deliberate-tap gate (module never appears without the tap); the module renders
  as a bounded, visibly neutral/unstyled region — a direct test that it "must not visually
  appear complete or approved" (D32's own language, made testable). **Guest Web component
  tests:** n/a. **E2E tests:** reaching `CARD_READY` shows the heading automatically but never
  auto-opens the focused surface.
- **Regression risks:** low — new, additive screen; the real risk is scope creep into
  building fake payment UI, explicitly guarded against.
- **Rollback approach:** flag off reverts to today's passive inline card display.
- **Entry criteria:** none beyond Phase 8/9's approval for the shell.
- **Acceptance criteria:** the bounded module ships genuinely empty/neutral — no wallet
  button, no card reveal, no checkout instructions anywhere in the shipped code.
- **Exit gate:** code review confirms the module contains no provider-specific implementation
  — this is the one exit gate in this entire plan that is fundamentally a *negative* check
  (proving absence, not presence).
- **Dependencies:** none for the shell.
- **Work explicitly excluded, absolutely:** the `[provider-supported payment method]` module's
  actual content — **blocked by the M0 gate, full stop**, not started, not prototyped, not
  scaffolded beyond the empty bounded region.

---

## 7. Proposed API/read-model schemas

**Implementation-planning schemas only — not permission to modify code.** Every field states:
authoritative source, privacy scope, nullable behavior, current equivalent, migration
behavior, client use, prohibited inference.

### 7.1 `contributionProgress` (organizer/member view and guest view alike)

```json
{
  "confirmedAmountMinor": 4000,
  "totalAmountMinor": 8000,
  "confirmedParticipantCount": 2,
  "totalParticipantCount": 4
}
```

| Field | Source | Privacy | Nullable | Current equivalent | Migration | Client use | Prohibited inference |
|---|---|---|---|---|---|---|---|
| `confirmedAmountMinor` | Sum of `participants.allocatedAmount` for contributions in `AUTHORIZED`-or-later state (D24) | Aggregate, safe for guests | No (0 if none confirmed) | None — `fundedAmountMinor` is a different, all-at-once value | Purely additive field | Vessel fill (§I7/I8) | Never inferred as "money captured" — `AUTHORIZED` precedes capture |
| `totalAmountMinor` | `vinks.requiredAmountMinor` | Aggregate, safe for guests | No | `requiredAmountMinor`, renamed for this projection's own clarity | n/a, same underlying value | Vessel denominator | — |
| `confirmedParticipantCount` | Count of participants with a confirmed contribution | Aggregate, safe for guests | No | None | New | Waiting-clause count fallback (3+, Phase 6 §12) | Never used to identify *which* participants — that's private (organizer/member view only, §9.2) |
| `totalParticipantCount` | `COUNT(participants)` for the Vink | Aggregate, safe for guests | No | None | New | Waiting-clause denominator | — |

### 7.2 Guest viewer contribution state

```json
{ "contributionStatus": "confirmed" }
```

| Field | Source | Privacy | Nullable | Current equivalent | Migration | Client use | Prohibited inference |
|---|---|---|---|---|---|---|---|
| `contributionStatus` | The **requesting guest's own** contribution row, collapsed to Phase 6 §0's seven-value vocabulary (`not_started`/`pending`/`declined`/`confirmed`/`cancelled`/`return_pending`/`returned`) | **Viewer-specific — this exact guest's own token, never another participant's** | No (defaults `not_started`) | None | New field | Gates the contribution action (D25); drives terminal copy | **Never derivable for anyone other than the authenticated guest token holder** — this is the single hardest privacy requirement in this whole plan |

### 7.3 Guest customer-safe Vink outcome

```json
{ "vinkOutcome": "completed" }
```

| Field | Source | Privacy | Nullable | Current equivalent | Migration | Client use | Prohibited inference |
|---|---|---|---|---|---|---|---|
| `vinkOutcome` | Derived from `vinks.state` + the guest's own `contributionStatus`, collapsed to D25's six categories (`completed`/`expired`/`cancelled`/`return_pending`/`returned`/`recovery-required`) | Guest-safe (no internal state name, no other participant's data) | Null while the Vink is still open/actionable | None — today's flat message is a hardcoded string, not a data field | New field | Drives the exact D25/D34 sentence (§Phase 6 §18) | **Never exposes the raw `VinkState` string** — this field exists specifically so the client never has to translate a raw state name itself (preventing the "Flutter/Guest Web invent contradictory outcomes" risk, §8) |

### 7.4 Participant-inclusive Home/Activity list entry

```json
{
  "vinkId": "…",
  "purpose": "Friday Dinner",
  "role": "participant",
  "state": "OPEN",
  "contributionProgress": { "...": "as 7.1" },
  "requiresAttention": false
}
```

| Field | Source | Privacy | Nullable | Current equivalent | Migration | Client use | Prohibited inference |
|---|---|---|---|---|---|---|---|
| `role` | `organizer` if `organizerUserId == viewer`, else `participant` | Viewer-specific, not shared | No | None | New | Home's grouping logic (Phase 3 §1) | Never used to hide a Vink from its organizer just because they're also flagged as a participant elsewhere — organizer role always wins for action purposes |
| `requiresAttention` | Derived: unpaid own-share, `RESTRICTED` (organizer-role only), any organizer-only alert | Viewer-specific | No | None (`RESTRICTED` was simply filtered, P1-6) | New | Home's two-section split | Never computed for a `participant`-role viewer using organizer-only signals (e.g. `RESTRICTED` never marks a mere participant's row as needing *their* attention) |

### 7.5 Vink Details (organizer/participant view — role-appropriate, full detail per Phase 0 §2)

```json
{
  "vinkOutcome": "completed",
  "totalAmountMinor": 8000,
  "participants": [{ "displayName": "Maya", "contributionOutcome": "confirmed", "amountMinor": 2000 }],
  "timeline": [{ "at": "2026-07-20T18:03:00Z", "event": "vink_opened" }]
}
```

| Field | Source | Privacy | Nullable | Current equivalent | Migration | Client use | Prohibited inference |
|---|---|---|---|---|---|---|---|
| `participants[].contributionOutcome` | Same D25-style collapse as §7.2, but **full list, since this is the organizer's/member's own history view** (Phase 0 §2 — not the guest privacy boundary) | Organizer/member only, never guest-scoped | No | Raw `ContributionStatus` today (internal) | New, customer-safe projection | Vink Details rows (Phase 8 §20) | Never includes raw provider identifiers, ledger entry ids, or internal recovery-ladder attempt counts (§ "do not expose" list below) |
| `timeline[].event` | A small, fixed customer-safe event-name vocabulary (not the raw `DomainEventName` catalog) | Same as above | No | Raw domain events today (internal, e.g. `ContributionAuthorizationStarted`) | New, translated vocabulary | Vink Details timeline | Never the literal domain event name — a small translation table, same discipline as the state-name-hiding rule |

### 7.6 Invitation delivery status (organizer-facing only)

```json
{ "participantId": "…", "deliveryStatus": "sent" }
```

`deliveryStatus ∈ {sending, sent, failed}` — organizer-scoped only, never exposed to the
guest/member being invited (they simply receive or don't receive the message itself).

### 7.7 Submission deadline (already exists — no new field, a rendering gap only)

`submissionDeadline` is already present on `GuestVinkView` (`apps/guest-web/lib/types.ts:13`)
— **I3's work is entirely client-side rendering of an existing field**, listed here only for
completeness of the traceability matrix, not because a new field is proposed.

### 7.8 Role of the authenticated viewer

Already effectively answered by §7.4's `role` field for list contexts; for a single-Vink
fetch (Lobby, Vink Details), the same `role: 'organizer' | 'participant'` field is proposed
on the snapshot response, sourced identically.

### Explicitly never exposed, in any schema above or built from this plan

Raw ledger entries, other participants' private contribution mechanics (to a guest), provider
identifiers (`providerAuthorizationId` and equivalents), internal recovery-ladder attempt
counts/timestamps, guest tokens (the raw `vgt_` value, ever, beyond its one-time issuance),
card credentials (PAN/CVV — never stored, so never exposable by construction).

---

## 8. Customer-state mapping implementation strategy

**Decision for this plan: server-projected, not client-mapped, for every money-outcome and
state-name-hiding concern; shared-package-based only for the small amount of purely
presentational logic that has no privacy dimension.**

Reasoning: Phase 6/Phase 8's canonical vocabulary (D25's six guest outcomes, the 16-state
lifecycle table, D34's exact phrases) is a **cross-platform contract**, and the single
biggest risk this plan can introduce is Flutter and Guest Web each independently
re-deriving "what state is this" from raw fields and drifting — exactly the failure mode
Phase 1 originally found (both apps had already, coincidentally, converged on byte-identical
copy strings, which is a lucky accident to stop relying on, not a system).

- **Server-projected (the default, per §7's schemas):** `vinkOutcome`, guest
  `contributionStatus`'s D25 collapse, `role`, `requiresAttention` — anything with a privacy
  dimension or a financial-correctness dimension is computed once, server-side, and shipped
  as an already-safe, already-categorized value. Neither client ever sees a raw internal
  state name for these.
- **Client-mapped (narrow, presentational only):** the exact *copy string* for a given
  category (e.g. mapping `vinkOutcome: "completed"` to "Payment complete. The merchant was
  paid $X.") lives in each platform's own copy layer (Phase 6's deck), because the *words*
  are legitimately platform-idiomatic (capitalization/line-wrapping/accessibility-string
  conventions differ) — but the **category itself** (which of D25's six it is) is never
  independently computed by either client from raw state.
- **Shared package-based:** not adopted for this plan's scope. A cross-platform shared copy
  package (Dart + TypeScript) was considered and rejected for now — Flutter and TypeScript
  can't literally share a code package without a translation layer of their own, and Phase
  6's copy deck is already small and stable enough that duplicating the *final strings* (not
  the *category logic*) in each platform's own idiomatic copy file is lower-risk than
  building cross-language tooling for a ~50-entry string table. **Revisit if the copy system
  grows substantially** (a real, stated threshold for reconsidering, not a permanent
  rejection).

**This prevents Flutter and Guest Web from independently inventing contradictory customer
outcomes** because the *category decision* (which of sixteen lifecycle states, which of six
guest outcomes) is made exactly once, server-side, in I1 — both clients consume the same
categorical value and merely render it in their own idiomatic copy.

**Preserved by this strategy, explicitly:** D23's hidden-DRAFT behavior (the server never
emits a category that would require a client to know DRAFT exists), D25's terminal-state
distinctions (server-collapsed, not client-derived), D34's money-outcome language (client
copy layers map 1:1 from the server's category, per Phase 6's deck, never inventing a
seventh phrase), D35's provider-copy boundary (the `[provider-supported payment method]`
marker is never resolved client-side into real copy — it stays an internal marker until a
provider is chosen).

---

## 9. Database and migration plan

**No migration is required by I1, I2, I3, I5–I11** — every read-model addition in this plan
composes existing tables. The **only** schema change in this entire plan is I4's contact-
capture columns:

```sql
-- Illustrative shape, not a literal migration file — additive, nullable, no backfill.
ALTER TABLE users ADD COLUMN contact_destination TEXT NULL;
ALTER TABLE users ADD COLUMN contact_method TEXT NULL; -- 'phone' | 'email'
-- Guest identity capture gains an equivalent optional pair at join/invite time.
```

**Migration strategy:** additive, nullable, no backfill, no default value beyond `NULL` —
`NULL` is a fully valid, meaningful state ("no automatic delivery destination captured yet"),
not a transitional value requiring cleanup. No existing row needs touching. Reversible by a
straightforward column drop if I4 is fully rolled back (not expected, but the migration's own
simplicity makes rollback low-risk regardless).

**No migration in this plan touches `contributions`, `ledger_*`, `vinks`, or any table the
domain state machines or the ledger's own triggers depend on** — restated as the plan's own
hard boundary, matching §0's protection guarantee.

---

## 10. Realtime-event plan

**No new event *types* are introduced anywhere in this plan.** The existing outbox-driven
publisher (PV8/PV8.5 — `SELECT … FOR UPDATE SKIP LOCKED`, publish-before-commit,
Redis-backed fanout) already pushes a snapshot on every relevant domain-event-producing
transition. I1's `contributionProgress`/`contributionStatus`/`vinkOutcome` fields are
**additional fields on the existing snapshot payload**, not new push mechanisms — a client
already subscribed to a Vink's channel receives the new fields automatically once I1 ships,
with no realtime-layer code change beyond the payload shape itself (which lives in the
application-layer projection I1 already scopes).

**I4's delivery-status changes** ride the same existing per-participant field-update pattern
already used for contribution status — no new channel, no new event type.

---

## 11. Feature-flag and rollout plan

**Follows the project's existing, already-established practice exactly**
(`docs/product-validation/00-governance.md` §4/§5): flags are static, environment-allowlisted,
default-off, read via the same `Env`-schema/boot-refusal pattern already used for
`VINKIN_OTEL_ENABLED` (`apps/api/src/config/env.ts`) — **no new runtime flag *service* is
introduced**, matching governance's own note that "no runtime flag service exists yet" and
this plan doesn't change that.

| Flag | Gates | Default | Allowlist | Dependency | Compatibility | Test coverage | Removal condition |
|---|---|---|---|---|---|---|---|
| `contribution_progress_projection` | I1's new fields | off | development, test | none | Purely additive — old fields untouched | Contract tests (§12) | Never removed as a flag *value* concept — folded into always-on once I7/I8 fully migrate off `fundedAmountMinor` for progress display, then the flag itself is deleted (not left permanently off) |
| `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL` (env var name; instantiated I2B, 2026-07-21) | I2's query, `GET /api/v1/vinks`'s additive `role` field, `GET /api/v1/vinks/:vinkId/participant-view` | off | development, test | none | Additive superset of old behavior — flag-off `GET /api/v1/vinks` shape is byte-identical to pre-I2B (proven by a dedicated integration test) | Contract + E2E (§12) — both shipped (I2A 2026-07-20, I2B 2026-07-21): `participant-inclusive-transport.integration.test.ts` (10/10, real Postgres, incl. the named member-discovers-and-opens E2E regression), Flutter `home_screen_test.dart` (routing-by-role + RESTRICTED reachability + rollback-to-flag-off, 5/5) | Deleted once I6 fully rolls out |
| `NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI` (env var name; instantiated I3, 2026-07-21) | I3's Guest Web changes | off | development, test | soft: most-effective once `VINKIN_CONTRIBUTION_PROJECTION_ENABLED` is also on (D23's DRAFT-withholding needs the backend flag; the client flag alone still safely shows "Not open yet" either way, see `lib/config.ts`'s own doc comment) | Flag off preserves today's exact pre-I3 behavior, proven by re-running the original `E9` Playwright test against a fresh flag-off build with zero changes needed | Playwright (§12): `e9.spec.ts` original `E9` test (flag off, 1/1) + 5 new `"I3 …"` tests (flag on, 5/5, separate build) + `tests/guest-copy.spec.ts` (28/28 exhaustive copy-mapping) | Deleted once fully rolled out — this is the one flag with a **trust/safety** removal urgency: it should not sit half-enabled for long, since P0-2 is a real defect |
| `VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED` (env var name; instantiated I4, 2026-07-21) | I4's send pipeline (member path only) | off | development, test **only** — boot-refused (not just documented) outside those two, `apps/api/src/config/env.ts` | none for the pipeline; external for real sends | Manual fallback always available regardless | `invitation-delivery.integration.test.ts` (2/2, real Postgres, mock adapter) | Deleted once a real provider is live and the pipeline is proven in `staging` |
| `canonical_create_flow` | I5's two-screen flow | off | development, test | soft: `automatic_invitation_delivery`/manual fallback | Old five-step flow remains available in parallel | `e1_test.dart` (§12) | Deleted only after old flow is formally retired (a follow-up, not this plan) |
| `home_activity_v2` | I6 | off | development, test | `participant_inclusive_retrieval` | Additive | Widget + E2E (§12) | Deleted once fully rolled out |
| `ink_progress_vessel` | I7 | off | development, test | `contribution_progress_projection` | Old linear bar remains available in parallel | Widget + E2E (§12) | Deleted once fully rolled out |
| `guest_web_visual_v2` | I8 | off | development, test | `contribution_progress_projection`, `guest_contribution_status_ui` | Additive visual layer | Playwright (§12) | Deleted once fully rolled out |
| `in_place_reauth` | I9 | off | development, test | none | Old generic error handling remains the fallback | Widget tests (§12) | Deleted once fully rolled out and security-reviewed in production-equivalent conditions |
| `motion_system_v1` | I10's timed motion | off | development, test | I7, I8 substantially landed | Instant/no-transition fallback always safe | Widget + Playwright reduced-motion runs (§12) | Deleted once fully rolled out |
| `ready_to_pay_shell` | I11's shell | off | development, test | none | Old passive card display remains available | Widget tests (§12) | **Not deleted until the M0 gate resolves and the bounded module gets real content** — this flag has the longest expected lifetime in this plan, by design |

**Rule, restated from governance:** a flag may never be enabled in an environment its row
does not list — `staging`/`production` enablement for any of these requires a deliberate,
separate decision outside this plan's scope (this plan only defines the flags and their
`development`/`test` behavior). **No flag above is permanent** — each has a stated removal
condition, satisfying the explicit instruction against permanent flags for completed
migrations.

---

## 12. Verification strategy — test matrix

### Backend

| Scenario | Coverage |
|---|---|
| `contributionProgress` derivation | Unit — equal split, custom split |
| Organizer-as-participant | Unit — organizer's own share included/excluded correctly in aggregate counts |
| Zero/partial/full progress | Unit + contract, all three points on the curve |
| Duplicate contribution | Integration — idempotency key collision resolves to one outcome |
| Already-confirmed guest reload | Contract — `contributionStatus` returns `confirmed` consistently, never re-derivable as `not_started` |
| Expiry before contribution | Integration — `vinkOutcome: expired`, individual `contributionStatus: not_started` or `cancelled` |
| Expiry after contribution (captured, needs refund) | Integration — `vinkOutcome: expired` transitioning through `return_pending` → `returned` |
| Cancellation before contribution | Integration — `vinkOutcome: cancelled`, `contributionStatus: not_started`/`cancelled` |
| Cancellation after contribution | **Not reachable in the current domain** (D30/§ Phase 2's own finding — `CANCELLED` is only modeled from `OPEN`, pre-funding) — test asserts this is correctly *unreachable*, not silently assumed |
| Return pending / returned | Integration — full `REFUND_PENDING`→`REFUNDED` cycle reflected in `contributionStatus` |
| Recovery-required | Integration — organizer's own view shows the D34 line; participant/guest view shows `confirmed`, never a distinct recovery signal |
| Participant-inclusive retrieval | Contract — organizer+participant union, dedup when both apply |
| Role privacy | Contract — a `participant`-role viewer never receives organizer-only fields (`requiresAttention` computed from `RESTRICTED`, etc.) |
| Pre-open guest access | Contract — `DRAFT` response shape never includes full summary data |
| Invitation dispatch after `VINK_OPENED` | Integration — dispatch attempt timestamp strictly after the `VinkOpened` event |
| Partial delivery failure | Integration — one participant's failure never flips the Vink's own open-success response |
| Resend throttling/idempotency | Integration — rapid resend requests produce exactly one accepted send within the cooldown window |

### Flutter

Two-screen Create flow (widget); exact split validation retained (widget, ported from
existing five-step coverage); automatic organizer inclusion (widget); disabled/loading button
width (widget, direct P1-1 regression); destructive-control contrast role (widget, asserts
the corrected color role is used, paired with the contrast-tool check in §14); compact and
primary Ink Progress (widget, full state table); participant state transitions (widget, §9's
table); countdown (widget, no per-tick rebuild/announcement); interruption and restoration
(widget, D26's three core scenarios); reauthentication without action replay (widget, the
single most safety-critical Flutter test in this plan); reduced-motion behavior (widget,
Phase 9 §23's matrix).

### Guest Web

Server-known initial render (Playwright, asserts content present before any client fetch
resolves); no blank "Connecting" page (Playwright, direct regression for the audited
`JoinExperience.tsx` gap); deadline display (Playwright, direct P1-2 regression); no `DRAFT`
badge (Playwright, direct P0-2 regression, asserts the string "Draft" never appears in a
guest-reachable DOM state); no contribution action after confirmation, including reload
(Playwright, direct P0-2 regression — the single most important Guest Web test in this plan);
all terminal money outcomes (Playwright, all six D25 categories); realtime reconnect
(Playwright, simulated disconnect/reconnect, asserts no visual interruption); browser reload
(Playwright, session resume correctness); keyboard navigation (Playwright, keyboard-only
pass); responsive layouts (Playwright, viewport matrix per Phase 8 §23); reduced motion
(Playwright, `prefers-reduced-motion` emulation).

### Cross-client parity matrix

| Property | Mobile source | Guest Web source | Parity test |
|---|---|---|---|
| Same progress values | `contributionProgress` (I1) | Same field, same endpoint family | Contract test: identical payload shape/values for the same Vink queried from both client contexts |
| Same money outcome | `vinkOutcome`/organizer detail (I1/§7.3/§7.5) | Same `vinkOutcome` | Contract test: category never differs by client |
| Same terminology | Phase 6's copy deck, per-platform files | Same deck | Manual/snapshot test: string tables cross-referenced against the deck, not against each other |
| Same deadline interpretation | `submissionDeadline`, server-computed | Same field | Contract test: both clients format the same instant identically (modulo platform date formatting, not meaning) |
| Privacy differences by role | Organizer/member full detail | Guest aggregate-only | Contract test: guest response never contains the organizer/member-only fields, verified by schema diff, not just by eyeballing |
| Realtime convergence | Snapshot push | Snapshot push | Integration test: both clients subscribed to the same Vink converge to the same state within one push cycle |

---

## 13. Cross-client parity matrix

(Included above, §12, as the dedicated cross-client section — not duplicated.)

---

## 14. Accessibility-verification plan

**Automated contrast tooling** (a real tool — e.g. an axe-core/Pa11y-class checker or a
dedicated WCAG contrast calculator — run against actual rendered output, not hand
calculation) is **required** before any Phase 8 §24/D36 finding is marked resolved. Hand
calculations throughout Phases 8–10 are risk-flags, never certification (D36, restated as
the binding rule for this verification plan).

**Explicitly verified, by the tool, not by inspection:** destructive buttons (P0-1's exact
fix); danger icons and borders (non-text 3:1 threshold, separately from text); cobalt (`blue`)
text at its real rendered sizes; smoke text at its real rendered sizes; disabled controls
(their reduced-opacity state, not just their enabled state); focus indicators; status labels
(every badge tone from Phase 8 §4/§17).

**Manual verification, required alongside tooling (contrast tools can't check everything):**
focus-order review (tab through every screen in §12's Flutter/Guest Web suites); keyboard-
only Guest Web testing (a full journey with no pointer/touch input); screen-reader testing on
both mobile (VoiceOver/TalkBack) and web (a desktop screen reader) — covering every
accessibility announcement defined in Phase 6 §23/Phase 8 §24/Phase 9 §24; increased-text-
size testing (Phase 8 §24's reflow requirements, at the OS's largest supported text-size
setting); reduced-motion testing (Phase 9 §23's matrix, on real devices/browsers with the
setting enabled, not simulated); non-color state verification (every status treatment
checked with color desaturated/removed, confirming text still carries full meaning); button
loading-width regression (automated where feasible — a layout-diff assertion in the widget-
test suite, per I0's own test requirement).

---

## 15. Security and privacy review plan

Each item below is an **implementation review gate** — required sign-off before the
associated slice's exit gate, not a general statement of intent.

| Gate | Associated slice | Requirement |
|---|---|---|
| Guest token access | I1, I3 | `contributionStatus`/`vinkOutcome` never derivable for a token other than the requester's own — tested, not assumed |
| Participant-specific privacy | I1, I2 | Guest aggregate-only boundary (unchanged from Phase 0 §2) re-verified against the new fields specifically |
| Contact information storage | I4 | At-rest handling reviewed before the migration ships (an infrastructure decision, flagged here as needing review, not resolved by this plan) |
| SMS/email delivery | I4 | Provider integration reviewed once selected (external, §4) — this plan only reviews the *pipeline's* handling of contact data, not a specific vendor's practices |
| Resend abuse | I4 | Server-side cooldown enforcement verified independent of any client-side cooldown UI (Phase 5 C18's own requirement, security-tested here) |
| Invitation enumeration | I4 | Confirm the existing 32-byte guest-token entropy (D14) remains the enumeration defense — no change to token generation in this plan |
| In-place reauthentication | I9 | Full review per I9's own security-review requirement (§6) |
| Stale session restoration | I9 | Confirm restoration always refetches, never trusts a cached pre-interruption snapshot for anything security-relevant |
| Action replay | I9, I3 | The two "never replay" guarantees (mobile reauth, guest reload) both have a dedicated adversarial test: attempt to trigger a replay deliberately, confirm it's impossible, not just untested |
| Card/presentment boundary | I11 | Code review confirms zero PAN/CVV handling anywhere in the shipped shell (§6's own exit gate, restated here as a security gate too) |
| Screenshot/background handling | I11 | **Explicitly deferred** — depends on provider behavior not yet known (M0-blocked); no screenshot-prevention/backgrounding-redaction logic is designed or built in this plan, since there is no sensitive content in the shell to protect yet |

---

## 16. Observability plan

Signals defined below are **operational, not analytics-product-scale** — a small, named set,
matching the discipline D18 already established for PV12's own funnel work.

**Log/emit:** `invitation_send_accepted{vinkId, participantId}`,
`invitation_delivery_failed{vinkId, participantId, reason}`, `guest_link_opened{publicCode}`,
`contribution_action_started{vinkId, viewerRole}`, `contribution_confirmed{vinkId,
viewerRole}`, `duplicate_contribution_prevented{vinkId}`, `reconnect_reconciliation_occurred
{vinkId}`, `reauthentication_required{screen}`, `reauthentication_restored{screen}`,
`state_mapping_fallback_reached{context}` (fires only if a client ever hits a category it
doesn't have copy for — itself a signal that §8's shared-category strategy has a gap),
`terminal_money_outcome_rendered{category}`.

**Never logged, anywhere, by any signal above:** full phone numbers, full email addresses,
guest tokens, sensitive payment information, full card data — every event schema above uses
only ids (`vinkId`, `participantId`, `publicCode` — already the public join code, not a
secret) and small enum-like fields (`reason`, `category`, `viewerRole`), never a raw contact
value.

---

## 17. Rollback strategy

Restated per-slice in §6's own "Rollback approach" fields — summarized here as the plan's
governing pattern: **every slice's flag-off state is the current, already-shipped behavior,
never a broken intermediate state.** I5 and I7 explicitly keep their "old" implementations
(the five-step wizard, the linear progress bar) present and functional in the codebase until
their new counterparts are fully rolled out — this plan does not delete a working old path
the moment a new one merges. I4's rollback is the safest in the plan (manual sharing, the
current real behavior, requires no code path removal at all to fall back to). I9's rollback
is a known, already-shipped gap (no reauth recovery), not a new risk. I11's rollback is
identical to today's passive card display.

---

## 18. External-pilot readiness checklist

- [ ] I0 shipped and verified by a real contrast tool (not hand calculation) — P0-1 closed.
- [ ] I1 shipped, contract tests green — the read-model foundation every trust-critical fix
      depends on.
- [x] I3 + I3A shipped (2026-07-21) — P0-2's three compounding guest-trust defects closed
      (reload-reoffer, one flat terminal message, raw DRAFT leak); this was the single
      highest-priority item for any pilot involving real guests. All six D25 terminal
      outcomes now have a canonical guest composition and Playwright coverage: `completed`/
      `cancelled`/`expired` driven live against a real backend (I3), `return_pending`/
      `returned`/`recovery_required` proven deterministically via fixture interception (I3A,
      `tests/guest-terminal-states.spec.ts`) — the last three intentionally not manufactured
      via new financial workflows, per I3A's own explicit instruction. I3A also caught and
      fixed a real correctness gap I3 left behind: a guest's own `contributionStatus` now
      wins over the vink-level `vinkOutcome` for `return_pending`/`returned` (see D25's
      traceability row above for why "You weren't charged." would have been wrong for a
      guest who was charged and is being refunded). Verified across four real production
      builds this pass (flag off; flag on; flag on + support URL configured; flag on, no
      support URL) — zero regression on the original `E9` test throughout.
- [x] I2 shipped (2026-07-21) — members can find their own Vinks without depending on a link
      surviving, and can open them via the new customer-safe participant-view route. One
      known, flagged gap remains: the per-vink Activity feed stays organizer-only (no
      customer-safe event-filtering surface built yet) and the participant lobby has no
      realtime channel (HTTP-only) — see the traceability rows above.
- [ ] I9 shipped and security-reviewed — a pilot with real sessions over real time needs
      session-recovery that doesn't strand users.
- [ ] I4's pipeline shipped behind its flag with a real (not mock) delivery provider selected
      and integrated — **or** the pilot proceeds with manual-sharing only, explicitly
      acknowledged as the fallback, not silently assumed to be automatic. (Partial as of
      2026-07-21: the member-path pipeline shape/flag/tests are done against the mock
      adapter, per this checklist's own "shape can proceed, real send is external" carve-out
      — §4/§6. Guest-path dispatch, the contact-capture UI beyond Register, and a real
      provider selection are all still open.)
- [ ] I5 shipped — the create flow a first-time pilot user encounters matches the tested,
      calmer canonical flow, not the five-step wizard already flagged as more ceremony than
      needed.
- [ ] I7/I8 shipped — the Ink Progress vessel (the product's own signature visual) is real,
      not the old linear bar, for a pilot meant to showcase the product.
- [ ] I11's shell shipped, with the M0 gate's status explicitly communicated to pilot
      organizers as "simulation only" (Phase 0 §12's existing banner, unchanged) — the pilot
      cannot include real payment presentment regardless of this plan's own readiness, since
      that's M0-gated independent of everything here.
- [ ] Accessibility verification (§14) complete, tool-certified, not hand-estimated.
- [ ] Security/privacy review (§15) sign-off obtained for I4 and I9 specifically.
- [ ] Support entry point (D28) configured with a real, monitored destination — even a
      minimal one — before real guests can hit a confusing state and have nowhere to go.

**Blockers that remain blockers regardless of this plan's own completion:** the M0 provider
gate (real payment presentment); legal engagement for Terms/Privacy if the pilot's scope
requires them (D28); a genuine support-staffing decision (who reads the support inbox during
the pilot window).

---

## 19. Usability-test script

_Test plan only — not run as part of this phase._

**Setup:** two participants — a first-time "organizer" and a first-time "guest" — on real
devices/browsers, moderated, think-aloud protocol, using a build with I1–I8/I11 flagged on in
`test`/`demo`.

| # | Task (organizer) | Moderator prompt | Success criterion | Hesitation signal | Comprehension question |
|---|---|---|---|---|---|
| 1 | Create a Vink for a $40 lunch | "Start a new group payment for lunch, about $40." | Reaches the People+Split screen within 60s | Looking for a "next" affordance for >10s | "What happens if you tap Continue right now?" |
| 2 | Add themselves and one other person | "Add yourself and one friend." | Both appear in the list, split visible | Uncertainty about whether they're automatically included | "Are you included in this split? How do you know?" |
| 3 | Choose Equal split | "Split it evenly." | Equal selected, amounts update live | Confusion about Equal vs Custom | "If you added a third person right now, what would happen to the amounts?" |
| 4 | Add a reachable guest | "Add someone who doesn't have the app — use a real phone number or email you can check." | Guest added with a delivery choice visible | Can't find the guest option after a failed name search | "Does this person need to install anything?" |
| 5 | Open the Vink | "You're ready — open it." | Confirmation sheet appears, then Lobby | Multiple taps on "Open Vink" (duplicate-tap risk) | "Did anything just get charged?" |
| 6 | Understand invitation delivery | (observe, no prompt) | Notices the delivery status per person | Assumes nothing happened because no visible "success" screen | "How do you know your friend got invited?" |
| 7 | Contribute their own share | "Pay your part." | Completes via the same action a participant would use | Looks for an organizer-specific shortcut | "Did you just pay, or does something else still need to happen?" |
| # | Task (guest) | Moderator prompt | Success criterion | Hesitation signal | Comprehension question |
| 8 | Open the link | (hand them the real link/message) | Sees organizer, purpose, amount within 3s, no login prompt | Looks for a sign-up/login button | "Do you need an account for this?" |
| 9 | Understand organizer/purpose/amount/deadline | "What is this asking you to do?" | Correctly states all four facts unprompted | Missight the deadline or amount | "How much is your part? When does this close?" |
| 10 | Contribute | "Pay your part." | Completes, sees "You're in"/confirmed state | Re-taps the action after it's already confirmed | "If you refresh this page right now, what do you think you'll see?" |
| # | Task (organizer, cont'd) | Moderator prompt | Success criterion | Hesitation signal | Comprehension question |
| 11 | Understand Ink Progress | "What does this graphic tell you?" | Correctly reads confirmed amount and who's left | Reads it as a decorative element only | "Who hasn't paid yet, and how do you know?" |
| 12 | Recognize everyone is in | (wait for the vessel to complete) | Notices "Everyone's in" without prompting | Doesn't notice the transition at all | "What changed just now?" |
| 13 | Reach Ready to Pay | (observe) | Understands a deliberate tap is needed | Expects payment to happen automatically | "What do you need to do to actually pay the merchant?" |
| 14 | Understand an outcome (expiry/cancel/return, simulated) | "This Vink [expired/was cancelled/is being returned] — what happened to your money?" | Correctly states the exact money outcome | Uncertain whether they were charged | "Was any money taken from you? Is any coming back?" |

**Accessibility variants:** repeat tasks 8–10 with a screen reader active (no visual
reference); repeat tasks 1–5 with the OS text size set to its largest supported setting;
repeat tasks 11–13 with reduced motion enabled, confirming comprehension is unaffected.

**Metrics:** task completion rate, time-on-task, tap/click error count, hesitation count (any
pause >5s or repeated back-navigation), comprehension-question accuracy, trust-question
accuracy (task 14 is the single highest-priority comprehension check in this script — money-
outcome clarity is this whole plan's most safety-critical property).

**Issues that block external pilot testing:** any participant who cannot correctly answer a
money-outcome comprehension question (task 5, 7, 10, 14) after completing the task —
independent of task-completion success, since a user can complete a task while
misunderstanding what happened to their money, which is exactly the failure mode Phases 0–9
exist to prevent.

---

## 20. Final implementation prompts

_One self-contained prompt per slice — each names its authoritative documents, permitted and
forbidden work, and stops at its own boundary. Not one "implement everything" prompt._

**Prompt — Slice I0 (Accessibility and shared-control corrections)**
> Authoritative documents: `docs/design/phase-8-visual-system-refinement.md` §4/§9/§10/§11/§24,
> `docs/design/phase-9-motion-system.md` §2/§7, `docs/spec/decision-log.md` D36, and this
> document's §2 (P0-1, P1-1) and §6 (I0). Slice: **I0 only.** Permitted: fix
> `VinkDestructiveButton`'s color role in `apps/mobile/lib/design_system/components/vink_buttons.dart`
> to the interim `text.primary`-tier treatment per Phase 8 §10; add reserved-width +
> cross-fade to all three button tiers' loading state; audit (and fix if failing) Guest Web's
> existing button color usage. Forbidden: introducing any new screen, copy string, or
> financial behavior; finalizing a `dangerText`/darker-fill token without real tool
> verification. Before changing anything, inspect the current state of
> `vink_buttons.dart`/`vink_status_badge.dart` and the two audited Guest Web files directly —
> do not assume this document's file:line citations are still accurate without re-checking.
> Write widget/contrast tests before marking this complete. Update this document's §1/§2/§6
> status for I0 once shipped. Report any deviation from this document's specified approach
> explicitly, with reasoning — do not silently choose a different fix. Do not make any
> product decision beyond what D36 already settled. Stop at I0's boundary — do not begin I1.

**Prompt — Slice I1 (Consumer read-model foundation)**
> Authoritative documents: `docs/spec/decision-log.md` D20/D23/D24/D25, this document's §6
> (I1), §7.1–§7.3/§7.7 (schemas), §9 (no migration), §10 (no new realtime event type), §12
> (backend test matrix). Slice: **I1 only.** Permitted: add `contributionProgress` and guest
> `contributionStatus`/`vinkOutcome` as additive fields to `packages/application/src/queries.ts`
> and `guest.ts`, and the corresponding `apps/api` routes; gate `getPublicVinkView` on
> `DRAFT`. Forbidden: any change to `packages/domain`'s state machines, the D5 resolver, the
> ledger, or `fundedAmountMinor`'s existing meaning; any client-side change (that's I3/I7/I8).
> Before changing anything, read `packages/application/src/queries.ts` and `guest.ts` in full
> to confirm this document's citations still match current line numbers/logic. Write contract
> tests covering every state combination in §12's backend table before completion, including
> the guest-privacy adversarial test (confirm `contributionStatus` cannot be derived for any
> token other than its own). Gate all new behavior behind `contribution_progress_projection`
> per §11, default off, `development`/`test` only. Update the decision log only if you
> discover this plan's schema needs a genuine correction — do not silently redesign the shape.
> Stop at I1's boundary.

**Prompt — Slice I2 (Participant-inclusive retrieval)**
> Authoritative documents: `docs/design/phase-3-information-architecture.md` §1, this
> document's §6 (I2), §7.4 (schema), §12. Slice: **I2 only.** Permitted: a new or extended
> query in `packages/application/src/ports.ts`/`queries.ts` returning the union of
> organizer-owned and participant-in Vinks with a `role` field; the corresponding
> `apps/mobile` Home/Activity provider changes to consume it. Forbidden: any invitation-inbox
> UI (explicitly excluded); any change to `listVinksByOrganizer`'s existing callers that
> aren't Home/Activity, without first confirming they don't depend on organizer-only
> semantics. Before changing anything, read `packages/application/src/queries.ts:137-139` and
> every current caller of `listMyVinks` to confirm this document's citation is accurate.
> Write the union/dedup unit test and the `RESTRICTED`-reachability E2E regression test before
> completion. Gate behind `participant_inclusive_retrieval`. Stop at I2's boundary.

**Prompt — Slice I3 (Guest Web correctness before visual redesign)**
> Authoritative documents: `docs/spec/decision-log.md` D23/D24/D25/D34, this document's §6
> (I3), §2 (P0-2, P1-4, P1-5), §7.2/§7.3, §12. Slice: **I3 only — depends on I1 already
> shipped and flagged on in `test`.** Permitted: the D23 not-open-yet state, consuming guest
> `contributionStatus`/`vinkOutcome` to gate the contribution action and drive terminal copy,
> deadline rendering, a new Guest Web human-error-message layer. Forbidden: any visual/
> spacing convergence with the mobile design system (that's I8 — this slice may ship with
> today's existing visual treatment); any new financial behavior. Before changing anything,
> read `apps/guest-web/features/join/{JoinExperience,JoinForm,SessionView}.tsx` and
> `components/StatusBadge.tsx` in full and re-verify this document's line citations. Extend
> (never replace) `apps/guest-web/tests/e9.spec.ts` with the reload-safety test and all six
> terminal-outcome tests before completion. Apply Phase 6 §18/§25's exact phrases verbatim —
> do not paraphrase. Gate behind `guest_contribution_status_ui`. Stop at I3's boundary.

**Prompt — Slice I4 (Contact capture and invitation delivery)**
> Authoritative documents: `docs/spec/decision-log.md` D19/D27, this document's §4 (external
> dependency boundary), §6 (I4), §9 (migration), §15 (security gates). Slice: **I4 only.**
> Permitted: nullable contact-capture columns and the corresponding Register/Profile/
> Add-Participant fields; a provider-agnostic delivery-module interface (mirroring the
> `FinancialProvider` abstraction pattern) with a mock adapter for tests. Forbidden: importing
> any specific SMS/email SDK — if a real provider hasn't been selected (§4, external), build
> and test against the mock adapter only; any carrier/consent/regulatory copy (external
> dependency, do not invent); enabling `automatic_invitation_delivery` outside
> `development`/`test`. Before changing anything, confirm no contact field already exists
> under a different name anywhere in `apps/api/src/modules/auth`. Write the dispatch-ordering
> integration test (never before `VINK_OPENED`) and the partial-failure test before
> completion. Report explicitly if a real provider becomes available during this work — do
> not silently integrate it without flagging the decision. Stop at I4's boundary.

**Prompt — Slice I5 (Canonical Create flow)**
> Authoritative documents: `docs/spec/decision-log.md` D30, `docs/design/phase-4-screen-contracts.md`
> §5, `docs/design/phase-5-button-interaction-contracts.md` §3 (Group B), this document's §6
> (I5). Slice: **I5 only.** Permitted: restructuring `apps/mobile/lib/features/create_vink/*`
> into the two-screen + transient-confirmation flow. Forbidden: deleting the existing
> five-step wizard's code (keep both available behind the flag); any change to
> `createVinkCommand`/`setSplitCommand`/split-validation logic itself — **the existing
> idempotency and exact-reconciliation guarantees must transfer unmodified, not be
> reimplemented.** Before changing anything, read the current `create_vink_screen.dart` and
> every existing test referencing it (`apps/mobile/test/features/create_vink/*`,
> `integration_test/e1_test.dart`) in full. Update (not duplicate) `e1_test.dart` to the new
> flow. Gate behind `canonical_create_flow`. This is the highest-regression-risk slice in the
> plan (§6's own risk rating) — if any existing test's assertion about backend behavior would
> need to change, stop and report rather than silently altering what the test verifies. Stop
> at I5's boundary.

**Prompt — Slice I6 (Home, Activity, and Vink Details)**
> Authoritative documents: `docs/design/phase-3-information-architecture.md` §1/§4,
> `docs/spec/decision-log.md` D29/D31, this document's §6 (I6), §7.4/§7.5. Slice: **I6
> only — depends on I1 and I2 already shipped and flagged on in `test`.** Permitted: Home's
> two-section grouping, Activity's tappable rows, a new Vink Details screen. Forbidden: the
> word "Receipt" or "View receipt" anywhere in code, copy, or tests (D31, grep-verified);
> building the compact Ink vessel's real data wiring if I7 hasn't landed yet — use the
> existing linear bar as an explicit, acceptable interim per this document's own §6 note.
> Before changing anything, confirm whether today's `/activity` response already carries
> everything Vink Details needs, or whether a small additive read is genuinely required —
> report this finding rather than assuming either way. Write the `RESTRICTED`-reachability
> test and a grep-based "never renders Receipt" regression test before completion. Gate
> behind `home_activity_v2`. Stop at I6's boundary.

**Prompt — Slice I7 (Live Vink and Ink Progress)**
> Authoritative documents: `docs/design/phase-8-visual-system-refinement.md` §15,
> `docs/design/phase-9-motion-system.md` §10, this document's §6 (I7), §2 (P0-3). Slice: **I7
> only — depends on I1 already shipped and flagged on in `test`.** Permitted: a new vessel
> component consuming `contributionProgress`; consolidating the Lobby's duplicate "Your
> share" card into the participant list per Phase 1 §F.1. Forbidden: any change to
> `packages/domain`'s contribution state machine; deleting `VinkProgressIndicator` (keep it
> available behind the flag until full rollout). Before changing anything, read
> `vink_lobby_screen.dart` in full to confirm the current card-duplication and progress-bar
> usage this document cites. Write widget tests for every state in Phase 8 §15's table,
> including the "never fills for a processing contribution" adversarial test, before
> completion. Gate behind `ink_progress_vessel`. Stop at I7's boundary.

**Prompt — Slice I8 (Guest Web visual and responsive convergence)**
> Authoritative documents: `docs/design/phase-8-visual-system-refinement.md` §6/§7/§22/§23,
> `docs/design/phase-9-motion-system.md` §18, this document's §6 (I8). Slice: **I8 only —
> depends on I1 and I3 already shipped and flagged on in `test`.** Permitted: a shared
> spacing/radius CSS token layer mirroring `vink_spacing.dart`/`vink_radius.dart`; the guest
> vessel variant replacing `components/ProgressBar.tsx`; Phase 8 §23's responsive system.
> Forbidden: dark mode (explicitly deferred); any change to I3's already-shipped correctness
> logic. Before changing anything, read `apps/guest-web/app/globals.css` and every component
> Phase 8 §22 specifies for Guest Web. Extend `screenshots.spec.ts`/`e9.spec.ts` with
> viewport-matrix and keyboard-only tests before completion. Gate behind
> `guest_web_visual_v2`. Stop at I8's boundary.

**Prompt — Slice I9 (In-place reauthentication)**
> Authoritative documents: `docs/spec/decision-log.md` D26, `docs/design/phase-5-button-interaction-contracts.md`
> §3 (C44), `docs/design/phase-9-motion-system.md` §21, this document's §6 (I9), §15 (security
> gate). Slice: **I9 only.** Permitted: a global 401-listener in
> `apps/mobile/lib/core/networking/api_client.dart`, a reauth overlay, state preservation in
> the Create flow and Lobby. Forbidden: any change to the token-issuance/refresh mechanism
> itself; auto-replaying the action that hit the original 401 — this is the single most
> important forbidden behavior in this entire plan. Before changing anything, read
> `api_client.dart` and `auth_controller.dart` in full to confirm the existing single-retry
> behavior this document describes. Write the three core widget tests (state preservation,
> fresh-refetch-not-stale-snapshot, no-action-replay) before completion, and **obtain an
> explicit security review before marking this slice's exit gate met** — do not self-certify
> the security requirement. Gate behind `in_place_reauth`. Stop at I9's boundary.

**Prompt — Slice I10 (Cross-platform motion and state-feedback adoption)**
> Authoritative documents: `docs/design/phase-9-motion-system.md` in full, this document's §6
> (I10). Slice: **I10 only — depends on I7 and I8 substantially landed.** Permitted: applying
> Phase 9's five duration tokens and small easing set to components already built by I0/I5–I9;
> the hover-lift addition on Guest Web (Phase 9 §18); reduced-motion handling everywhere
> motion is added. Forbidden: any duration/easing value beyond Phase 9 §3/§4's defined set;
> any haptic beyond Phase 9 §22's exact list; any new decorative motion not specified in
> Phase 9. Before changing anything, confirm which components I0/I5–I9 actually shipped, since
> this slice only times what already exists. Write the reduced-motion widget/Playwright tests
> for Phase 9 §23's full matrix before completion — reduced-motion support ships
> unconditionally, never behind the `motion_system_v1` flag itself. Stop at I10's boundary.

**Prompt — Slice I11 (Ready-to-Pay provider-independent shell)**
> Authoritative documents: `docs/spec/decision-log.md` D32/D35, `docs/design/phase-8-visual-system-refinement.md`
> §19, `docs/design/phase-9-motion-system.md` §16, this document's §6 (I11), §15 (security
> gate). Slice: **I11 only.** Permitted: the "Ready to pay" heading (automatic on
> `CARD_READY`), the deliberate "Pay now" tap, a bounded, genuinely empty/unstyled region
> marked internally as `[provider-supported payment method]`. **Absolutely forbidden:** any
> wallet button, virtual-card credential display, PAN/CVV field, copy-number control,
> register/checkout instructions, or provisioning animation — the bounded module ships with
> **zero** implementation, not a stub, not a placeholder UI. Before changing anything, read
> the current `_CardCard` implementation in `vink_lobby_screen.dart`. Write the deliberate-tap
> gate test and a code-review checklist item confirming the module contains no
> provider-specific logic before completion — this slice's exit gate is fundamentally a proof
> of absence, treat it accordingly. Gate behind `ready_to_pay_shell`. Stop at I11's boundary —
> do not attempt to "prepare" the module for a future provider beyond the bounded empty
> region itself.

---

## 21. Deferred-work register

Explicitly excluded from this plan and from every slice above, restated as a standing list:
provider-specific payment presentment (M0-blocked, I11's own module), wallet integration,
full virtual-card credential behavior, card-copy controls, provider-specific legal language,
support service-level promises, fees, percentage-splitting UI, contacts sync, dark mode,
merchant receipts, and any unrelated product feature not traced to an approved decision in
§1's matrix. **The provider-independent Ready-to-Pay shell is planned (I11); the
`[provider-supported payment method]` module itself remains blocked by M0**, restated as the
single most important boundary in this entire document.

---

## 22. Final gate — acceptance criteria for beginning implementation

- [x] Every approved requirement in §1's matrix maps to exactly one implementation slice.
- [x] Every slice in §6 has stated entry and exit criteria.
- [x] Every slice with client-visible work has its required backend contract identified in
      §7, or is explicitly marked client-only.
- [x] No provider-blocked capability (§4/§21) is treated as available anywhere in this plan —
      I11's module is the one deliberately, permanently incomplete piece.
- [x] The live accessibility defects (P0-1, P1-1) are prioritized into I0, the first slice.
- [x] Financial and state-machine semantics are unchanged by every slice (§0's protection
      guarantee, restated per-slice in §6's "Domain changes: none" entries throughout).
- [x] Rollback and rollout behavior are defined per slice (§6, §11, §17).
- [x] Tests cover the canonical money outcomes (§12's backend/Flutter/Guest Web/cross-client
      matrices, all six D25 categories explicitly named).
- [x] The twelve implementation prompts (§20) are independently executable, each citing its
      own authoritative documents and stopping at its own slice boundary.
- [x] External-pilot blockers are explicit (§18) and distinguished from this plan's own scope
      (the M0 gate, legal engagement, support staffing — none of which this plan can resolve).

**Phase 10, and the UI/UX Engineering Plan's documentation phases (0 through 10), are
complete.** Implementation may begin at Slice I0, using §20's prompt for that slice, once the
owner authorizes starting.
