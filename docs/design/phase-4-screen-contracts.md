# Phase 4 — Screen Contracts

_UI/UX Engineering Plan, Phase 4 output: a complete specification for every screen in
`docs/design/phase-3-information-architecture.md` §9's final inventory. Source of truth:
Phases 0–3, `docs/spec/decision-log.md` (D1–D31). Includes the VinkIn Signature Ink Progress
System's placement/appearance on every relevant screen, per the plan's own amendment._

**Status:** DRAFT. **Documentation only — no application code was modified.** Typography and
spacing fields below cite the **real, already-built** token system
(`apps/mobile/lib/design_system/{vink_typography,vink_spacing,vink_colors}.dart`,
mirrored in `apps/guest-web/app/globals.css` and `docs/design/vinkin-design-system.md`) —
nothing here invents new tokens; that discipline is Phase 8's job for anything these tokens
don't yet cover (e.g. bottom-sheet chrome, the ink vessel's own component spec). Where a
screen is unchanged from today, its contract is shorter because there's less to change, not
because it was skipped.

---

## 0. Ink Progress System — placement summary

Per the amendment: **a normal progress bar must not duplicate the vessel.** Every place that
today reads `fundedAmountMinor` for a progress bar (Phase 1 §C.8) is **replaced**, not
supplemented, by the ink vessel driven by `contributionProgress` (D20/D24):

| Screen | Variant | Notes |
|---|---|---|
| Live Vink — Lobby (organizer/member) | Full vessel, primary | The dominant visual object of the whole screen (§10). |
| Live Vink — Guest Session | Full vessel, primary, aggregate-only | Same vessel; guest never sees other participants' individual status (§13). |
| Home — active Vink card | Compact preview variant | Small, non-interactive fill indicator per card (§4). |
| Guest success moment | One-time droplet-joining animation | Plays once, when the guest's own contribution confirms (§13); motion detail itself belongs to Phase 9, this document only fixes *where* and *when* it occurs. |

Screen-reader text pattern (every full-vessel instance): **"$X of $Y ready. Waiting for
{name}."** — singular name if exactly one participant is unconfirmed, **"Waiting for {name}
and N others"** for more than one, and **"Everyone's ready"** with no waiting clause once
`confirmedParticipantCount == totalParticipantCount`. The compact Home variant announces only
the fraction ("$X of $Y ready"), no waiting clause — Home is a list, not the place for
per-person detail.

---

## 1. Welcome

- **Route:** `/welcome` (unauthenticated only).
- **User type:** anonymous.
- **Entry condition:** no valid stored session (`AuthSignedOut`).
- **Exit condition:** navigates to Login or Register.
- **Dominant visual object:** VinkIn wordmark/logomark.
- **Exact visible information:** brand mark, one-line value statement, two entry actions.
- **Element order:** mark → statement → "Log in" → "Create account".
- **Typography hierarchy:** `VinkTypography.heroDisplay` (mark/statement), `buttonLabel`
  (actions).
- **Spacing:** `VinkSpacing.xl`/`xxl` vertical rhythm (a landing screen, generous whitespace
  is correct here, unlike data-dense screens).
- **Actions:** "Log in" (secondary), "Create account" (primary).
- **Sheets:** none.
- **Scroll behavior:** none needed (fits one viewport).
- **Keyboard behavior:** n/a (no inputs).
- **Loading behavior:** none — static.
- **Error behavior:** n/a.
- **Offline behavior:** fully functional offline (no network call on this screen itself).
- **Realtime behavior:** n/a.
- **Back behavior:** n/a (root of the unauthenticated stack).
- **App-relaunch behavior:** only reached if `AuthSignedOut`; a signed-in relaunch skips
  straight to Home (Phase 0 §1, confirmed correct today).
- **Accessibility behavior:** standard heading semantics on the statement; both buttons ≥44pt
  touch targets.

## 2. Login

- **Route:** `/login`.
- **User type:** anonymous, recognized-but-signed-out.
- **Entry condition:** from Welcome, or redirected here on an unrecoverable session (only if
  D26's in-place prompt itself fails/is dismissed — see §18).
- **Exit condition:** successful auth → Home.
- **Dominant visual object:** the credential form.
- **Exact visible information:** username field, password field, submit action, link to
  Register.
- **Element order:** heading → username → password → "Log in" → "Don't have an account?"
- **Typography hierarchy:** `title` (heading), `label` (field labels), `body` (input text).
- **Spacing:** `md` between fields, `lg` above the submit action.
- **Actions:** "Log in" (primary, disabled until both fields non-empty).
- **Sheets:** none.
- **Scroll behavior:** content scrolls above the keyboard on small devices.
- **Keyboard behavior:** username field autofocus on entry; password field submits on return.
- **Loading behavior:** submit button shows an inline spinner, fields disabled, no full-screen
  block.
- **Error behavior:** wrong credentials → inline message under the password field, specific
  and calm ("that username or password doesn't match"), never a raw backend code.
- **Offline behavior:** submit fails with a clear "check your connection" message, not a
  generic error.
- **Realtime behavior:** n/a.
- **Back behavior:** returns to Welcome.
- **App-relaunch behavior:** n/a (never resumed into mid-form).
- **Accessibility behavior:** password field has a visibility toggle with an accessible
  label; error message is announced via `role="alert"`-equivalent.

## 3. Register

- **Route:** `/register`.
- **User type:** anonymous, new user.
- **Entry condition:** from Welcome or Login's "create account" link.
- **Exit condition:** successful registration → Home (auto-signed-in, Phase 0 §1).
- **Dominant visual object:** the registration form.
- **Exact visible information:** display name, username, password fields, **contact info
  (new — phone or email, per Phase 3 §5/D19/D27 prerequisite)**, submit action.
- **Element order:** heading → display name → username → password → contact info → "Create
  account" → link to Login.
- **Typography hierarchy:** same as Login.
- **Spacing:** same rhythm as Login.
- **Actions:** "Create account" (primary, disabled until required fields valid).
- **Sheets:** none.
- **Scroll behavior:** same as Login, more fields so more likely to need it.
- **Keyboard behavior:** logical tab order top-to-bottom; contact-info field offers the
  correct keyboard type (phone pad or email) once a phone/email toggle is chosen.
- **Loading behavior:** same inline-spinner pattern as Login.
- **Error behavior:** field-level validation inline (e.g. username taken) — never a form-wide
  dump of errors.
- **Offline behavior:** same as Login.
- **Realtime behavior:** n/a.
- **Back behavior:** returns to Welcome/Login.
- **App-relaunch behavior:** n/a.
- **Accessibility behavior:** each field has a visible, associated label (not placeholder-only
  — placeholder-as-label is an accessibility anti-pattern to avoid explicitly).
- **Implementation dependency:** the contact-info field is **new** — today's `register_screen.dart`
  collects no email/phone at all (Phase 1 audit). Required before D19/D27 can function.

## 4. Home

- **Route:** `/home` (tab 1).
- **User type:** signed-in organizer and/or member.
- **Entry condition:** app launch (signed in) or tab switch.
- **Exit condition:** navigates into Create, a specific Live Vink, or Activity.
- **Dominant visual object:** the "needs your attention" list — the single most important
  content on this screen, always above "waiting on others."
- **Exact visible information (per Vink card):** purpose/category icon, organizer name
  (if not self), compact ink-fill preview (§0), one-line status
  (`vinkStatusLabel`-equivalent), next action if any.
- **Element order:** "Start a Vink" (top, always visible) → "Needs your attention" section
  (includes `RESTRICTED`, unpaid own-share, any organizer-only alert) → "Waiting on others"
  section → link to Activity.
- **Typography hierarchy:** `title` (section headers), `cardTitle` (per-card purpose),
  `amountMedium` (per-card total), `bodySmallSecondary` (status line).
- **Spacing:** `cardPadding` (28px) inside each Vink card, `lg` between cards, `xl` between
  sections.
- **Actions:** "Start a Vink" (primary, always present); tapping any card opens that Live
  Vink.
- **Sheets:** none.
- **Scroll behavior:** vertical list, both sections in one scroll, no nested scroll regions.
- **Keyboard behavior:** n/a (no text input on this screen).
- **Loading behavior:** cached last-known list renders instantly on tab switch; a background
  refresh reconciles silently (same cached-first-paint principle as Live Vink, Phase 1 §C.2
  fix, applied here too since Home is now live participant data, not just organizer data).
- **Error behavior:** a failed refresh keeps showing the last-known list with a small,
  dismissible "couldn't refresh" note — never blanks the screen.
- **Offline behavior:** last-known list remains fully visible and navigable; "Start a Vink"
  is disabled with an inline explanation rather than silently failing on submit.
- **Realtime behavior:** cards update live as their underlying Vinks change state (via the
  same realtime channel, not polling) — a card moving from "waiting" to "needs attention"
  should visibly reflow, not require a manual refresh.
- **Back behavior:** n/a (tab root).
- **App-relaunch behavior:** confirmed correct today — lands here directly, no onboarding
  flash (Phase 1 §C.10).
- **Accessibility behavior:** each card's accessible label states purpose, amount, status,
  and compact progress in one sentence (mirrors §0's screen-reader pattern, compact form).
- **Implementation dependency:** requires the participant-inclusive Home query
  (Phase 3 §1) — without it, "Waiting on others" and any card for a Vink this user didn't
  organize cannot exist.

## 5. Create Vink (canonical target: D30)

**Canonical target is two input screens plus a transient confirmation — not a five-step
wizard.** The standalone Review screen is removed as a destination; its content is what the
transient confirmation shows. This section specifies the canonical target; §5d specifies the
current five-step implementation separately, labeled as current capability only, per D30.

- **Route:** `/create` (two in-flow screens, not separate routes per screen).
- **User type:** organizer (only role that can reach this).
- **Sheets:** Add/Edit Participant (member lookup / guest add + delivery choice); the Open
  Vink confirmation itself (§5c).
- **Scroll behavior:** each screen's content scrolls independently if it overflows; the
  primary action stays pinned/visible.
- **Keyboard behavior:** numeric keypad for the total field; each screen's first relevant
  field autofocuses.
- **Loading behavior:** both input screens are instant/local; the only real network moment
  is confirming "Open Vink" inside the transient confirmation (§5c).
- **Error behavior:** inline, per-field — never a modal interrupting the flow for a
  recoverable input error.
- **Offline behavior:** both input screens work fully offline (local state only); the Open
  Vink confirmation's actual submission fails clearly if offline, with all input preserved so
  the organizer can retry without re-entering anything.
- **Realtime behavior:** n/a until the Vink actually opens.
- **Back behavior:** screen 2 → screen 1 preserves all entered data; screen 1 back exits to
  Home with a confirmation only if any input has been entered (Phase 5 §12 defines exactly
  when "meaningful work would be lost").
- **App-relaunch behavior:** **implementation dependency (D26):** input must survive an
  interruption that triggers the in-place re-auth prompt, so the organizer doesn't lose a
  half-built Vink to a session hiccup. A full app force-quit mid-flow is not required to
  resume (not a stated requirement; flagged as a scope boundary).
- **Accessibility behavior:** a step-progress indicator ("Step 1 of 2") is announced on entry
  to each screen; the confirmation sheet announces itself as a confirmation, not a new screen.

### 5a. Screen 1 — Purpose and total
- **Dominant visual object:** the total amount (`amountLarge`), entered live.
- **Exact visible information:** purpose text field, category picker (only
  policy-supported categories, Phase 1 §D — never `RESTAURANT`/`HOTEL`/`FUEL`/`CAR_RENTAL`),
  numeric total entry.
- **Actions:** "Next" (disabled until purpose, category, and a > $0 total are all valid).

### 5b. Screen 2 — People and split
- **Dominant visual object:** the people list being built, each row showing its live
  allocation.
- **Exact visible information:** added members/guests so far, each with their delivery
  choice visible inline (not hidden in a second screen — the merge from Phase 2 §H), the
  Equal/Custom toggle (D22 — no Percentage control anywhere in this UI), organizer's own
  share (editable, can be $0, custom, or equal — Phase 0 §3).
- **Element order (Add/Edit Participant sheet):** search/name entry → result (member found →
  add directly; not found → inline "add as guest instead," fixing Phase 2 §1's dead-end) →
  **delivery choice** ("Send automatically" default / "Share manually instead," D19) →
  confirm.
- **Actions:** "Add" (per person, opens the sheet), "Continue" (disabled until ≥1 participant
  beyond the organizer or the organizer explicitly covers the whole amount, **and**
  allocations sum exactly to the total).
- **Implementation dependency:** the delivery-choice control needs D19/D27's contact-capture
  and send-provider dependency to actually function; until then this control can only offer
  "Share manually instead" (today's only real path), which is acceptable as an honest interim
  state per Phase 2 §E — never show "Send automatically" as selectable before it works.

### 5c. Open Vink confirmation (transient — bottom sheet/dialog, not a page)
- **Dominant visual object:** the full allocation summary, exactly what a standalone Review
  screen used to show, now inside a dismissible sheet.
- **Exact visible information:** purpose, total, every participant's share, delivery method
  per person. **No fee line** (D21).
- **Actions:** "Open Vink" (single primary action inside the sheet — confirmed no duplicate
  CTA today, Phase 2 §1, must stay that way); dismiss/back returns to screen 2 (§5b) with all
  data intact, per D30's explicit "back from confirmation returns to People and Split without
  losing data" rule.
- **Loading behavior:** "Open Vink" shows an inline spinner on the button itself; on success,
  the sheet dismisses and the app transitions directly into the Live Vink Lobby (§6) — no
  intermediate full-screen "success" page.
- **Dismissal behavior:** an accidental background tap must not silently discard the
  organizer's completed input — dismissing returns to screen 2 exactly as it was, never
  back to screen 1 or to Home.
- **State transition triggered:** `DRAFT → OPEN` (`VINK_OPENED`) — the exact moment
  automatic delivery (D19/D27) fires and guest links become live (D23).

### 5d. Current-capability note (not canonical)

Today's actual implementation (`create_vink_screen.dart`) is a five-step wizard — Purpose →
Total → Add people → Split → Review — with Review as a standalone destination screen. This
remains accurate **current-capability** documentation (Phase 3 §2, D30) but is not the target
this document's §5a–§5c design toward. Building toward the canonical target means merging
Purpose+Total into one screen, merging Add-people+Split into one screen, and converting
Review from a destination screen into the transient confirmation described in §5c.

---

## 6. Live Vink — Lobby (organizer/member)

- **Route:** `/vinks/:vinkId`.
- **User type:** organizer or member (existing account).
- **Entry condition:** navigated from Home, or resumed from a relaunch/reconnect.
- **Exit condition:** organizer/member leaves (back to Home); screen persists showing
  whatever terminal state is eventually reached — there's no separate "done" screen to
  navigate away to.
- **Dominant visual object:** **the ink vessel** (§0) — replaces the current linear
  `VinkProgressIndicator` entirely, not alongside it.
- **Exact visible information:** purpose, total, ink vessel (live `contributionProgress`),
  time remaining (while `OPEN`), participant list (organizer's own share folded into the
  same list, Phase 3 §3), organizer's current action/card status, invite controls (only
  while `OPEN` and incomplete).
- **Element order:** header (purpose + status badge) → ink vessel → time remaining (if
  applicable) → own action (if unpaid) → participant list → invite controls (if applicable)
  → card/settlement detail (once relevant).
- **Typography hierarchy:** `title` (purpose), `amountLarge` (total, inside/near the
  vessel), `bodySmallSecondary` (time remaining), `participantName`/`label` (list rows).
- **Spacing:** `cardPadding` around the vessel, `md` between participant rows, `lg` between
  major sections.
- **Actions:** "Pay my share" (if unpaid, primary); "Share manually instead" (secondary,
  only while incomplete, D19's fallback framing); no action once terminal.
- **Sheets:** the manual-share sheet (Copy Link/Share/QR, existing controls, reframed as
  secondary per Phase 2 §6).
- **Scroll behavior:** single vertical scroll; the vessel stays near the top, not pinned
  (it's the dominant object, not a persistent header chrome).
- **Keyboard behavior:** n/a (no text input on this screen itself).
- **Loading behavior:** cached last-known snapshot renders immediately; realtime channel
  upgrades in place — **no more bare "Connecting…" block** (Phase 1 §C.2 fix, required here).
- **Error behavior:** a failed "Pay my share" attempt shows inline, specific, human-worded
  failure text (Phase 0 §7's already-correct pattern), with a clear distinct retry action.
- **Offline behavior:** last-known state stays visible; any action requiring network is
  disabled with an inline explanation, not a silent failure.
- **Realtime behavior:** every state transition and every contribution confirmation pushes
  live — this is the screen the whole realtime channel exists for.
- **Back behavior:** returns to Home; the Vink's state is unaffected by leaving.
- **App-relaunch behavior:** confirmed correct today (session restore lands on Home;
  navigating back into this specific Vink re-fetches fresh, Phase 1 §C.10).
- **Accessibility behavior:** the vessel's screen-reader text follows §0's exact pattern;
  the status badge's tone (attention/positive/etc.) is never the *only* signal — text always
  accompanies color.
- **Implementation dependency:** `contributionProgress` (D24) for the vessel; participant
  row consolidation (Phase 1 §F.1) is a pure layout change, no backend dependency.

## 7. Live Vink — Guest: Not Open Yet (new, D23)

- **Route:** `/join/:publicCode` (state within `JoinExperience`, not a separate route).
- **User type:** guest, pre-open.
- **Entry condition:** a valid `publicCode` resolves to a Vink still in `DRAFT`.
- **Exit condition:** automatic — transitions to the Join Form (§8) the instant the Vink
  reaches `OPEN`, no user action required.
- **Dominant visual object:** a calm waiting indicator — not a spinner (nothing is loading;
  the Vink genuinely isn't ready), a static "not yet" state.
- **Exact visible information:** **only** what D23's backend gate actually returns for a
  pre-open Vink — at minimum "this Vink isn't open yet," deliberately **not** the full
  organizer/purpose/amount preview (Phase 3 §3 — the DRAFT-stage data may not be final).
- **Element order:** message → (optional) organizer name only, if the gated response
  includes it → no further detail.
- **Typography hierarchy:** `title` (message), `bodySecondary` (any supporting line).
- **Spacing:** centered, generous whitespace — matches the calm, non-urgent tone.
- **Actions:** none — no contribution action exists here by definition.
- **Sheets:** none.
- **Scroll behavior:** single screen, no scroll needed.
- **Keyboard behavior:** n/a.
- **Loading behavior:** first paint shows this state immediately once the pre-open response
  resolves — no separate spinner before it.
- **Error behavior:** an invalid/nonexistent code shows the existing "doesn't match any
  Vink" message (Phase 1, unchanged), distinct from this state.
- **Offline behavior:** if reached once and then offline, keeps showing this state rather
  than erroring.
- **Realtime behavior:** **this screen's entire reason to exist** — it listens for the
  `DRAFT → OPEN` push and transitions automatically (Phase 2 §D.4), never requiring a manual
  refresh.
- **Back behavior:** n/a (guest web has no back-stack beyond the browser's own).
- **App-relaunch behavior:** reopening the same link while still pre-open shows this same
  state again, not a stale cached "loading."
- **Accessibility behavior:** `role="status"`, calm/neutral tone, no alarming color.
- **Implementation dependency:** the entire screen is blocked on D23's backend gate — the
  response shape for a pre-open Vink doesn't exist yet.

## 8. Live Vink — Guest: Join Form

- **Route:** `/join/:publicCode` (state within `JoinExperience`).
- **User type:** guest, pre-join, Vink `OPEN` or later.
- **Entry condition:** valid code, Vink not `DRAFT`, guest has no existing session for this
  code.
- **Exit condition:** successful join → Session View (§9).
- **Dominant visual object:** the guest's own exact share amount (`amountLarge`).
- **Exact visible information:** organizer name, purpose, exact guest share, group
  `contributionProgress` (compact, since the guest hasn't joined yet — read-only preview),
  **time remaining (new — parity gap fixed, §0/Phase 3 §6)**, display-name entry field,
  **no fee line** (D21).
- **Element order:** organizer/purpose header → your share (dominant) → group progress
  preview → time remaining → name field → "Join".
- **Typography hierarchy:** `title` (organizer/purpose), `amountLarge` (share),
  `bodySmallSecondary` (time remaining).
- **Spacing:** `cardPadding` around the share figure, `md` between the field and the action.
- **Actions:** "Join" (primary, disabled until a name is entered).
- **Sheets:** none.
- **Scroll behavior:** single scroll, name field near the bottom so the keyboard doesn't
  cover the share/progress information above it.
- **Keyboard behavior:** name field autofocuses only if the rest of the content already fit
  above the fold; otherwise the user scrolls to it deliberately (avoid ambushing the
  keyboard over the information they came to read).
- **Loading behavior:** server-rendered invite context on first paint (Phase 13's original
  requirement, restated) — the organizer/purpose/amount must not wait on any client fetch
  before showing.
- **Error behavior:** guest-web's **new human-error-message layer** (Phase 1 §D.1 fix) —
  no raw backend strings; a not-joinable Vink shows the correct, specific message (and,
  post-D23, is unreachable in the pre-open case at all — see §7).
- **Offline behavior:** the server-rendered content stays visible; "Join" is disabled with an
  inline explanation if offline.
- **Realtime behavior:** group progress preview updates live even before this guest joins.
- **Back behavior:** browser back leaves the page; no in-app back needed.
- **App-relaunch behavior:** n/a (pre-join, nothing to resume yet).
- **Accessibility behavior:** the name field has a visible label; the share amount is
  announced with full context ("Your share: $24.50 of $98.00 total"), not just the number.

## 9. Live Vink — Guest: Session View

- **Route:** `/join/:publicCode` (state within `JoinExperience`), also reachable via
  `/g/:token` redeem.
- **User type:** guest, joined.
- **Entry condition:** valid stored guest session for this code.
- **Exit condition:** none required — this is where the guest's journey ends; they simply
  close the tab whenever satisfied.
- **Dominant visual object:** **the ink vessel** (§0, guest variant — aggregate-only) while
  contribution is still open; **the guest's own outcome statement** (D25 vocabulary) once
  their own status is `confirmed` or later, or once the Vink reaches any terminal state.
- **Exact visible information (pre-contribution):** organizer, purpose, own share, group
  vessel, time remaining, "Approve $X" action, own `contributionStatus` if not
  `not_started`.
- **Exact visible information (post-contribution / terminal):** the single relevant D25
  outcome sentence (§14 of `phase-2-journey-architecture.md`'s §G table) — never the flat
  generic message this screen shows today.
- **Element order:** header → dominant object (vessel or outcome statement, mutually
  exclusive) → supporting detail (time remaining or outcome-specific detail) → action (only
  if `not_started`/`declined`) → simulation banner (unchanged placement, Phase 0 §12).
- **Typography hierarchy:** `title` (header), `amountLarge` (share, pre-contribution) or
  the outcome sentence at `body`/`bodySecondary` weight (calm, not shouted — a terminal
  state is not an alert).
- **Spacing:** same rhythm as the Join Form for continuity.
- **Actions:** "Approve $X" (only while `contributionStatus` is `not_started` or
  `declined`) — **never shown once `confirmed`, per D25, regardless of reload** (§16).
- **Sheets:** none.
- **Scroll behavior:** single scroll.
- **Keyboard behavior:** n/a (no input on this screen after joining).
- **Loading behavior:** cached-first-paint from the stored session (Phase 1 §C.2 fix) — no
  bare "Loading…" for a returning, already-confirmed guest.
- **Error behavior:** same human-error-message layer as the Join Form.
- **Offline behavior:** last-known status stays visible; "Approve $X" (if applicable) is
  disabled with an inline explanation, not a silent failure, if offline.
- **Realtime behavior:** group vessel updates live; the guest's own `contributionStatus`
  updates live on confirmation (playing the one-time droplet-joining moment, §0); terminal
  states push immediately when reached.
- **Back behavior:** n/a (browser back only).
- **App-relaunch behavior:** reopening the link re-resolves `contributionStatus` from the
  server every time — **this is the core D25 fix**, replacing today's reload-resetting local
  `hasAuthorized` flag.
- **Accessibility behavior:** the outcome statement is the accessible label for the whole
  screen state (`role="status"`) — a screen-reader user gets the money-outcome sentence
  first, not buried after layout-order content.
- **Implementation dependency:** the entire terminal-state and reload-safety behavior is
  blocked on guest `contributionStatus` (D24) — this screen cannot be honestly built without
  it; the vessel needs `contributionProgress` (D24); the time-remaining addition is a pure
  rendering fix, no backend dependency.

## 10. Activity (list)

- **Route:** `/activity` (tab 2).
- **User type:** organizer and/or member.
- **Entry condition:** tab switch.
- **Exit condition:** taps an entry → Vink details (§11).
- **Dominant visual object:** the reverse-chronological entry list.
- **Exact visible information (per entry):** Vink purpose, outcome label (completed /
  expired / cancelled / returned — aligned to the same vocabulary discipline as guest-web's
  D25 set, Phase 3 §4), date, amount.
- **Element order:** newest first, grouped by nothing more than recency (no additional
  filtering UI unless later requested).
- **Typography hierarchy:** `cardTitle` (purpose), `bodySmallSecondary` (date/outcome).
- **Spacing:** `md` between entries, `lg` section padding.
- **Actions:** tap any entry (now navigable — D29, was previously inert).
- **Sheets:** none.
- **Scroll behavior:** standard vertical list; consider pagination only if the list becomes
  long (not decided here — an implementation detail).
- **Keyboard behavior:** n/a.
- **Loading behavior:** cached list first, background refresh.
- **Error behavior:** failed refresh keeps last-known list, small inline note.
- **Offline behavior:** last-known list stays fully browsable (including into cached detail
  views, if already fetched once).
- **Realtime behavior:** new entries appear live as Vinks the user is part of reach a
  terminal state.
- **Back behavior:** n/a (tab root).
- **App-relaunch behavior:** unchanged from today.
- **Accessibility behavior:** each row's accessible label states purpose, outcome, and date
  together.
- **Implementation dependency:** same participant-inclusive query as Home (Phase 3 §4).

## 11. Activity — Vink details (new, D29/D31 — never "Receipt"/"View receipt")

- **Route:** pushed from an Activity entry (e.g. `/activity/:vinkId`).
- **User type:** organizer and/or member (whoever the entry belongs to).
- **Entry condition:** tap from Activity list.
- **Exit condition:** back to Activity list.
- **Dominant visual object:** the outcome statement, matching the vocabulary discipline
  from §9 (Guest Session's terminal states) and Phase 2 §G's money-outcome rules —
  "the merchant was paid $X," "you were refunded $X," etc., not a raw state name.
- **Exact visible information:** purpose, total, every participant's contribution outcome
  (organizer/member view only — full detail is appropriate here since this is the
  organizer's/member's own history, not the guest privacy-scoped view), timestamps of key
  transitions, merchant settlement detail if applicable, shown as **payment and outcome
  detail** — never labeled, phrased, or visually presented as merchant-issued or
  provider-issued documentation (D31 — no such artifact exists). **No fee line** (D21) — this
  view is built entirely from data the domain already records (Phase 3 §4), and no fee exists
  to show.
- **Element order:** outcome header → amount/participant breakdown → timeline of key
  transitions.
- **Typography hierarchy:** same as the Lobby's terminal-state treatment (§6) for
  consistency — this screen should read like the calm conclusion of the Lobby, not a
  separate visual language, and never like a formal document.
- **Spacing:** standard detail-screen rhythm (`lg` section gaps, `md` within a section).
- **Actions:** none required beyond navigation back — this is a read-only record.
- **Sheets:** none.
- **Scroll behavior:** single vertical scroll.
- **Keyboard behavior:** n/a.
- **Loading behavior:** cached if reached from an already-loaded Activity list; a direct
  deep-link fetches fresh with standard loading treatment (skeleton, not a blocking spinner).
- **Error behavior:** a since-deleted or inaccessible Vink shows a clear "not available"
  message.
- **Offline behavior:** viewable if previously loaded/cached; otherwise a clear offline
  message, not a hang.
- **Realtime behavior:** n/a — this is historical, terminal-state data by definition.
- **Back behavior:** returns to Activity list, scroll position preserved.
- **App-relaunch behavior:** n/a (never resumed mid-view; re-navigated fresh each time).
- **Accessibility behavior:** the outcome header is the primary accessible landmark.
- **Implementation dependency:** entirely new screen; needs confirmation that today's
  `/activity` data (or a small addition) carries everything this view requires — flagged as
  an implementation-phase detail, not resolved here.

## 12. Profile

- **Route:** `/profile` (tab 3).
- **User type:** signed-in organizer/member.
- **Entry condition:** tab switch.
- **Exit condition:** sign-out → Welcome; navigates into a field editor for contact
  info/password.
- **Dominant visual object:** identity (name/username).
- **Exact visible information:** display name, username, **contact info (new — phone/email,
  D19/D27 prerequisite)**, **support contact (new, D28)**, sign out. **No payment methods,
  no security-beyond-password, no legal content** (all explicitly deferred, Phase 3 §5).
- **Element order:** identity header → contact info (editable) → change password → contact
  support → sign out.
- **Typography hierarchy:** `title` (name), `body` (username/contact), `label` (section
  headers).
- **Spacing:** `lg` between sections, `md` within.
- **Actions:** "Edit contact info," "Change password," "Contact support" (opens the
  configured support channel), "Sign out" (destructive-styled, confirmation required).
- **Sheets:** none required (each action can be its own simple screen, not a sheet, since
  none are quick single-choice interactions).
- **Scroll behavior:** single scroll if content exceeds viewport.
- **Keyboard behavior:** n/a on this screen itself (inputs live in the pushed editors).
- **Loading behavior:** identity loads from the already-authenticated session, instant.
- **Error behavior:** a failed sign-out still clears local session state (Phase 0's existing
  "best-effort" pattern for logout, unchanged) — never leaves the user stuck signed-in-looking
  after they asked to sign out.
- **Offline behavior:** identity view works offline; edits queue or fail clearly, not
  silently.
- **Realtime behavior:** n/a.
- **Back behavior:** n/a (tab root).
- **App-relaunch behavior:** unchanged.
- **Accessibility behavior:** "Sign out" requires explicit confirmation, announced clearly,
  to prevent accidental activation.
- **Implementation dependency:** contact-info capture/edit (D19/D27), support-contact
  destination (D28) — both new.

## 13. Guest token-redeem page

- **Route:** `/g/:token`.
- **User type:** guest, following an organizer-issued personal link.
- **Entry condition:** valid `vgt_`-style token in the URL.
- **Exit condition:** immediate redirect to `/join/:publicCode` (§7/§8/§9, whichever state
  applies).
- **Dominant visual object:** none — this is a redirect, not a destination.
- **Exact visible information:** a brief, calm "getting your Vink ready" transitional
  message only if the redirect isn't instant.
- **Element order:** n/a.
- **Typography hierarchy:** `bodySecondary`, minimal.
- **Spacing:** centered.
- **Actions:** none.
- **Sheets:** none.
- **Scroll behavior:** n/a.
- **Keyboard behavior:** n/a.
- **Loading behavior:** the transitional message itself, if the redemption call takes any
  perceptible time.
- **Error behavior:** an invalid/expired token shows a clear, specific message distinct from
  "this link doesn't match any Vink" (§8) — this is a different failure (bad token vs. bad
  code).
- **Offline behavior:** clear "check your connection" message; nothing to retry
  automatically without one.
- **Realtime behavior:** n/a.
- **Back behavior:** n/a.
- **App-relaunch behavior:** n/a (single-use transition).
- **Accessibility behavior:** transitional message uses `role="status"`, not silence.

## 14. Cross-cutting: In-place re-auth prompt (D26)

- **Route:** not a route — an overlay/sheet presentable over any authenticated organizer/
  member screen.
- **User type:** organizer/member whose session just became unrecoverable mid-use.
- **Entry condition:** a request fails with an unrecoverable 401 (the one silent
  refresh-and-retry already failed) — triggered globally, not per-screen.
- **Exit condition:** successful re-auth dismisses the overlay and resumes the underlying
  screen; explicit cancel signs the user out fully (falls back to §2's Login screen instead).
- **Dominant visual object:** the credential form, presented as a sheet, not a full-screen
  takeover — the underlying screen should remain dimly visible behind it, reinforcing that
  nothing has been lost.
- **Exact visible information:** a brief explanation ("please sign in again to continue"),
  username/password fields.
- **Element order:** explanation → username → password → "Sign in" → "Cancel" (secondary).
- **Typography hierarchy:** same as Login (§2), scaled to sheet context.
- **Spacing:** standard sheet padding (`cardPadding`).
- **Actions:** "Sign in" (primary), "Cancel" (secondary — leads to full sign-out).
- **Sheets:** this **is** the sheet.
- **Scroll behavior:** content fits without scrolling in normal cases; scrolls above the
  keyboard if needed.
- **Keyboard behavior:** same as Login.
- **Loading behavior:** inline spinner on "Sign in," underlying screen stays frozen-but-
  visible (not interactive) until resolved.
- **Error behavior:** same inline pattern as Login.
- **Offline behavior:** clear "check your connection" message; the underlying screen's
  already-loaded state remains visible and unaffected while offline.
- **Realtime behavior:** the underlying screen's realtime channel should reconnect
  automatically once re-auth succeeds, without a manual refresh.
- **Back behavior:** device back button acts as "Cancel."
- **App-relaunch behavior:** n/a (this is a live-session interruption, not a relaunch case).
- **Accessibility behavior:** focus moves into the sheet on presentation and returns to the
  underlying screen's prior focus point on dismissal.
- **Implementation dependency:** the whole screen is new — requires the global 401 listener
  (`ApiException.isAuthError` is defined but unconsumed today, Phase 2 §12) and
  state-preservation in the Create flow/Lobby specifically (Phase 2 §I.6) for "resume
  normally" to actually mean something.

---

## 15. Dependencies Phase 5+ (Button Contracts, State System, Copy System) must not contradict

1. The ink vessel (§0) is the **only** progress visualization anywhere in the product —
   Phase 5's button contracts and Phase 6's state system must not reintroduce a linear
   progress bar alongside it on any screen.
2. Guest terminal-state copy (§9) is governed by the D25 vocabulary — Phase 7's copy system
   must write exactly six outcome sentences for guests, not a generic template, and must
   never vary them by which underlying vink/contribution state produced the category.
3. Every screen contract above that carries an "Implementation dependency" note is
   **designed, not built** — Phase 5/6/7 may specify buttons/states/copy for these screens,
   but Phase 12/13 implementation must sequence the named backend/data-model work first.
4. No screen contract above introduces a fee line, percentage-split control, payment-methods
   management, or legal content — those stay excluded/deferred per D21/D22 and Phase 3 §5.

## 16. Acceptance criteria for moving to Phase 5

- [ ] Owner confirms the Ink Progress System placement summary (§0) matches intent —
      specifically that Home's variant is compact/non-interactive and the guest vessel is
      aggregate-only.
- [ ] Owner confirms the Register/Profile contact-info addition (§3/§12) is the intended
      single mechanism for capturing D19/D27's delivery target, rather than a separate
      "add contact info later" flow.
- [ ] Owner confirms the Vink details screen's scope (§11) — full participant-level detail
      for the organizer/member is appropriate there (not privacy-scoped like the guest view),
      since it's the user's own Vink history.
- [x] Owner corrected Create's canonical flow (§5, D30) and the Activity detail surface's
      naming (§11, D31) — both amended in place.
- [ ] No item in this document contradicts D1–D31 or Phases 0–3.

Next: Phase 5 (Button and Interaction Contracts) — per-control behavior (enabled/disabled/
pressed/loading/success/failure/retry/analytics/accessibility) for every action named above,
starting with "Pay my share," "Approve $X," and "Open Vink" as the three highest-stakes
controls in the product.
