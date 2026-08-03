# Phase 1 — Current-Product Audit

_UI/UX Engineering Plan, Phase 1 output: a teardown (Keep / Remove / Merge / Replace /
Redesign) of every existing screen, against `docs/design/phase-0-product-behavior.md` as the
source of truth._

**Status:** DRAFT — audit and recommendations only. **No application code was modified for
this phase.** Read-only research against `apps/mobile/` (Flutter organizer app) and
`apps/guest-web/` (Next.js guest app) as they exist today, post-PV13.

---

## Method

Every screen/route in both apps was read from source (not inferred from filenames). Findings
are cited `file:line`. Verdicts are stated as confirmed / refuted / partially confirmed
against eleven specific behaviors called out for this pass, plus whatever else surfaced while
reading. Decisions D19–D22 (§ see `docs/design/phase-0-product-behavior.md`) inform which
findings are bugs-to-fix versus already-correct-per-decision.

---

## A. Screen inventory — `apps/mobile/` (Flutter organizer app)

| Screen | File | Teardown |
|---|---|---|
| Welcome | `features/onboarding/welcome_screen.dart` | **Keep** |
| Login | `features/onboarding/login_screen.dart` | **Keep** |
| Register | `features/onboarding/register_screen.dart` | **Keep** |
| Home (tab) | `features/home/home_screen.dart` | **Redesign** — progress bar reads the wrong field (§B.8); RESTRICTED Vinks vanish with no discovery path (§C.3) |
| Create Vink wizard | `features/create_vink/create_vink_screen.dart` | **Keep**, with the Add Person step redesigned |
| Add Person sheet | `features/create_vink/add_person_sheet.dart` | **Redesign** — premature "is in" copy (§B.5), manual-share-first framing needs primary/fallback inversion (§B.7), guest link can be shared while Vink is still DRAFT (§B.4) |
| Vink Lobby | `features/vink_lobby/vink_lobby_screen.dart` | **Redesign** — blocking Connecting screen (§B.2), progress bar wrong field (§B.8), expiry tone mismatch (§B.9), weak RESTRICTED/COMPLETED outcome copy (§B.11) |
| Activity (tab) | `features/activity/activity_screen.dart` | **Keep**, consolidation candidate (§F) |
| Profile (tab) | `features/profile/profile_screen.dart` | **Keep** |
| Nav shell | `app/nav_shell.dart` | **Keep** (structural) |

## B. Screen inventory — `apps/guest-web/` (Next.js guest app)

| Screen | File | Teardown |
|---|---|---|
| Root landing | `app/page.tsx` | **Keep** (static instructional page) |
| Join page shell | `app/join/[publicCode]/page.tsx` | **Keep** (routing only) |
| Join experience | `features/join/JoinExperience.tsx` | **Redesign** — blocking Loading state even for a returning, already-joined guest (§B.2) |
| Join form | `features/join/JoinForm.tsx` | **Redesign** — raw error strings leak through (§C.1); "no longer accepting new participants" copy misfires on a not-yet-opened Vink (§C.2) |
| Session view | `features/join/SessionView.tsx` | **Redesign** — this is the single highest-priority screen in the audit: wrong progress field (§B.8), no card visibility (§C.4), and the weakest money-outcome clarity of any screen in either app (§B.11) |
| Guest-token redeem page | `app/g/[token]/page.tsx` | **Keep** |
| `StatusBadge` | `components/StatusBadge.tsx` | **Redesign** — leaks raw `DRAFT` (§B.4) |
| `ProgressBar` | `components/ProgressBar.tsx` | **Replace** — must be re-driven off `contributionProgress` per D20, not `fundedAmountMinor` |
| `SimulationBanner`, `SignupConversion` | — | **Keep** |

---

## C. Findings against the eleven flagged behaviors

Condensed from full source review; every claim below is `file:line`-backed research, not
inference.

**1. Guest invitation delivery UI — refuted as deceptive, confirmed as a real gap.** Neither
app ever claims "invitation sent." Both correctly present Copy Link / Share / QR as manual
actions (`add_person_sheet.dart:236-250`, `vink_lobby_screen.dart:373-404`). But per D19 this
is now supposed to be the *fallback*, not the only path — and there's a data-model gap
underneath: guest identity capture takes only `displayName`, no email or phone
(`packages/application/src/guest.ts:90-96,159-165`), so automatic SMS/email delivery can't be
retrofitted as a pure UI change. This belongs in the backlog as its own scoped item, not
folded into Phase 1's screen redesign.

**2. Blocking "Connecting…" screen — confirmed, both apps.** Mobile lobby shows a bare
`VinkLoadingState(message: 'Connecting…')` (`vink_lobby_screen.dart:187-190`) whenever
`_snapshot` is null, with no parallel REST fetch to show cached data first — every cold entry
into a Vink blocks on a spinner. Guest-web's `JoinExperience.tsx:58-60,73,96` does the same
generic `Loading…` even for a *returning, already-joined* guest reopening a stored session —
someone who has already paid sees an undifferentiated spinner identical to a first-time
visitor's.

**3. Email used as display name — refuted.** No code path assigns an email into
`displayName`; the only `email` field in the system lives on member accounts and is never
collected at registration or shown as a name anywhere. Not an issue.

**4. Guest-facing raw "Draft" — confirmed, and reachable in practice, not just in theory.**
`StatusBadge.tsx:5` renders `'Draft'` for state `DRAFT`, directly violating the file's own
header comment promising no raw state name ever surfaces. This is reachable because
`inviteGuestCommand` allows adding a guest, and the mobile wizard mints their shareable link,
at step 2 of Create Vink — before the organizer taps "Open" (`create_vink_screen.dart:36-40`,
`add_person_sheet.dart:97`) — and the public pre-join endpoint has no state gate
(`packages/application/src/guest.ts:201-212` returns a summary for any state). A guest who
opens a link shared slightly too early sees a badge that literally says "Draft."

**5. Premature "is in" — confirmed in mobile, correctly gated in guest-web.**
`add_person_sheet.dart:211` — `'${guest.displayName} is in'` — fires the instant the
organizer *records* a guest, before any link has been sent or anyone has joined or paid.
Guest-web's parallel copy, `"You're in — your share is approved"`
(`SessionView.tsx:106-108`), correctly only renders after that guest's own contribution
succeeds. `FUNDED`'s "Everyone's in" badge is correctly gated by definition (state can't be
`FUNDED` unless everyone authorized) — that usage is right and should be the model for #5's
fix, not removed.

**6. Duplicated cards — refuted.** The temporary card renders exactly once
(`vink_lobby_screen.dart:441-481`); each participant's status renders exactly once
(`vink_lobby_screen.dart:355-369`). No literal duplication found in either app. (A softer,
non-duplicate redundancy — the organizer's own share appearing in both a dedicated "Your
share" card and their own participant-list row — is noted as a consolidation candidate in
§F, not a bug.)

**7. Manual-share-first as the primary CTA — confirmed.** It isn't just present, it's the
*entire* next step after naming a guest (`add_person_sheet.dart:204-257`) and a first-class,
always-visible section of the lobby (`vink_lobby_screen.dart:371-405`). Per D19 this framing
inverts once automatic delivery ships: automatic becomes the default expectation, manual
becomes an explicit opt-out control, not the only button on the screen.

**8. Contribution progress reads the wrong field — confirmed, systemically, in both apps.**
Every progress bar in the product — mobile lobby (`vink_lobby_screen.dart:272`), mobile Home's
active-Vink card (`home_screen.dart:123`), and guest-web's `ProgressBar`
(`ProgressBar.tsx:13`, fed from `SessionView.tsx:86-89`) — computes
`fundedAmountMinor / requiredAmountMinor`. That field is written exactly once, atomically, only
after every participant has been captured (`packages/application/src/contributions.ts:342-385`);
before that instant it sits at `$0` regardless of how many people have actually paid
(`packages/application/src/commands.ts:107`). This is precisely the D20 problem the Ink
Progress System decision exists to fix. The correct per-participant signal *already exists* —
`contributionStatusByParticipant` is already wired into the mobile participant list
(`apps/mobile/lib/core/models/vink.dart:105,114-131`, `participant_payment_state.dart:16-24`)
— but nothing today feeds it into a headline progress number, and the guest-web
`GuestVinkView` type doesn't carry any per-guest contribution-status field at all
(`apps/guest-web/lib/types.ts:18-25`), so a `contributionProgress` value isn't computable
guest-side without a small backend/type addition.

**9. Expiry messaging — partially confirmed: copy is right, visual tone is wrong.** The
sentence itself is calm and specific — `"This Vink expired before everyone joined in. Any
payments made are being refunded automatically."` (`vink_lobby_screen.dart:236`). But it sits
under an `EXPIRED` badge grouped into the same red "attention" tone
(`vink_status_badge.dart:33`, `StatusBadge.tsx:20`) as genuinely urgent problem states
(`FUNDING_REVERSAL`, `RESTRICTED`, `RECOVERY_REQUIRED/PENDING`). A calm sentence under a red
alarm-colored pill reads as an error, undercutting the Ink Progress System amendment's own
requirement that "an expired Vink should transition calmly to the closed financial outcome."

**10. Return/reconnect — refuted as broken; both apps correctly resume, modulo #2's loading
gap.** Mobile relaunch restores the session and lands on Home, never onboarding
(`auth_controller.dart:18-40`, `router.dart:22-28`); the lobby's WebSocket reconnects silently
in the background without re-blocking once a snapshot has landed
(`realtime_client.dart:40-44`). Guest-web reopening a stored link reads the saved session from
`localStorage` and resumes into `SessionView`, not back to the join form
(`session-storage.ts:15-24`, `JoinExperience.tsx:20-29`). The mechanism is sound; only the
first-paint experience (#2) and the guest's own payment memory (#11) need work.

**11. Money-outcome clarity in terminal states — confirmed, and guest-web is materially
worse than mobile.** Mobile states most outcomes explicitly (`CANCELLED` → "No one was
charged"; `EXPIRED`/`FUNDING_REVERSAL` → refund language) but goes vague exactly where it
matters most: `RESTRICTED` → `"This Vink needs your attention to finish resolving a
payment"` never says what happened to the money (`vink_lobby_screen.dart:235`); `COMPLETED`
never restates that the merchant was actually paid (`vink_lobby_screen.dart:232`). Guest-web
has no per-terminal-state copy at all: every non-contributable state — EXPIRED, CANCELLED,
COMPLETED, RESTRICTED, or simply OPEN-past-deadline — collapses to one identical sentence,
`"This Vink is no longer accepting contributions"` (`SessionView.tsx:128-130`). The root
cause is structural: the server never tells a guest whether *they personally* were charged —
`GuestVinkView` carries only membership status (`INVITED`/`JOINED`/`REMOVED`), not a payment
outcome (`apps/guest-web/lib/types.ts:18-30`, mirrored at
`packages/application/src/guest.ts:214-227`) — so the UI falls back to a component-local
`hasAuthorized` flag that resets on every page reload (`SessionView.tsx:46`). A guest who paid
and then reloads mid-Vink is shown the "Approve $X" button again — the backend call is
idempotent so nothing double-charges, but the screen is actively lying about what the guest
still needs to do.

## D. Other defects found while reading (not on the original list)

1. **Guest-web has no human-error-message layer; mobile does.** Mobile maps every backend
   error code to polished copy (`core/errors/human_errors.dart`). Guest-web renders
   `error.message` directly (`JoinForm.tsx:91-96`, `SessionView.tsx:111-116`), and several
   backend messages are internal debug strings, not user copy — one even leaks a raw internal
   Vink id (`packages/application/src/contributions.ts:134`).
2. **"No longer accepting new participants" misfires for a Vink that hasn't opened yet.**
   `isJoinable()` requires `state === 'OPEN'` (`packages/application/src/guest.ts:40-42`), so
   a guest opening a link while the Vink is still `DRAFT` sees "no longer" language implying
   it was open and has since closed — false, and compounds finding #4's raw "Draft" badge.
3. **`RESTRICTED` Vinks disappear from the one screen meant to surface them.** Home's
   "Active Vinks" filters out `RESTRICTED` as terminal (`home_providers.dart:13`), yet
   `home_screen.dart:189` still defines a `'RESTRICTED' => 'Needs attention'` label that can
   never render given that filter — dead code, and worse, a real navigational dead end: an
   organizer whose Vink needs attention has no path back to it from Home.
4. **Guest never sees the temporary card.** No card UI exists anywhere in `apps/guest-web` —
   may be intentional scope, but it removes the one artifact that would let a guest visually
   confirm the merchant charge actually happened, compounding finding #11.
5. **Home and Activity both independently re-fetch overlapping data** (`home_providers.dart`
   fetches a full snapshot per active Vink just for a participant count;
   `activity_providers.dart` fetches `/activity` per Vink to build one merged feed) — both
   explicitly commented as pilot-scale trade-offs, not hidden, but worth folding into any
   consolidation pass (§F).

---

## E. Conflicts with Phase 0 / decisions / hard rules

| # | Conflict | With | Severity |
|---|---|---|---|
| 1 | `StatusBadge.tsx` renders literal `"Draft"` for guests | D11 state-name-hiding rule; the file's own header comment | **High** — a hard-rule violation, reachable in normal use, not a hypothetical |
| 2 | Every progress bar reads `fundedAmountMinor`, which the backend intentionally never updates incrementally (D5) | D20's `contributionProgress` decision | **High** — blocks the entire Ink Progress System deliverable until fixed |
| 3 | Manual-share-first is the only and default framing | D19 (automatic is now canonical; manual is fallback) | **Medium** — correct today, needs to invert once delivery exists; don't let Phase 1 harden the old framing further |
| 4 | Guest-web's flat terminal-state message doesn't distinguish outcomes | Phase 0 §11/§12 money-message requirements, Spec §4.7 trust framing | **High** — a guest cannot tell if their money is safe |
| 5 | "Is in" applied to guest *creation*, not guest *participation* | D20/PV13's intent that state language track real financial/participation events | **Medium** |
| 6 | Expired shown in the same red tone as genuinely urgent recovery/restriction states | Amendment's "should transition calmly" requirement | **Medium** |

No conflicts were found with D21 (fee model) or D22 (percentage split) — both apps already
match those decisions exactly (no fee UI anywhere; only Equal/Custom exposed).

---

## F. Proposed screen consolidation

1. **Fold "Your share" into the participant list, don't duplicate the organizer's amount
   across two surfaces.** The organizer's own row in the Participants list and the dedicated
   "Your share" card both show the same allocated amount today. Keep one prominent
   "pay your share" affordance, but make it the organizer's own row in the same list
   everyone else appears in (reinforces D19's "organizer is a normal participant" framing)
   rather than a separate card above it.
2. **Merge the Add-Guest naming step and the manual-share step into one screen**, once D19's
   automatic-delivery framing is designed — right now they're sequential (name a guest →
   separate share sheet), which was reasonable when manual sharing was the only action but
   will feel like an extra step once "send it" is a single default action with sharing as a
   secondary control.
3. **Home and Activity should share one data-fetching source** rather than independently
   re-deriving overlapping Vink summaries (§D.5) — not a screen merge, but the two screens'
   underlying queries should consolidate before either is redesigned, to avoid redesigning on
   top of the N+1 pattern twice.
4. **Do not merge Join Form and Session View** — they correctly serve different moments
   (pre-join preview vs. joined live state) and the resume logic (§C.10) already depends on
   that separation.

---

## G. Customer-facing state mapping

All sixteen canonical D11 states, as currently labeled (mobile and guest-web are byte-identical
today — a real strength worth preserving deliberately, not accidentally, through the redesign).

| Backend state | Current label | Tone | Notes / flags |
|---|---|---|---|
| `DRAFT` | "Draft" | neutral | **Guest-facing exposure is a hard-rule violation (§C.4, §E.1) — must not be guest-reachable at all, not just relabeled.** Organizer-side "Draft" is fine. |
| `OPEN` | "Waiting for everyone" | neutral | Fine. Progress-bar data source needs fixing (§C.8), not the label. |
| `SUBMISSIONS_CLOSED` | "Wrapping up" | active | Fine. |
| `PROCESSING_GRACE` | "Confirming payments" | active | Fine. |
| `FUNDED` | "Everyone's in" | positive | Correctly gated — model for fixing premature "is in" elsewhere (§C.5). |
| `CARD_PROVISIONING` | "Getting your card ready" | active | Fine. |
| `CARD_READY` | "Ready to pay" | positive | Fine (organizer); guest never sees the card object itself (§D.4). |
| `PURCHASE_AUTHORIZED` | "Paying now" | active | Fine. |
| `SETTLING` | "Finishing up" | active | Fine. |
| `COMPLETED` | "Completed" | positive | Label fine; outcome copy underneath is too thin (§C.11). |
| `FUNDING_REVERSAL` | "Refunding" | attention (red) | Label/tone appropriately urgent. |
| `RECOVERY_REQUIRED` | "Resolving a shortfall" | attention (red) | Correctly urgent — organizer-only concern, never shown to participants (verified: guest types carry no recovery state). |
| `RECOVERY_PENDING` | "Resolving a shortfall" | attention (red) | Same label reused for two states — acceptable (participant doesn't need the distinction), flag only if organizer-side detail is ever needed. |
| `CANCELLED` | "Cancelled" | neutral | Fine; mobile states "no one was charged," guest-web does not (§C.11). |
| `RESTRICTED` | "Restricted" | attention (red) | Label is fine; the Vink becomes unreachable from Home (§D.3) and the copy underneath never explains money status (§C.11). |
| `EXPIRED` | "Expired" | **attention (red)** | **Tone conflicts with the amendment's calm-expiry requirement (§C.9) — recommend moving to neutral tone, keep the label.** |

---

## H. Prioritized redesign recommendations

**P0 — hard-rule violations and Ink Progress System blockers, must land before Phase 4/8:**
1. Guest-reachable `DRAFT` state (§C.4/§E.1) — fix at the source (gate `getPublicVinkView`
   and `inviteGuestCommand`'s link-minting on `state !== 'DRAFT'`, or ensure a DRAFT-state
   guest link/preview never renders enough for the state to matter), not just the badge.
2. Progress bars reading `fundedAmountMinor` instead of a `contributionProgress` value
   (§C.8/§E.2) — this blocks the entire Ink Progress System deliverable; needs the small
   backend/type addition for guest-web noted in §C.8 before Phase 4 can spec the vessel.
3. Guest-web's flat terminal-state messaging (§C.11) — needs a real per-guest payment-outcome
   field from the backend (not just new copy) before Phase 4 can write honest money-outcome
   contracts for the guest experience.

**P1 — trust and clarity gaps, should land in this redesign pass:**
4. Premature "is in" copy on guest creation (§C.5).
5. Blocking Connecting/Loading screens with no cached-data fallback, especially for a
   returning already-paid guest (§C.2).
6. Expired's red/attention tone versus its calm copy (§C.9, §E.6).
7. Weak `RESTRICTED`/`COMPLETED` outcome copy on mobile (§C.11).
8. Manual-share-first framing (§C.7/§E.3) — hold this specific screen's redesign until D19's
   automatic-delivery mechanism is scoped, so it isn't redesigned twice.

**P2 — consistency and error-handling gaps:**
9. Guest-web's missing human-error-message layer (§D.1).
10. "No longer accepting new participants" misfiring pre-open (§D.2).
11. `RESTRICTED` Vinks' navigational dead end from Home (§D.3).

**P3 — worth a product-owner decision, not purely a design fix:**
12. Guest never sees the temporary card (§D.4) — confirm whether this is intentional scope
    or a gap before designing around it either way.
13. Home/Activity data-fetching consolidation (§D.5/§F.3) — engineering cleanup, sequence
    before or alongside the visual redesign of those two screens, not after.

---

Next: Phase 2 (journey architecture) can proceed once the owner has reviewed this audit —
particularly the P0 items, since two of them (guest-reachable DRAFT, `contributionProgress`
data availability) affect what the journey maps and screen contracts can honestly promise.
