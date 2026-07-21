# Phase 2 — Journey Architecture

_UI/UX Engineering Plan, Phase 2 output: complete journey maps — screens, transitions,
success/failure/abandonment/return states — for the redesign. Source of truth:
`docs/design/phase-0-product-behavior.md`, `docs/design/phase-1-screen-audit.md`,
`docs/spec/decision-log.md` (D1–D25), `docs/spec/open-questions.md`, and the verified
`packages/domain` state machines (`vink-state-machine.ts`, `contribution-state-machine.ts`)._

**Status:** DRAFT. **Documentation only — no Flutter, Next.js, backend, API, domain,
database, or infrastructure code was modified to produce this document.** Journeys below
describe **approved target behavior**, which in several places exceeds what's built today;
every such promise is explicitly labeled with its **implementation dependency** so Phase 3/4
don't silently assume it exists.

---

## 0. Journey-level decisions (recorded before mapping)

Three decisions were ratified and are now in `docs/spec/decision-log.md`; every journey below
is built to match them, not around them:

- **D23** — guests never see `DRAFT` in any form. Automatic invitations send only at
  `VINK_OPENED` (`DRAFT → OPEN`). A guest reaching a valid link before that sees a distinct
  **"This Vink isn't open yet"** state, no contribution action, auto-transitioning when the
  Vink opens.
- **D24** — both clients consume one server-provided `contributionProgress` projection
  (`confirmedAmountMinor`, `totalAmountMinor`, `confirmedParticipantCount`,
  `totalParticipantCount`), derived from participant assigned shares + confirmed contribution
  states — never `fundedAmountMinor`. Guest responses additionally carry a viewer-specific
  `contributionStatus` (the guest's own outcome only — never another participant's).
  Percentage split stays hidden (D22); no fee model exists (D21) — neither is touched by this
  phase.
- **D25** — guest terminal states distinguish **completed / expired / cancelled / return
  pending / returned / recovery-required**. A guest whose own contribution already reached a
  confirmed state is never re-offered the contribution action, on reload, reconnect, or
  return.

Two further gaps this document originally left open were resolved by the owner immediately
after the first draft, and are folded in throughout (marked inline wherever they apply):

- **D27** — members receive the same automatic SMS/email delivery as guests (D19), through
  the same pipeline; no separate in-app inbox/notification surface. Amends D19's original
  "in-app invitations" language for members.
- **D26** — organizer session expiry (refresh token dead) shows an in-place re-auth prompt,
  not a global redirect; the organizer's in-progress screen state resumes after re-auth.

Both are decided, neither is built — see §C (capability matrix) and §I (dependencies) for
exactly what building each requires.

### Vocabulary used throughout this document

**`contributionProgress` projection** (D24, both clients):
```
{
  confirmedAmountMinor: number,       // sum of allocated shares whose contribution is "confirmed" (see below)
  totalAmountMinor: number,           // vink.requiredAmountMinor
  confirmedParticipantCount: number,
  totalParticipantCount: number
}
```
A contribution counts as **confirmed** once it reaches `AUTHORIZED` or later in
`packages/domain/src/contribution-state-machine.ts` (i.e. the participant's payment is no
longer at risk of silently vanishing — this is deliberately *before* the session-wide capture
in `resolveFunding`, so the vessel can move well before the last person pays, unlike
`fundedAmount`).

**Guest `contributionStatus` vocabulary** (D24/D25, viewer-specific, never another
participant's data):

| Guest-facing status | Underlying contribution state(s) | Contribution action offered? |
|---|---|---|
| `not_started` | no contribution row yet / `CREATED` | Yes — "Approve $X" |
| `pending` | `AUTHORIZATION_PENDING`, `RESOLUTION_PENDING` | No — show "confirming," disable the action, don't error |
| `declined` | `DECLINED` | Yes — a **new** attempt (never a retry of the same one, per the domain's own DECLINED-is-terminal rule) |
| `confirmed` | `AUTHORIZED`, `CAPTURE_PENDING`, `CAPTURED`, `SETTLED` | **Never again** — this is the D25 guarantee |
| `cancelled` | `CANCELLATION_PENDING`, `CANCELLED` | No — never charged, calm "you weren't charged" copy |
| `return_pending` | `REFUND_PENDING`, `REFUND_FAILED` (internal retry loop, not guest-visible as a failure) | No — "your payment is being returned" |
| `returned` | `REFUNDED` | No — "your payment was returned" |

Full money-outcome copy rules are in §10.

---

## 1. Organizer creation — need to split a checkout total → Vink is open

- **Entry condition:** signed-in organizer on Home, taps "Start a Vink."
- **User intention:** turn a real total into a payable group session before the moment
  (register, checkout) passes.
- **Ordered steps:** (1) Purpose/category (2) Total amount (3) Add people — member lookup or
  guest by name (4) Split — Equal or Custom only, D22 (5) Review (6) Open.
- **Screens/surfaces:** `create_vink_screen.dart` (5-step wizard), `add_person_sheet.dart`.
- **Information shown:** running total, per-person allocation live as people/split change,
  organizer's own share (can be $0, custom, or equal — Phase 0 §3).
- **Primary action per step:** step 1–4 "Next"; step 5 "Open Vink" (single, unambiguous —
  fixes the Phase 1 §D of the earlier draft's noted duplicate "Start a Vink" defect from
  PV13/screenshot passes, confirmed already fixed in current code, not reopened here).
- **State transitions:** vink created in `DRAFT` (`packages/application/src/commands.ts`) →
  `VINK_OPENED` event → `OPEN` (`vink-state-machine.ts:76-78`). **No guest link is
  distributable/functional before this transition completes** (D23 — this is a hard gate, not
  a copy choice).
- **Realtime behavior:** none needed pre-open (no other viewers yet, except a guest who
  already holds a pre-open link — see §6).
- **Interruption and return behavior:** wizard state should survive app backgrounding
  mid-creation (not yet verified as built — flag for Phase 4 screen contract, not assumed).
- **Loading behavior:** local/instant until "Open," which is the first real network write of
  consequence (vink creation itself is created progressively per step in current code —
  confirm in Phase 4 whether to keep incremental persistence or defer to one commit at Open).
- **Error and retry behavior:** username-not-found at Add People currently dead-ends without
  surfacing the guest-invite alternative in the moment (Phase 1 journey draft, §1) — target:
  offer "add as guest instead" inline on a failed lookup, not as a separately-discovered
  control.
- **Abandonment points:** total/purpose entry (no real stakes yet, low-cost abandonment);
  Add People if a friend can't be found and the guest fallback isn't obvious (real
  abandonment risk, per above).
- **Loading/duplicate-action note:** "Open Vink" must be a single confirmed action —
  duplicate-tap protection already exists in principle per D13's command model
  (idempotent by design at the application layer) but the specific UI debounce needs
  verification in Phase 4.
- **Success condition:** vink reaches `OPEN`; every added guest's link (if generated) becomes
  live and automatic delivery (D19) fires at this exact instant.
- **Terminal outcomes:** none yet — this journey's only real terminus is "Vink is open,"
  handing off to §2.
- **Current implementation gap:** guest links today are generated and functional
  **immediately** on adding a guest at step 3, before Open (Phase 1 §C.4) — this must change
  to satisfy D23; that's a backend gate (`getPublicVinkView` / `inviteGuestCommand`), not a
  UI-only fix.

---

## 2. Organizer waiting — Vink is open → everyone is in

- **Entry condition:** vink is `OPEN`; organizer is on the Lobby.
- **User intention:** know, at a glance, who still needs to pay, without pinging people
  blindly.
- **Ordered steps:** (1) land on Lobby (2) watch `contributionProgress` move as people
  confirm (3) optionally nudge/re-share a specific holdout (4) reach "everyone's in."
- **Screens/surfaces:** `vink_lobby_screen.dart`.
- **Information shown:** the ink vessel driven by `contributionProgress` (D20/D24, not
  `fundedAmountMinor`), per-participant status list (already correctly wired,
  `contributionStatusByParticipant`), organizer's own share inline in that same list (§F.1
  consolidation from Phase 1).
- **Primary action per step:** "Pay my share" (if organizer hasn't yet — same path as
  everyone, Phase 0 §3); otherwise the screen is passive/observational until FUNDED.
- **State transitions:** `OPEN → SUBMISSIONS_CLOSED` (`SUBMISSION_DEADLINE_REACHED` or
  `ALL_CONTRIBUTIONS_AUTHORIZED`) `→ PROCESSING_GRACE → FUNDED` (D5 single resolver,
  `FUNDING_CONFIRMED`) — the only point this whole session's funding is decided, once.
- **Realtime behavior:** live WebSocket snapshot updates per confirmed contribution — this is
  what makes `contributionProgress` move smoothly instead of jumping (the actual point of
  D20).
- **Interruption and return behavior:** see §11/§12 (Reconnect/Resume journeys) — first paint
  must not block on a fresh "Connecting…" (Phase 1 §C.2 fix).
- **Loading behavior:** cached last-known snapshot shown immediately; realtime channel
  upgrades it in place.
- **Error and retry behavior:** a stalled participant (declined, needs a new attempt) should
  be visibly distinguishable from a merely-slow one — today the participant row already
  supports this (`paymentStateFor`), just needs to stay correct once driven by the new
  projection.
- **Abandonment points:** organizer leaves the app while waiting — must not lose the
  in-progress session; confirmed working today via app-relaunch session restore (Phase 1
  §C.10).
- **Success condition:** `contributionProgress.confirmedAmountMinor ==
  contributionProgress.totalAmountMinor` and vink reaches `FUNDED`.
- **Terminal outcomes:** `FUNDED` (success, hands off to §3) or `EXPIRED` (failure, →§7).
- **Current implementation gap:** `contributionProgress` doesn't exist yet server-side — this
  entire journey's headline visualization is blocked on the D24 API addition (§7 of this doc).

---

## 3. Organizer payment — everyone is in → merchant payment complete

- **Entry condition:** vink `FUNDED`.
- **User intention:** get a spendable card fast, pay the merchant, know it worked.
- **Ordered steps:** (1) automatic card provisioning begins (2) card ready (3) organizer
  swipes at the (simulated) merchant (4) settlement confirms.
- **Screens/surfaces:** `vink_lobby_screen.dart` (`_CardCard`).
- **Information shown:** card last-four, spending limit (= funded amount exactly, no slack),
  live state label.
- **Primary action per step:** none from the organizer during provisioning (automatic); no
  in-app "pay" button — the card is used at a real/simulated terminal, outside the app.
- **State transitions:** `FUNDED → CARD_PROVISIONING → CARD_READY` (automatic) →
  `PURCHASE_AUTHORIZED` (merchant swipe, first-merchant lock) `→ SETTLING →
  COMPLETED` (`SETTLEMENT_MATCHED`) or `→ RECOVERY_REQUIRED`
  (`SETTLEMENT_OVERAGE_DETECTED`, →§9).
- **Realtime behavior:** each step pushes a snapshot update so the organizer watches the card
  go from provisioning → ready → paying → done without polling.
- **Interruption and return behavior:** identical to §2 — resume shows current state
  immediately, no re-block.
- **Loading behavior:** `CARD_PROVISIONING` needs its own clear "getting your card ready"
  moment (already labeled correctly today) rather than reading as another generic spinner.
- **Error and retry behavior:** `CARD_PROVISIONING_FAILED → FUNDING_REVERSAL → EXPIRED` —
  calm refund messaging already exists (Phase 1 §C.9's copy is fine; only the badge tone is
  wrong, fixed in §10).
- **Abandonment points:** none meaningful — this phase is short and mostly automatic/external.
- **Success condition:** `SETTLEMENT_MATCHED → COMPLETED`, restated explicitly as "the
  merchant was paid $X" (fixes Phase 1 §C.11's thin `COMPLETED` copy).
- **Terminal outcomes:** `COMPLETED` (success) or `RECOVERY_REQUIRED` (overage, →§9).
- **Current implementation gap:** none structural — this journey is close to correct today;
  the only fix needed is the `COMPLETED` copy (§10) and the `EXPIRED`/urgent-tone conflation
  (§10) inherited from §2/§7.

---

## 4. Existing-member contribution — invitation received → member's part is done

- **Entry condition:** organizer has added the member (existing account) to an `OPEN` vink.
- **User intention:** understand what's being asked, pay confidently, know it's done.
- **Ordered steps:** (1) discover the Vink (2) open it (3) review own share (4) contribute
  (5) confirmation.
- **Screens/surfaces:** Home list (discovery today), Lobby (identical screen to organizer's,
  minus organizer-only controls).
- **Information shown:** organizer, purpose, own allocated amount, group progress
  (`contributionProgress`).
- **Primary action per step:** "Pay my $X" via the same `/contributions/authorize` path as
  the organizer (Phase 0 §3 — no special-casing by role).
- **State transitions:** member's own contribution `CREATED → AUTHORIZATION_PENDING →
  AUTHORIZED` (or `DECLINED`, new attempt) `→ CAPTURE_PENDING → CAPTURED → SETTLED` (session
  capture at `resolveFunding`).
- **Realtime behavior:** identical Lobby, so identical live updates.
- **Interruption and return behavior:** identical to organizer's (session persists, resume
  works).
- **Loading behavior:** same cached-first-paint fix as §2.
- **Error and retry behavior:** a declined contribution should clearly invite a **new**
  attempt, not silently look stuck (the domain already models DECLINED as terminal-per-attempt
  — the UI needs to make "try again" obviously mean "a new attempt," not "retry the same
  one").
- **Abandonment points:** discovering the Vink at all — **resolved as intended behavior
  (D27):** members receive the same automatic SMS/email delivery as guests (D19), through the
  same pipeline; no separate in-app inbox/notification surface is being built.
  **Correction to this document's own earlier draft:** today's actual fallback is worse than
  previously stated here — `GET /api/v1/vinks` (Home's data source) calls `listMyVinks` →
  `listVinksByOrganizer` (`packages/application/src/queries.ts:137-139`), which returns
  **only Vinks the signed-in user organized**. There is no query that lists Vinks a user
  merely participates in. A member added by username today has **no in-app discovery path at
  all** — not even passive Home-list visibility — only a direct deep link
  (`/vinks/:vinkId`, `apps/mobile/lib/app/router.dart:38-39`) they'd have to be sent by some
  other means, and no such link is even generated for members today (only guests get a
  minted `joinUrl`; adding a member by username returns just the participant record, no
  link). This is a real information-architecture gap, addressed in Phase 3 (Home must list
  participant Vinks, not only organizer-owned ones).
- **Success condition:** member's own contribution reaches `AUTHORIZED` or later.
- **Terminal outcomes:** same set as the organizer's Lobby (member sees the same Vink-level
  outcomes; members are never subject to `RESTRICTED`, which is organizer-only per Phase 0
  §11).
- **Current implementation gap:** automatic delivery (D19/D27) isn't built yet — same
  underlying dependency as guest delivery (contact capture + a send provider); mobile's own
  `register_screen.dart` doesn't even collect email today (Phase 1 audit), so a member's own
  contact info isn't captured either. Independent of delivery, Home's own query needs to
  expand to participant Vinks (Phase 3) so a member has a durable way back in, not just a
  one-time link.

---

## 5. Guest contribution — personalized link received → guest's part is done

_This is the journey D19/D23/D24/D25 change the most._

- **Entry condition:** guest receives an automatic SMS/email (D19, target) or clicks a
  manually-shared link (§6), and the Vink is `OPEN` or later.
- **User intention:** understand exactly what's being asked with zero setup, pay without
  friction, trust that it went through.
- **Ordered steps:** (1) open link (2) see organizer/purpose/exact share (3) name yourself
  (4) approve the amount (5) confirmation, persistent across return visits.
- **Screens/surfaces:** `JoinExperience.tsx` → `JoinForm.tsx` → `SessionView.tsx`.
- **Information shown:** organizer, purpose, exact guest share, group `contributionProgress`,
  own `contributionStatus` (D24) — **not** any other participant's individual status, and
  **no fee line** (D21 — the optional API-provided fee slot stays absent).
- **Primary action per step:** step 3 "Join," step 4 "Approve $X" — exactly one primary
  action per screen, never two competing CTAs.
- **State transitions:** guest joins (membership, not payment) → own contribution
  `CREATED → AUTHORIZATION_PENDING → AUTHORIZED → CAPTURE_PENDING → CAPTURED → SETTLED`.
- **Realtime behavior:** group `contributionProgress` updates live as others pay; the guest's
  own `contributionStatus` only changes on their own action or a server push confirming it.
- **Interruption and return behavior (D25, the core fix):** reopening the link — same
  session, tab close/reopen, phone lock/unlock — re-resolves `contributionStatus` from the
  server, not a local flag. If `confirmed`, the contribute action is **never** shown again,
  regardless of how many times the page reloads.
- **Loading behavior:** cached-first-paint (server-rendered invite context per the original
  plan's Phase 13 requirement) — no bare "Loading…" for a returning, already-paid guest
  (Phase 1 §C.2 fix).
- **Error and retry behavior:** guest-web needs its own human-error-message layer (Phase 1
  §D.1) — raw backend strings must never reach this screen.
- **Abandonment points:** pre-join (sees the ask, decides not to join — fine, no data
  committed); mid-payment failure (needs a calm, specific retry path, not a dead end).
- **Success condition:** own `contributionStatus == confirmed`.
- **Terminal outcomes:** the full D25 set — completed / expired / cancelled / return pending
  / returned / recovery-required (exact copy in §10).
- **Current implementation gap:** `contributionStatus` doesn't exist server-side yet (D24);
  `SessionView.tsx` currently derives "paid" from a component-local flag that resets on
  reload — this is the single most important gap this phase surfaces, and it blocks D25 until
  fixed.

---

## 6. Guest manual-share fallback — organizer shares link/QR → guest's part is done

- **Entry condition:** organizer explicitly chooses manual sharing instead of (or in addition
  to) automatic delivery (D19 — manual is now the fallback, not the default).
- **User intention:** organizer's — get the link into a specific person's hands directly
  (e.g., they're standing right there); guest's intention is identical to §5 from the moment
  they open the link.
- **Ordered steps:** organizer: (1) tap "Share manually instead" (2) Copy Link / Share sheet /
  QR (3) hand it off. Guest: identical to §5 steps 1–5 from link-open onward.
- **Screens/surfaces:** `add_person_sheet.dart` / lobby's Invite card (organizer side);
  `JoinExperience.tsx` onward (guest side, unchanged from §5).
- **Information shown:** organizer sees the same QR/link/share controls that exist today
  (Phase 0 §5) — just reframed as an explicit secondary action, not the only button.
- **Primary action per step:** organizer: "Share manually instead" (secondary, not
  foregrounded); guest: identical to §5.
- **State transitions:** identical to §5 once the guest is in.
- **Realtime behavior / interruption / loading / error / abandonment / success / terminal:**
  identical to §5 — the delivery mechanism doesn't change what happens after the link is
  opened.
- **D23 interaction:** a manually-shared link generated *before* the Vink opens (organizer
  shares early, e.g. from within the Create-Vink wizard at step 3) is exactly the case D23's
  "not open yet" state exists for — this journey is where that state is actually reached most
  often in practice, since automatic delivery (§5) can't fire before Open at all, but a manual
  link can be copied and sent immediately.
- **Current implementation gap:** manual sharing is currently the *only* path and is
  foregrounded as such (Phase 1 §C.7) — needs reframing to secondary once automatic delivery
  exists; and the pre-open "not open yet" gate (D23) isn't built yet, so today an early
  manual share leaks the raw "Draft" badge (Phase 1 §C.4).

---

## 7. Expiry journey

- **Entry condition:** `PROCESSING_GRACE` reaches its deadline without full authorization
  (`FUNDING_FAILED`), or `FUNDING_REVERSAL` completes (card issuance failed post-funding).
- **User intention (all viewers):** understand, without alarm, that the Vink didn't happen
  and know what's happening to any money already given.
- **Ordered steps:** (1) deadline/reversal trigger (server-side, PG-clock-driven sweep,
  Phase 0 §8) (2) vink → `EXPIRED` (3) any captured contributions begin refund (→§9)
  (4) all viewers see the calm closed state.
- **Screens/surfaces:** Lobby (organizer/member), `SessionView.tsx` (guest).
- **Information shown:** what happened (deadline passed / card couldn't be issued) and each
  viewer's own money outcome (never charged vs. being refunded vs. refunded).
- **Primary action per step:** none — this is a passive, informational terminal state; no
  action is available or expected.
- **State transitions:** `PROCESSING_GRACE → EXPIRED` or `FUNDING_REVERSAL → EXPIRED`
  (`FUNDING_FAILED` / `FUNDING_REVERSAL_COMPLETED`, both emit `VinkExpired`).
- **Realtime behavior:** push to every connected viewer the instant the transition commits —
  no one should have to refresh to learn their Vink expired.
- **Interruption and return behavior:** returning later must show the same calm state, not a
  stale "waiting" screen.
- **Loading behavior:** n/a (terminal, no live data to wait on beyond the initial fetch).
- **Error and retry behavior:** n/a for the guest/member (nothing to retry); organizer sees
  no retry option either — expiry is not reversible (Phase 0 §8).
- **Abandonment points:** n/a (terminal).
- **Success condition:** n/a — this is itself a defined-failure outcome, not a success path;
  "success" for this journey is that every viewer understands their own outcome correctly.
- **Terminal outcomes:** guest sees `expired` (never charged) or is routed into §9
  (`return_pending`/`returned`) if they had already been captured.
- **Current implementation gap:** copy is already calm and correct (Phase 1 §C.9); the
  **badge tone is wrong** — `EXPIRED` currently renders in the same red "attention" tone as
  genuinely urgent states (`FUNDING_REVERSAL`, `RESTRICTED`, `RECOVERY_REQUIRED/PENDING`),
  undercutting the calm copy. Target: move `EXPIRED` to a neutral tone (§10, §E table).

---

## 8. Cancellation journey

- **Entry condition:** organizer cancels an `OPEN` vink (`ORGANIZER_CANCELLED`).
- **User intention:** organizer changed their mind or plans fell through; everyone else needs
  to know instantly and without worry.
- **Ordered steps:** (1) organizer taps Cancel (2) confirmation prompt — irreversible, so this
  needs a real confirm step, not a single tap (3) vink → `CANCELLED` (4) all viewers notified.
- **Screens/surfaces:** Lobby (organizer initiates); Lobby/`SessionView.tsx` (everyone else
  receives).
- **Information shown:** "cancelled by the organizer," explicit "no one was charged" (already
  correct copy on mobile per Phase 0 §11; needs to exist on guest-web too, per §10).
- **Primary action per step:** organizer: "Cancel Vink" → confirm. Everyone else: none
  (informational).
- **State transitions:** `OPEN → CANCELLED` (`ORGANIZER_CANCELLED`, emits `VinkCancelled`) —
  note this transition only exists from `OPEN` in the current domain model; there is no
  modeled cancellation path from `DRAFT` (Phase 0's known gap, unchanged by this phase) or
  from any state after `SUBMISSIONS_CLOSED`.
- **Realtime behavior:** immediate push to all connected participants/guests.
- **Interruption and return behavior:** returning later shows the same calm cancelled state.
- **Loading behavior:** n/a.
- **Error and retry behavior:** cancellation itself could fail (network) — organizer needs a
  clear retry, distinct from the Vink actually being cancelled.
- **Abandonment points:** n/a.
- **Success condition:** vink reaches `CANCELLED`; every viewer's `contributionStatus`
  resolves to `cancelled`.
- **Terminal outcomes:** `cancelled` for every participant/guest — no money moved for anyone,
  ever, since `CANCELLED` is only reachable pre-funding.
- **Current implementation gap:** guest-web has no cancellation-specific copy at all today
  (falls into the same flat "no longer accepting contributions" message, Phase 1 §C.11) —
  needs the distinct `cancelled` category from D25.

---

## 9. Refund/return journey

- **Entry condition:** an `EXPIRED` (or `FUNDING_REVERSAL`-originated `EXPIRED`) vink has one
  or more contributions already `CAPTURED`.
- **User intention:** know that money that was taken is coming back, and then know when it
  has.
- **Ordered steps:** (1) vink expires with captured contributions (2) each such contribution:
  `CAPTURED → REFUND_PENDING` (`REFUND_REQUIRED`, emits `RefundRequested`) (3) provider
  refund (4) `REFUND_PENDING → REFUNDED` (`REFUND_SUCCEEDED`, emits `RefundCompleted`) or, on
  a retryable provider error, `→ REFUND_FAILED` (emits `RefundFailed`), retried automatically
  (`REFUND_RETRIED → REFUND_PENDING` again) — this loop is a backend job, never a guest
  action.
- **Screens/surfaces:** `SessionView.tsx` (guest), Lobby (organizer/member).
- **Information shown:** "your payment is being returned" while `REFUND_PENDING`/
  `REFUND_FAILED` (collapsed to one guest-facing `return_pending` category — the internal
  retry-vs-first-attempt distinction is not the guest's concern); "your payment was returned"
  once `REFUNDED`.
- **Primary action per step:** none — refunds are fully automatic; no viewer ever needs to
  request or confirm a refund.
- **State transitions:** per contribution, as above; the vink itself stays `EXPIRED`
  throughout — refunds don't change vink state.
- **Realtime behavior:** push the `return_pending → returned` transition the instant it
  commits.
- **Interruption and return behavior:** returning during `return_pending` must keep showing
  that state, never silently drop back to a generic "expired" message that omits the
  in-progress refund.
- **Loading behavior:** n/a beyond initial fetch.
- **Error and retry behavior:** `REFUND_FAILED` is explicit and retried server-side (Phase 0
  §11 — "never silently swallowed") — but it must **not** surface to the guest as an alarming
  "refund failed" message, since the system is already retrying; guest-facing copy stays at
  `return_pending` through the retry loop.
- **Abandonment points:** n/a — fully passive from every viewer's side.
- **Success condition:** contribution reaches `REFUNDED`.
- **Terminal outcomes:** `returned`.
- **Current implementation gap:** guest-web currently has **no visibility into this at all** —
  the flat terminal message doesn't distinguish "never charged" from "charged and being
  refunded" from "refunded" (Phase 1 §C.11, the same root cause as §5/§7/§8: no
  `contributionStatus` field exists yet).

---

## 10. Recovery journey

- **Entry condition:** `SETTLING → RECOVERY_REQUIRED` (`SETTLEMENT_OVERAGE_DETECTED` — the
  merchant settled for more than the funded amount).
- **User intention:** organizer needs to resolve their own off-session obligation;
  participants/guests need reassurance this has nothing to do with them.
- **Ordered steps (organizer-only actions):** (1) platform fronts the overage immediately, no
  visible action needed from anyone yet (2) `RECOVERY_REQUIRED → RECOVERY_PENDING`
  (`RECOVERY_STARTED`) (3) off-session charge attempt(s) against the organizer, up to 3
  retries (4) `RECOVERY_RESOLVED → COMPLETED` or `RECOVERY_DEFAULTED → RESTRICTED`.
- **Screens/surfaces:** Lobby (organizer sees full detail; per Phase 0 §11, participants are
  never charged and this is enforced in code, not just by UI); `SessionView.tsx` (guest —
  D25's `recovery-required` category only).
- **Information shown (organizer):** clear "we're resolving a shortfall with your payment
  method" — Phase 1 flagged `RESTRICTED`'s copy as too vague about money; target: state
  plainly that the organizer's own payment method is being charged, never the group's.
- **Information shown (guest/member):** **their own `contributionStatus` is already
  `confirmed`** (they were captured as part of `FUNDED`, long before settlement) — the guest
  should see their own "you're in, paid" state, calmly, with no implication that anything is
  still pending on their end. This is exactly D25's reason for a distinct
  `recovery-required` category: it exists so the guest-facing screen has an explicit signal
  to *not* fall back into a generic "processing" or "action needed" state just because the
  vink itself hasn't reached `COMPLETED` yet.
- **Primary action per step:** organizer: none in-app (off-session charge is automatic,
  matching Phase 0 §11 — no in-app "pay the shortfall" button is implied or needed); guest:
  none, ever.
- **State transitions:** as listed above; note participants/guests are structurally
  untouched — no contribution-level transition occurs during recovery.
- **Realtime behavior:** organizer sees live updates through the retry ladder; guest/member
  see no change at all (their own status was already final).
- **Interruption and return behavior:** organizer returning mid-recovery sees current retry
  status; guest/member returning still sees their own already-`confirmed` status, unaffected.
- **Loading behavior:** n/a for guest/member; organizer sees standard live-update behavior.
- **Error and retry behavior:** retries are server-driven (max 3, Phase 0 §11); organizer UI
  should reflect attempt count/next-attempt timing if available, without implying the
  organizer must do anything manually mid-ladder.
- **Abandonment points:** n/a.
- **Success condition:** `RECOVERY_RESOLVED → COMPLETED` (same completed outcome as §3's
  normal path, from the organizer's perspective).
- **Terminal outcomes:** `COMPLETED` (resolved) or `RESTRICTED` (defaulted — organizer-only
  consequence, Phase 0 §11; never surfaces to guests/members at all).
- **Current implementation gap:** mobile's `RESTRICTED` copy is too vague about money (Phase
  1 §C.11); guest-web has no `recovery-required` category at all today (falls into the same
  flat message) — both need the D25 vocabulary wired in.

---

## 11. Reconnect journey

_Not a single vink-state transition — a cross-cutting behavior for every journey above,
covering the realtime channel specifically (as opposed to §12's full app-relaunch case)._

- **Entry condition:** an already-open Lobby/`SessionView` loses and regains its
  WebSocket/network connection (brief backgrounding, network blip, phone lock).
- **User intention:** not to notice, ideally.
- **Ordered steps:** (1) connection drops silently (2) client keeps showing last-known state,
  not a spinner (3) client reconnects in the background (4) a fresh snapshot reconciles any
  missed updates.
- **Screens/surfaces:** all live screens (Lobby, `SessionView.tsx`).
- **Information shown:** unchanged from before the drop, until the reconciling snapshot
  arrives.
- **Primary action per step:** none — fully automatic.
- **State transitions:** none of the vink's own; purely a transport-layer concern.
- **Realtime behavior:** this journey *is* the realtime behavior — confirmed already correct
  on mobile (`RealtimeClient._scheduleReconnect()`, Phase 1 §C.10) once a first snapshot has
  landed. Guest-web's underlying session-fetch-on-mount pattern achieves the same effect for
  page-level reconnects.
- **Interruption and return behavior:** this journey *is* about interruption/return.
- **Loading behavior:** must never re-show a blocking spinner for a brief drop — only a truly
  cold entry (§12, or §5/§2's first paint) should ever block, and even then on cached data
  first per the P0 fixes already specified.
- **Error and retry behavior:** reconnect attempts happen silently with backoff; only a
  prolonged, total failure (device offline) should surface any indicator, and it should be
  a quiet "reconnecting" affordance, not an error.
- **Abandonment points:** n/a.
- **Success condition:** local state matches server state after reconciliation, with no user
  action required.
- **Terminal outcomes:** n/a (this journey has no terminus of its own).
- **Current implementation gap:** none identified — confirmed working on both platforms in
  Phase 1. Explicitly called out here so Phase 4 doesn't accidentally regress it while
  redesigning the loading states around it.

---

## 12. Resume journey

_App-relaunch / cold-return, as distinct from §11's live-connection reconnect._

- **Entry condition:** organizer force-quits and reopens the mobile app; guest closes and
  later reopens the browser tab/link.
- **User intention:** pick up exactly where they left off, with zero re-setup.
- **Ordered steps (organizer):** (1) app launch (2) silent token restore + `/api/v1/me`
  (3) land on Home, not onboarding. **(guest):** (1) reopen the same link (2) stored session
  token re-resolves (3) land on `SessionView` (or the D23 "not open yet" state, or a D25
  terminal state), not the join form.
- **Screens/surfaces:** full app (organizer); `JoinExperience.tsx` (guest).
- **Information shown:** current real state, not a stale cached copy from before closing.
- **Primary action per step:** none beyond normal navigation once resumed.
- **State transitions:** none caused by resuming itself — resume only needs to correctly
  reflect whatever transitions happened while away.
- **Realtime behavior:** on resume, always fetch a fresh snapshot before relying on the
  realtime channel (the cached-first-paint principle from §2/§5 applies here too — show
  last-known-good instantly, then reconcile).
- **Interruption and return behavior:** this journey *is* interruption/return, cold-start
  case.
- **Loading behavior:** organizer resume is confirmed correct (Phase 1 §C.10 — no onboarding
  flash). Guest resume is confirmed correct **except**: (a) the blocking "Loading…" first
  paint (§C.2, shared fix with §5/§11) and (b) silently falling back to the join form on an
  expired 7-day token with no explanation (a real gap — target: an explicit "this link has
  expired" state, distinct from "never joined," so a guest who genuinely participated isn't
  shown join-language as if they hadn't).
- **Error and retry behavior:** organizer session truly expired (refresh token dead) —
  **resolved (D26):** an in-place re-authentication prompt (modal/sheet) appears over the
  current screen rather than a global redirect; on success, the organizer's in-progress state
  (mid-wizard, or the specific Lobby they were viewing) resumes normally. Not yet built —
  today `ApiException.isAuthError` is defined but nothing listens for it
  (`api_client.dart:9,26-34`; `api_exception.dart:11`), so a mid-session expiry currently
  shows whatever that screen's generic error handling does. Building D26 requires both a
  global 401 listener (not per-screen handling) and state-preservation in the Create Vink
  wizard/Lobby specifically, so re-auth doesn't just prompt correctly but actually has
  something intact to resume into.
- **Abandonment points:** n/a for a returning user with a live session; a user who never
  resumes simply doesn't reappear — no design implication.
- **Success condition:** resumed screen matches current server truth within one fetch.
- **Terminal outcomes:** n/a (resume hands off into whatever journey/state the vink is
  actually in).
- **Current implementation gap:** organizer session-expiry recovery (D26 decided, not yet
  built — needs the global listener + wizard/Lobby state preservation above); guest
  link-expiry messaging (silent fallback today, needs the explicit "this link has expired"
  state described above); both first-paint loading fixes shared with other journeys.

---

## A. End-to-end journey maps

**Organizer, full path:**
```
Home → Create (§1) → OPEN → Lobby waiting (§2) → FUNDED → card (§3) → COMPLETED
                         ↳ EXPIRED (§7) ↳ CANCELLED (§8)
                                                      ↳ RECOVERY_REQUIRED (§10) → COMPLETED | RESTRICTED
```

**Member, full path:**
```
(no invitation surface today — gap, §4) → Lobby → contribute (§4) → same terminal set as organizer's Lobby, minus RESTRICTED
```

**Guest, full path (automatic delivery, target):**
```
SMS/email at VINK_OPENED (D19/D23) → link → OPEN?
   NOT YET OPEN → "not open yet" (D23) → auto-transitions when OPEN
   OPEN → join (§5) → contribute → confirmed
       → COMPLETED: "completed" (D25)
       → EXPIRED, never captured: "expired" (D25)
       → EXPIRED, captured: "return pending" → "returned" (§9/D25)
       → CANCELLED: "cancelled" (D25)
       → RECOVERY_REQUIRED/PENDING: "recovery-required" — guest's own status stays "confirmed" (§10/D25)
```

**Guest, full path (manual fallback, §6):** identical from "link" onward; only the delivery
step differs (organizer action vs. automatic send).

---

## B. Journey-state transition table

Vink-level (from `packages/domain/src/vink-state-machine.ts`, exhaustive):

| From | Event | To | Emits | Visible to guest as (D25 category, if terminal) |
|---|---|---|---|---|
| `DRAFT` | `VINK_OPENED` | `OPEN` | `VinkOpened` | (pre-open guest state ends here — D23) |
| `OPEN` | `ORGANIZER_CANCELLED` | `CANCELLED` | `VinkCancelled` | `cancelled` |
| `OPEN` | `SUBMISSION_DEADLINE_REACHED` / `ALL_CONTRIBUTIONS_AUTHORIZED` | `SUBMISSIONS_CLOSED` | `SubmissionsClosed` | — |
| `SUBMISSIONS_CLOSED` | `PROCESSING_GRACE_STARTED` | `PROCESSING_GRACE` | `ProcessingGraceStarted` | — |
| `PROCESSING_GRACE` | `FUNDING_CONFIRMED` | `FUNDED` | `VinkFunded` | — |
| `PROCESSING_GRACE` | `FUNDING_FAILED` | `EXPIRED` | `VinkExpired` | `expired` or `return_pending`→`returned` (§9) |
| `FUNDED` | `CARD_PROVISIONING_STARTED` | `CARD_PROVISIONING` | `TemporaryCardRequested` | — |
| `CARD_PROVISIONING` | `CARD_ISSUED` | `CARD_READY` | `TemporaryCardIssued` | — |
| `CARD_PROVISIONING` | `CARD_PROVISIONING_FAILED` | `FUNDING_REVERSAL` | `TemporaryCardFailed` | — |
| `FUNDING_REVERSAL` | `FUNDING_REVERSAL_COMPLETED` | `EXPIRED` | `VinkExpired` | `return_pending`→`returned` |
| `CARD_READY` | `MERCHANT_AUTHORIZATION_APPROVED` | `PURCHASE_AUTHORIZED` | `MerchantAuthorizationApproved` | — |
| `PURCHASE_AUTHORIZED` | `PURCHASE_CAPTURED` | `SETTLING` | `PurchaseCaptured` | — |
| `PURCHASE_AUTHORIZED` | `AUTHORIZATION_REVERSED` | `CARD_READY` | `MerchantAuthorizationReversed` | — |
| `SETTLING` | `SETTLEMENT_MATCHED` | `COMPLETED` | `VinkCompleted` | `completed` |
| `SETTLING` | `SETTLEMENT_OVERAGE_DETECTED` | `RECOVERY_REQUIRED` | `SettlementVarianceDetected` | `recovery-required` |
| `RECOVERY_REQUIRED` | `RECOVERY_STARTED` | `RECOVERY_PENDING` | `RecoveryObligationCreated` | `recovery-required` (unchanged) |
| `RECOVERY_PENDING` | `RECOVERY_RESOLVED` | `COMPLETED` | `VinkCompleted` | `completed` |
| `RECOVERY_PENDING` | `RECOVERY_DEFAULTED` | `RESTRICTED` | `OrganizerRestricted` | `completed` (guest was already confirmed; organizer-only consequence, Phase 0 §11) |

Contribution-level (from `packages/domain/src/contribution-state-machine.ts`, exhaustive),
mapped to the D25 guest vocabulary:

| From | Event | To | D25 guest category |
|---|---|---|---|
| `CREATED` | `AUTHORIZATION_STARTED` | `AUTHORIZATION_PENDING` | `pending` |
| `AUTHORIZATION_PENDING` | `AUTHORIZATION_APPROVED` | `AUTHORIZED` | `confirmed` |
| `AUTHORIZATION_PENDING` | `AUTHORIZATION_DECLINED` | `DECLINED` | `declined` |
| `AUTHORIZATION_PENDING` | `PROVIDER_RESULT_UNKNOWN` / `AUTHORIZATION_TIMED_OUT` | `RESOLUTION_PENDING` | `pending` |
| `AUTHORIZED` | `SESSION_FUNDED` | `CAPTURE_PENDING` | `confirmed` |
| `AUTHORIZED` | `PARTICIPANT_EXITED` / `SESSION_EXPIRED` | `CANCELLATION_PENDING` | `pending` → `cancelled` |
| `CAPTURE_PENDING` | `CAPTURE_SUCCEEDED` | `CAPTURED` | `confirmed` |
| `CAPTURE_PENDING` | `CAPTURE_RESULT_UNKNOWN` | `RESOLUTION_PENDING` | `pending` |
| `CANCELLATION_PENDING` | `CANCELLATION_SUCCEEDED` | `CANCELLED` | `cancelled` |
| `RESOLUTION_PENDING` | `RESOLVED_*` | `AUTHORIZED`/`DECLINED`/`CAPTURED`/`CANCELLED` | per resolved state |
| `CAPTURED` | `PURCHASE_SETTLED` | `SETTLED` | `confirmed` |
| `CAPTURED` | `REFUND_REQUIRED` | `REFUND_PENDING` | `return_pending` |
| `REFUND_PENDING` | `REFUND_SUCCEEDED` | `REFUNDED` | `returned` |
| `REFUND_PENDING` | `REFUND_FAILED` | `REFUND_FAILED` | `return_pending` (unchanged — retry is internal) |
| `REFUND_FAILED` | `REFUND_RETRIED` | `REFUND_PENDING` | `return_pending` (unchanged) |

---

## C. Current capability vs. canonical journey matrix

| Journey | Canonical (target) | Current capability | Gap | Dependency |
|---|---|---|---|---|
| §1 Organizer creation | Guest link inert until `VINK_OPENED` | Link live immediately on guest add (pre-open) | **Not built** | Backend gate (D23) |
| §2 Organizer waiting | Progress from `contributionProgress`, moves per confirmation | Progress from `fundedAmountMinor`, jumps 0→100% | **Not built** | API addition (D24) |
| §3 Organizer payment | As designed | Matches, minus `COMPLETED` copy | **Partial** | UI copy only |
| §4 Member contribution | Automatic SMS/email delivery, same pipeline as guests (D27); Home also lists participant Vinks (Phase 3) | **No in-app discovery at all** — `listMyVinks` returns organizer-owned Vinks only (`queries.ts:137-139`), no member-add link is generated | **Not built** (delivery); **not built** (Home read-model) | Data-model + integration (contact capture, send provider — same as D19); separately, a `listVinksForParticipant`-style read addition |
| §5 Guest contribution | `contributionStatus`-driven, never re-offers action | Local `hasAuthorized` flag, resets on reload | **Not built** | API addition (D24) + UI (D25) |
| §6 Guest manual fallback | Secondary/opt-out framing | Sole, foregrounded path | **Partial** (works, wrong framing) | UI reframe, sequenced after §1's delivery mechanism exists |
| §7 Expiry | Calm copy + neutral tone | Calm copy + **red/attention tone** | **Partial** | UI token change |
| §8 Cancellation | Distinct guest copy, "no one was charged" | Mobile has it; guest-web falls into flat message | **Not built** (guest-web) | API addition (D24/D25) + UI |
| §9 Refund/return | Distinct `return_pending`/`returned` guest states | No guest visibility at all | **Not built** | API addition (D24/D25) + UI |
| §10 Recovery | Guest sees calm `confirmed`, unaffected; organizer sees explicit money copy | Guest falls into flat message; organizer copy too vague | **Not built** (guest), **Partial** (organizer) | API addition (D24/D25) + UI |
| §11 Reconnect | Silent, cached-first | Already correct | **None** | — |
| §12 Resume | Instant, correct-state resume; explicit expiry states; in-place re-auth (D26) | Organizer resume correct; guest link-expiry silent; organizer session-expiry unhandled | **Not built** (both) | UI (guest link-expiry state) + global 401 listener + wizard/Lobby state preservation (D26) |

---

## D. Required API/read-model additions

1. **`contributionProgress` projection** (D24) — new field on both the organizer snapshot and
   the guest view: `{ confirmedAmountMinor, totalAmountMinor, confirmedParticipantCount,
   totalParticipantCount }`, computed from participant assigned shares + each contribution's
   state (confirmed = `AUTHORIZED` or later, per §B's table). Likely lives alongside/replaces
   `VinkReader.listContributionsByVink` (`packages/application/src/queries.ts`). Does not
   touch `fundedAmount`, the ledger, or the D5 resolver.
2. **Guest `contributionStatus`** (D24/D25) — new viewer-specific field on `GuestVinkView`
   (`packages/application/src/guest.ts`), collapsing the requesting guest's own contribution
   state into the seven-value vocabulary in §0. Must never expose any other participant's
   contribution state.
3. **Pre-open gate on the public/guest view** (D23) — `getPublicVinkView` and
   `inviteGuestCommand`'s link-minting must recognize `DRAFT` and return a response shape the
   client can render as "not open yet" without leaking any other DRAFT-stage detail (e.g., a
   split the organizer hasn't finalized). This is a response-shape change, not just a
   status-code change — the client needs enough to render the calm waiting state and nothing
   more.
4. **Realtime push on the `DRAFT → OPEN` transition reaching a held pre-open guest link** — so
   §6's "auto-transitions when the Vink opens" is actually live, not a manual-refresh
   requirement.
5. **(Separately scoped, not required for this phase's P0s):** an SMS/email delivery
   mechanism for D19, and a member-facing invitation/notification surface for §4 — both
   flagged as new scope needing their own decision, not designed here.

---

## E. Invitation delivery and fallback behavior

- **Default (target):** automatic SMS/email at the exact moment the Vink opens (D19/D23) —
  never before, since a guest identity/link may exist pre-open (added during Create) but must
  not be *sent* until `VINK_OPENED`.
- **Fallback:** organizer can explicitly choose "Share manually instead" at any point,
  before or after auto-delivery — Copy Link, Share sheet, QR remain fully available always
  (§6). Manual sharing pre-open is legitimate (e.g., handing a phone to someone in person) and
  is exactly what D23's "not open yet" state exists to handle gracefully.
- **Never:** UI implying "invitation sent" when only a manual action has occurred (already
  correctly avoided today, Phase 1 §C.1 — preserve this).
- **Data-model dependency:** automatic delivery cannot be built until guest identity capture
  collects a phone number or email (currently `displayName` only, Phase 0 §4) — this is a
  prerequisite for D19's mechanism, separate from and blocking on top of everything else in
  this document.

---

## F. Reload, reconnect, duplicate-action, and idempotency UX rules

1. **A confirmed contribution is never re-offered as an action, ever, regardless of reload,
   reconnect, tab close/reopen, or network blip** (D25) — this must be driven by
   server-resolved `contributionStatus`, never a client-local flag.
2. **Every "primary action" button in every journey above debounces against duplicate taps**
   pending the D13 command model's own idempotency — the UI-level rule is: disable + show
   in-progress state immediately on tap, never allow a second concurrent submission, and
   resolve to the *server's* resulting state rather than assuming success client-side.
3. **A declined contribution's retry is visibly a new attempt**, never framed as "retrying the
   same payment" (matches the domain's own DECLINED-is-terminal-per-attempt model).
4. **Cold resume always fetches a fresh snapshot before trusting any cached display beyond
   first paint** — cached data is for perceived speed only, never treated as current truth
   once a real fetch resolves differently.
5. **A brief connection drop never blocks the UI or resets any in-progress local state**
   (§11) — only a genuinely failed/expired session (§12) should ever force a state reset, and
   even then via an explicit message, never silently.

---

## G. Guest money-outcome rules (D25, exact copy triggers)

| D25 category | Trigger | What must be stated | What must never happen |
|---|---|---|---|
| `completed` | vink `COMPLETED` (direct or via resolved recovery) and own contribution `SETTLED` | the merchant was paid; your share is done | implying anything is still pending |
| `expired` | vink `EXPIRED` and own contribution never reached `CAPTURED` | you were never charged | any refund language (nothing to refund) |
| `cancelled` | vink `CANCELLED` | you were never charged (organizer cancelled) | confusing this with `expired` — different cause, same guarantee, but the reason should be stated correctly |
| `return_pending` | own contribution `REFUND_PENDING` or `REFUND_FAILED` | your payment is being returned | exposing the internal `REFUND_FAILED` retry as an alarming failure |
| `returned` | own contribution `REFUNDED` | your payment was returned | leaving stale "processing" language after this point |
| `recovery-required` | vink `RECOVERY_REQUIRED`/`RECOVERY_PENDING` and own contribution already `SETTLED` | your part is done (same as `completed`, calmly) | any implication the guest owes more or needs to act — this is exclusively an organizer-side obligation (Phase 0 §11) |

No fee line appears in any of these states (D21). No other participant's individual status is
ever exposed alongside a guest's own outcome (Phase 0 §2 privacy boundary, preserved by D24's
"viewer-specific, never another participant's" framing).

---

## H. Screens that disappear, merge, or become transient states

- **Add-Guest naming step and the manual-share step merge into one screen** once automatic
  delivery exists (§6 / Phase 1 §F.2) — sequential today, redundant once "send it" is a
  single default action.
- **The separate "Your share" card in the Lobby disappears**, folded into the organizer's own
  row in the participant list (§2 / Phase 1 §F.1) — not a new screen, a removal.
- **`SessionView.tsx`'s single flat terminal message is replaced by six distinct transient
  states** (§G), driven by state, not by a persistent separate "screen" — these are states of
  one screen, not new routes.
- **A new transient "not open yet" state is added** to the guest join surface (D23) — not a
  new route, a state within the existing `JoinExperience` decision tree.
- **No screens are removed for their own sake** — Home, Activity, Profile, the Create wizard,
  and the guest Join/Session screens all remain, matching this phase's instruction not to
  preserve screens merely because they exist, but also not finding a reason to cut any of
  them: every existing screen maps to a real, still-needed journey step above.

---

## I. Dependencies Phase 3 and Phase 4 must not contradict

1. `contributionProgress` and guest `contributionStatus` are the **only** sanctioned sources
   for any incremental-progress or "your status" UI anywhere in the redesign — Phase 4 screen
   contracts must not re-derive progress from `fundedAmountMinor` or invent a third
   client-side approximation.
2. A guest must **never** be shown `DRAFT` or any state-name-adjacent synonym — Phase 4's
   "not open yet" screen contract must be written against the D23 gated response shape, not
   against the current unrestricted `getPublicVinkView` payload.
3. No fee UI, no percentage-split UI — D21/D22 stand unchanged; Phase 3's information
   architecture and Phase 4's screen contracts must not add either.
4. The member-invitation-surface gap (§4) and the organizer-session-expiry-recovery gap
   (§12) are both **now decided** (D27: members use the same automatic delivery pipeline as
   guests, no separate inbox; D26: in-place re-auth prompt preserving in-progress state) but
   **neither is built**. Phase 3/4 should place them in the information architecture and
   screen contracts as designed-but-pending, not as already-working, and not as open
   questions either — the decision is made, only the implementation is outstanding.
5. Automatic SMS/email delivery (D19, extended to members by D27) is a **data-model +
   integration dependency** (phone/email capture, a delivery provider) that Phase 4 cannot
   design around as if it already works — screen contracts should design the
   automatic-primary/manual-fallback framing (§E) but must not assume delivery actually fires
   until that dependency is built.
6. The in-place re-auth prompt (D26) requires the Create Vink wizard and Lobby to preserve
   their in-progress local state across an interruption — Phase 4's screen contracts for
   those two screens specifically must account for "resume after re-auth" as a real entry
   condition, not just "cold launch" and "normal navigation."

---

## J. Acceptance criteria for moving to Phase 3

- [x] Owner has reviewed and signed off on D23–D25 (recorded 2026-07-20).
- [x] Owner has resolved the two gaps this phase surfaced: members use the same automatic
      SMS/email delivery as guests, no separate inbox (D27); organizer session expiry gets an
      in-place re-auth prompt preserving in-progress state (D26). Both are decided; neither is
      built yet — Phase 3/4 design against them as pending dependencies, per §I.4.
- [ ] `contributionProgress` and guest `contributionStatus` (§D) are accepted as the target
      data shape engineering will build toward — Phase 3/4 can proceed designing against them
      even before they're implemented, per this document's "target behavior, dependency
      labeled" approach.
- [ ] No open item in this document contradicts D19–D25 or Phase 0/1's hard-rule findings.

**This document does not modify the automatic-SMS/email build item's scope, the fee model, or
percentage-split visibility — those stay exactly as decided in D19/D21/D22.**
