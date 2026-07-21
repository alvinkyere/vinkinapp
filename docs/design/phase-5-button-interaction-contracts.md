# Phase 5 — Button and Interaction Contracts

_UI/UX Engineering Plan, Phase 5 output: exact behavior for every customer action — tap
target, enabled/disabled logic, loading, retry, cancellation, idempotency, interruption and
restoration, accessibility. Source of truth: `docs/design/phase-0-product-behavior.md`
through `docs/design/phase-4-screen-contracts.md`, `docs/spec/decision-log.md` (D1–D33),
`docs/spec/open-questions.md`, and verified domain/application source
(`packages/domain/src/{vink,contribution}-state-machine.ts`,
`packages/application/src/*`)._

**Status:** DRAFT. **Documentation only — no Flutter, Next.js, backend, API, authentication,
invitation delivery, database, or infrastructure code was modified.** Functional labels only
("Open Vink," "Pay $24.50," "Try again") — full tonal/message refinement is Phase 7's job.
Every contract below is marked **Built**, **Redesign**, or **New — designed, not built**;
the last category is never described as working today.

**Explicitly not invented anywhere in this document** (per instruction, restated as a
standing constraint): a fee, percentage splitting, contacts sync, payment methods, provider
behavior (e.g. digital-wallet tokenization), merchant receipts, legal text, support response
times, financial retries the state machines don't support, or any new backend state beyond
what D1–D33 already establish.

---

## 1. Button hierarchy system

| Tier | Use for | Rule |
|---|---|---|
| **Primary** | The one unmistakable next action on a screen — "Continue," "Open Vink," "Pay $X," "Sign in," "Try again." | Exactly one primary per screen. Two equally dominant primaries is a contract violation, not a style choice. |
| **Secondary** | Reversible or less-important actions — "Edit," "Share another way," "View details," "Change contact." | May coexist with a primary; never competes visually with it. |
| **Tertiary** | Quiet navigation/optional actions — "Back," "Not now," "Learn more," "Close." | Lowest visual weight; text-only or minimal chrome. |
| **Destructive** | Consequential, hard-to-reverse actions only — "Cancel Vink," "Remove participant," "Sign out." | Reserved for actions with real consequence. Never used merely to draw attention to an otherwise-ordinary action. |
| **Icon-only** | Only where meaning is universally obvious (e.g. a close ✕, a back chevron). | Every icon-only control has an accessible label; where ambiguity remains at all, pair it with visible text instead. |

---

## 2. Locked interaction rules

These are binding constraints on every contract below, restated here once for traceability
rather than re-derived per action.

**Create:** two input screens, not five wizard destinations (D30). Purpose+total together.
People+split together. Open Vink confirmation is transient (sheet/dialog). Back from
confirmation returns to People+Split, data intact. Back through Create preserves unsent
input. Leaving Create prompts only when meaningful work would be lost. Equal split
recalculates immediately on add/remove. Custom split can't continue until amounts reconcile
exactly. Percentage stays hidden (D22). No fee anywhere (D21).

**Participant contacts:** name and contact destination are separate fields. Validate
phone/email without ever replacing the visible name with the destination. Reuse saved
contact info only where the product actually supports it today (a looked-up member's own
account contact — nothing else). No contacts-sync is invented. Automatic invitations send
only at `VINK_OPENED` (D23).

**Open Vink:** one tap, one consequential request. Confirmation action disables on
submission. No success shown until the server confirms. Invitation dispatch happens through
the canonical pipeline after `VINK_OPENED`. Partial delivery failure never implies the Vink
itself failed to open. No automatic retry of the open-Vink request that could create
duplicates.

**Live Vink / Ink Progress:** the vessel is driven only by `contributionProgress` (D20/D24).
Never a linear bar beside it. Animates from previous confirmed value to new confirmed value.
Never animates speculative/processing contributions as confirmed. Screen-reader
announcements describe meaningful changes, never countdown ticks. Home: compact vessel only.
Lobby/Guest Session: primary vessel. A participant becoming confirmed updates their row and
the vessel through one coherent transition, not two separate updates.

**Countdown/cutoff:** deadline visible on both mobile and guest-web (fixing the guest-web gap
from Phase 3 §6/§0). Respects the existing grace-window cutoff. Once new contributions are no
longer allowed, the contribution action disables with a customer-outcome explanation, never
processing internals. Countdown expiry resolves to the server-reconciled outcome, never a
client-clock guess.

**Contribution actions:** amount shown equals the amount actually being confirmed. No fee.
Disables immediately on valid submission. Never shows "You're in" optimistically. Shows a
processing state pending server confirmation. A confirmed contribution is never re-offered
after reload/reconnect (D25). Retry only when the server says a new attempt is valid.
Recovery-required states never invite paying again.

**Invitation controls:** automatic delivery is primary (D19). Copy Link/Share/QR are
fallbacks inside one owned sheet. The fallback sheet doesn't auto-open after every successful
send. Delivery failure shows a compact "Share another way," not an alarming error. "Send
again" avoids uncontrolled repeat messaging and clearly reflects whether another send was
accepted. "Is in" is reserved for confirmed contribution status only (fixing Phase 1 §C.5's
premature usage).

**Everyone's-in:** on reaching 100%, the vessel animation completes; "Everyone's in" is a
brief transition, not a permanent screen; auto-continues into payment preparation when no
organizer decision is needed; never shows two success confirmations for the same event.

**Preparing payment:** transient. No provider/issuing/card-provisioning terminology exposed.
No retry button until the system has actually produced a retryable outcome. If it becomes
recovery-required, transitions to the dedicated recovery contract (never the ordinary retry
path).

**Pay now:** visually dominant. No automatic payment after preparation — requires a
deliberate tap. Disables duplicate submission. Never replays after reauth/reconnect/
restoration/restart. Waiting-room controls visually recede once this becomes dominant.

**Activity/Vink details:** one tap opens Vink details. Never labeled "View receipt." Role-
appropriate visibility. Support is reachable where the individual money outcome is unclear or
recovery is required. No destructive/financial action available from a historical detail view
unless the existing product already supports it (it doesn't, so: none).

**Guest web:** server-known invite context renders before realtime connects. Deadline always
visible during an active window. "Not open yet" has no contribution action. Confirmed viewers
have no contribution action. Expired/cancelled viewers are never invited to retry unless a
genuinely new Vink exists. Return-pending/recovery-required viewers are never invited to
contribute again. No signup-conversion prompt on an unsuccessful outcome.

**In-place reauth:** preserves the recognizable interrupted context. "Sign in" is the only
primary action. Never auto-replays the action that hit the auth failure. Refetches/reconciles
server state after success. Restores safe wizard input where still valid. Restores Lobby
state from the server, not a stale snapshot. Shows the real new outcome if the Vink
expired/completed/changed during the interruption.

---

## 3. Action interaction contracts

Each contract uses this template (fields omitted only when genuinely n/a, stated as such):
Screen/surface · Control type · Tier — Label — Visible/Enabled/Disabled(+why) — Tap target —
Immediate response — Loading — Navigation — Optimistic? — Server dependency — Idempotency —
Duplicate-tap prevention — Timeout — Retry — Cancellation — Success — Failure — Interruption
— Restoration — Analytics — Accessibility — Haptic — Current conflict — Dependency —
Acceptance criteria.

### Group A — Auth

**C1. Welcome — "Log in"**
Welcome · Button · Secondary — Label "Log in" — Always visible/enabled — ≥44pt — Navigates to
Login instantly, no loading — Not optimistic — No server call — n/a idempotency — n/a
duplicate-tap (pure navigation) — n/a timeout/retry/cancel — Success: Login screen appears —
Failure: n/a — Interruption: n/a — Restoration: n/a — Analytics: `welcome_login_tapped` —
Accessibility: standard button role/label — Haptic: none — Current conflict: none —
Dependency: none — **Built.** Acceptance: tapping always navigates, never blocked.

**C2. Welcome — "Create account"**
Same shape as C1, Primary tier, label "Create account," navigates to Register,
`welcome_register_tapped`. **Built.**

**C3. Login — "Log in" (submit)**
Login · Button · Primary — Label "Log in" — Visible always; enabled only when username+
password both non-empty — Disabled explanation: none needed (fields simply empty, no error
tone) — ≥44pt, full-width — Immediate: inline spinner replaces label, fields disable —
Loading: button-local, not full-screen — No navigation until success — Not optimistic —
Server: `POST /auth/login` — Idempotency: login is naturally idempotent (repeat attempts just
re-authenticate) — Duplicate-tap: button disabled the instant of first tap — Timeout: standard
network timeout surfaces the offline/error contract (§14) — Retry: unlimited manual retry,
no auto-retry — Cancellation: n/a (fast operation) — Success: navigates to Home — Failure:
inline message under password field, specific, calm, never a raw code — Interruption: app
backgrounded mid-request — request completes in background per platform norms, result applied
on foreground — Restoration: n/a (short-lived screen) — Analytics: `login_attempted`,
`login_failed{code}` — Accessibility: error announced via live region — Haptic: light
failure buzz on error (justified — clear, infrequent negative feedback) — Current conflict:
none — Dependency: none. **Built.**

**C4. Registration — "Create account" (submit)**
Same shape as C3, Primary tier. **New field dependency:** submit also requires the new
contact-info field (Phase 4 §3) to be valid once that field exists — **until contact capture
is built, this field/validation doesn't exist, so submit's enabled-condition today is
name+username+password only.** Analytics: `registration_attempted`,
`registration_failed{code}`. **Built (core fields); New — designed, not built (contact-info
requirement, D19/D27).**

### Group B — Create (canonical D30 shape)

**C5. Home — "Start a Vink"**
Home · Button · Primary — Always visible/enabled (no precondition) — ≥44pt — Navigates to
Create screen 1 instantly — Not optimistic — No server call — Analytics: `create_started` —
Accessibility: standard — Haptic: none — Current conflict: none. **Built.**

**C6. Purpose entry (field, Create screen 1)**
Create §5a · Text field · n/a (field, not a button) — Visible always on screen 1 — No
disabled state (always editable) — Immediate: characters appear as typed — No loading — No
navigation — Validates non-empty before "Next" enables — Restoration: value survives
back-navigation and D26 re-auth interruption (locked rule) — Accessibility: labeled field, not
placeholder-only. **Built.**

**C7. Total entry (field, Create screen 1)**
Create §5a · Numeric field · n/a — Same shape as C6, numeric keypad, validates > $0 before
"Next" enables, formats as currency live. **Built.**

**C8. Add participant**
Create §5b · Button (opens sheet) · Secondary — Label "Add person" — Always visible/enabled —
Opens the Add/Edit Participant sheet — Sheet fields: name, member-lookup-or-guest, delivery
choice (D19) — Server dependency: member lookup hits `GET` by username (existing); guest add
is local until Open Vink commits — Idempotency: adding the same guest name twice creates two
distinct participants (no dedupe by name — matches today's behavior, not a new constraint) —
Duplicate-tap: sheet's own "Add" button disables on tap — Failure: username-not-found
inline-offers "add as guest instead" (Phase 2 §1 fix) — Success: sheet closes, new row
appears in the People list, Equal split recalculates immediately (locked rule) — Analytics:
`participant_add_attempted`, `participant_added{role}` — Accessibility: sheet announces
itself as "Add person" — Current conflict: today's flow generates a functional guest link
immediately on add, before Open (Phase 1 §C.4) — **target: link is inert until `VINK_OPENED`
(D23), a backend gate this contract depends on.** **Redesign.**

**C9. Edit participant**
Create §5b · Row tap → sheet · Secondary — Label: tapping an existing row opens it
pre-filled — Same sheet as C8, "Save" replaces "Add" — Enabled only if the Vink hasn't been
opened yet (Create-phase only; post-open editing is a different, Lobby-scoped concern not
covered by this contract) — Success: row updates, split recalculates if the edited person's
allocation changed — Analytics: `participant_edited`. **New — designed, not built** (no
edit-existing-participant UI confirmed in current five-step wizard).

**C10. Remove participant**
Create §5b · Row action (icon + confirm) · Destructive — Label "Remove" — Icon-only trigger
requires an accessible label ("Remove {name}") per the icon-only rule — Enabled always
pre-open — Immediate: inline confirmation (not a full sheet, this is reversible-adjacent but
still removes a person's allocation, so a lightweight confirm is warranted) — Success: row
disappears, Equal split recalculates immediately (locked rule), Custom split's reconciliation
check re-runs — Analytics: `participant_removed` — Accessibility: removal announced via live
region ("{name} removed, split updated"). **New — designed, not built.**

**C11. Organizer share editing**
Create §5b · Inline field on the organizer's own row · Secondary — Editable exactly like any
Custom-split row (Phase 0 §3 — organizer is a normal participant, can be $0/custom/equal) —
No special affordance distinguishing it from other rows beyond a "you" label. **Built**
(organizer share is already editable, Phase 0 §3), **Redesign** (must render as an ordinary
row per Phase 3 §3's consolidation, not a separate card).

**C12. Equal split selection**
Create §5b · Segmented control · n/a (selection, not a momentary action) — Visible always —
Enabled always — Immediate: every row's allocation updates instantly to the recalculated
equal share — No server call (local computation) — Recalculates immediately whenever
participants are added/removed while Equal is selected (locked rule) — Accessibility:
allocation changes announced once per recalculation, not per row. **Built.**

**C13. Custom split selection**
Create §5b · Segmented control · n/a — Same shape as C12, switches each row to an editable
numeric field, pre-filled with the current Equal-derived amounts as a starting point (not
zeroed) — "Continue" disables until the sum reconciles exactly with the total (locked rule,
Phase 1 §H already confirms this exists today). **Built.**

**C14. Custom amount editing (per-row)**
Create §5b · Numeric field per row · n/a — Visible only when Custom is selected — Immediate:
a running "Assigned $X of $Y" readout updates live (Phase 0 §6 confirms this exists) —
"Continue" enables only at exact reconciliation — No rounding fudge accepted silently — no
fee ever added to reconcile (locked rule). **Built.**

**C15. Open Vink confirmation — "Open Vink"**
Create §5c (transient sheet) · Button · Primary — Label "Open Vink" — Visible once the sheet
is presented — Enabled once presented (input already validated on the prior screen) —
Immediate: button shows inline spinner, **disables on tap** (locked rule: one tap, one
consequential request) — Loading: button-local; sheet stays open, dimmed background —
Navigation: on success, sheet dismisses and the app transitions directly into the Live Vink
Lobby, no intermediate success screen (locked rule: no success shown until server confirms,
and no extra confirmation screen either) — Not optimistic — Server: the `DRAFT → OPEN`
command (`VINK_OPENED`) — Idempotency: this is the one truly consequential creation request
in the whole flow; **no automatic retry on failure that could create a duplicate Vink**
(locked rule) — a failed attempt requires a fresh, deliberate tap — Duplicate-tap: hard
lockout for the duration of the in-flight request — Timeout: on timeout, the button returns
to its enabled state with an error, **never silently retries** — Retry: manual only —
Cancellation: dismissing the sheet before tapping "Open Vink" cancels cleanly, no request
sent, returns to §5b with data intact (locked rule) — Success: navigates to Lobby; this is
also the exact moment automatic invitation dispatch fires through the canonical pipeline
(D19/D23) — **partial invitation-delivery failure must never be represented as the Vink
itself failing to open** (locked rule) — Failure: inline error in the sheet, sheet stays
open, all data intact, "Open Vink" re-enables — Interruption: if a D26 re-auth interruption
occurs mid-request, the request's own outcome (success or failure) is authoritative once
resolved — the UI does not guess — Restoration: after re-auth, refetch whether the Vink
actually opened before showing any state — Analytics: `vink_open_attempted`,
`vink_opened`, `vink_open_failed{code}` — Accessibility: the sheet announces "Opening your
Vink" during the loading state — Haptic: success confirmation buzz on `vink_opened`
(justified — a single, meaningful, infrequent milestone) — Current conflict: today's
standalone Review screen has this action as a full-page button, not a transient sheet action
(D30) — Dependency: none beyond D30 itself. **Redesign.**

### Group C — Invitation delivery

**C16. Automatic invitation delivery (system-initiated)**
Fires at `VINK_OPENED`, no user tap — Visible as a per-participant delivery-status indicator
next to their row ("Sending…" → "Sent" or "Couldn't send") — Not optimistic: status starts
at "Sending," never presumes success — Server: the (not-yet-built) delivery pipeline —
Idempotency: exactly one automatic send per participant per Vink-open, never duplicated by a
client-side retry — Failure: per-participant, surfaces C17 — Analytics:
`invitation_dispatch_attempted{count}`, `invitation_delivered{participantId}`,
`invitation_delivery_failed{participantId}` — Accessibility: status change announced
per-row, not as a batch interruption. **New — designed, not built** (D19/D27 delivery
mechanism dependency).

**C17. Invitation delivery failure**
Lobby/Create §5b · Inline row state + compact action · n/a status, Secondary action — Label
on the compact action: "Share another way" (locked rule — never an alarming full error for a
single failed send) — Visible only on that specific participant's row once failure is known
— Enabled always once shown — Tap target: full row-width tap acceptable (low information
density) — Immediate: opens the invitation-fallback sheet (§C19), pre-focused on that
participant — Analytics: `invitation_fallback_opened{participantId, reason: 'delivery_failed'}`
— Accessibility: row announces "{name}: couldn't send automatically, share another way
available." **New — designed, not built** (depends on C16).

**C18. Send again**
Lobby/Create §5b · Compact action per participant · Secondary — Label "Send again" — Visible
once a delivery attempt (success or failure) has occurred for that participant — Enabled with
a cooldown (locked rule: "avoid uncontrolled repeated messaging") — **exact cooldown
duration is an implementation detail, not fixed here; the contract requirement is that one is
enforced** — Disabled explanation while cooling down: "Sent just now" or similar, not silence
— Immediate: button shows inline spinner briefly, then reflects accepted/failed — Success:
"Sent" — Failure: falls back to C17's "Share another way" state — Idempotency: server-side
dedupe prevents a rapid double-tap from producing two messages even if the client-side
cooldown is somehow bypassed — Duplicate-tap: disabled immediately on tap regardless of
cooldown state — Analytics: `invitation_resend_attempted{participantId}` — Accessibility:
result announced ("Sent again" / "Couldn't send"). **New — designed, not built.**

**C19. Share another way (opens the fallback sheet)**
Lobby/Create §5b · Button · Secondary — Label "Share another way" — Visible always once a
participant exists needing invitation (not conditional on failure — this is the general
manual-fallback entry point per D19, C17 is the failure-triggered variant of reaching the
same sheet) — Opens **one owned bottom sheet** containing Copy Link/System Share/Show QR
(locked rule: fallbacks live inside one sheet, never scattered) — **Does not auto-open after
every successful automatic send** (locked rule) — Analytics: `invitation_fallback_opened
{participantId, reason: 'manual'}`. **Built** (today's only path, Phase 1 §C.7), **Redesign**
(reframed from primary/only to secondary/fallback per D19).

**C20. Copy Link**
Invitation-fallback sheet · Button · Secondary — Label "Copy link" — Visible/enabled always
within the sheet — Immediate: link copied, inline confirmation text replaces the label
briefly ("Copied") then reverts — Not optimistic (copy is synchronous, always "succeeds" at
the OS level) — No server call beyond having already fetched the link — Analytics:
`invite_link_copied` — Accessibility: confirmation announced via live region — Haptic: light
tap confirmation (justified — instant, frequent, low-stakes). **Built.**

**C21. System Share**
Invitation-fallback sheet · Button · Secondary — Label "Share" — Opens the OS share sheet —
No app-level success/failure state (the OS owns that surface once opened) — Analytics:
`invite_share_sheet_opened` (not "sent" — the app can't know the outcome of the OS sheet).
**Built.**

**C22. Show QR**
Invitation-fallback sheet · Button · Secondary — Label "Show QR code" — Reveals the QR image
inline within the sheet (not a second nested sheet — locked rule against nesting, §12) —
Analytics: `invite_qr_shown`. **Built.**

### Group D — Contribution

**C23. Organizer contribution — "Pay $24.50" (example label)**
Lobby · Button · Primary — Label "Pay $X" where X is the organizer's own exact allocated
amount (locked rule: amount shown equals amount confirmed, no fee) — Visible while the
organizer's own `contributionStatus`-equivalent is `not_started`/`declined` — Disabled once
submission begins, and permanently hidden once `confirmed` (never re-offered, D25) —
Disabled explanation while submitting: button shows "Processing…" in place of the label, not
a separate disabled-with-tooltip pattern — Immediate: button disables, label swaps to a
processing state, **no optimistic "You're in"** (locked rule) — Loading: button-local
processing state, rest of screen stays interactive — Navigation: none (stays on Lobby) —
Server: the same `/contributions/authorize` command used by every participant (Phase 0 §3,
D13 — no role-based shortcut) — Idempotency: server-derived stable operation id per attempt
(Spec §12) — Duplicate-tap: hard lockout for the duration of the in-flight request — Timeout:
returns to enabled state with an error on timeout, no silent retry — Retry: only a genuinely
**new** attempt after `DECLINED` (never "retry the same one" — locked rule and domain
invariant) — Cancellation: not cancellable once submitted (matches the domain's own
authorize-then-resolve shape) — Success: row updates to confirmed, vessel animates (§16),
button disappears — Failure: inline, specific, human-worded (Phase 0 §7's already-correct
pattern), offers a genuinely new attempt — Interruption: a D26 re-auth mid-request never
replays the payment action (locked rule) — outcome resolves server-side regardless —
Restoration: on resume, `contributionStatus` is refetched, never assumed — Analytics:
`contribution_attempted`, `contribution_confirmed`, `contribution_declined` — Accessibility:
state change announced ("Payment confirmed") — Haptic: success buzz on confirmation
(justified). **Built** (core mechanics), **Redesign** (processing-state discipline, vessel
integration).

**C24. Member contribution**
Identical contract to C23 — same endpoint, same UI, per Phase 0 §3's "no special-casing by
role." **Built, Redesign** (same basis as C23).

**C25. Guest contribution — "Approve $24.50"**
Guest Session · Button · Primary — Label "Approve $X" — Visible while own
`contributionStatus` is `not_started`/`declined` — **Never shown again once `confirmed`,
across reload/reconnect/return** (D25, the core fix) — Same processing/no-optimistic/
duplicate-tap-lockout shape as C23 — Server: same authorize command, guest-scoped — Success:
transitions to the confirmed outcome statement (Phase 4 §9), plays the one-time
droplet-joining moment (§16) — Failure: guest-web's new human-error-message layer (Phase 1
§D.1 fix), never a raw backend string — Restoration: **`contributionStatus` is refetched
from the server on every load, never derived from a local flag** (D25/D24 — this is the exact
fix for Phase 1 §C.11's reload bug) — Analytics: `guest_contribution_attempted`,
`guest_contribution_confirmed`, `guest_contribution_declined` — Accessibility: same pattern
as C23. **Redesign** — mechanically similar to C23/C24 today, but the never-re-offered
guarantee is **New — designed, not built** (depends on guest `contributionStatus`, D24).

**C26. Retry contribution (new attempt after DECLINED)**
Lobby/Guest Session · Button · Primary — Label "Try again" — Visible only when
`contributionStatus == declined` — This creates a **new** contribution attempt
(`attemptNumber` + 1), never resubmits the declined one (domain invariant, DECLINED is
terminal per-attempt) — Same processing/duplicate-tap shape as C23 — **Retry only when the
server says another attempt is valid** (locked rule) — if the Vink has since left `OPEN`
(deadline passed), "Try again" is not shown at all; the screen instead reflects the real
outcome (expired/etc.) — Analytics: `contribution_retry_attempted`. **Built** (mechanically,
via a fresh authorize call), **Redesign** (labeling/framing as an explicit new attempt, not a
retry of the same payment).

**C27. Cancel Vink**
Lobby · Button · Destructive — Label "Cancel Vink" — Visible only to the organizer, only
while `OPEN` (the only state this transition is modeled from, Phase 2 §8) — Enabled always
while visible — Immediate: opens a confirmation sheet (§17) — **not a single-tap destructive
action** — irreversibility requires the extra step — Confirmation sheet's own action:
"Cancel Vink" (destructive, confirms) / "Never mind" (tertiary, dismisses) — Server: the
`ORGANIZER_CANCELLED` command — Idempotency: cancelling an already-cancelled Vink is a no-op
success, not an error — Duplicate-tap: confirmation button disables on tap — Success: Vink
reaches `CANCELLED`, screen shows the calm "no one was charged" outcome (Phase 0 §11) —
Failure: inline error in the confirmation sheet, sheet stays open — Analytics:
`vink_cancel_attempted`, `vink_cancelled` — Accessibility: confirmation sheet requires
explicit confirmation, announced clearly, preventing accidental activation (matches the
Sign-out pattern, Phase 4 §12) — Haptic: a firm (not celebratory) confirmation buzz on
success. **Built** (mechanically), **Redesign** (confirmation-sheet framing, if not already
present — flagged as unverified, not confirmed built).

### Group E — Live Vink / Ink Progress / Payment

**C28. Ink Progress updates (vessel animation)**
Lobby/Guest Session · Live visual, not a discrete tap · n/a — Trigger: any participant's
`contributionStatus` reaching `confirmed` — Driven only by `contributionProgress`
(D20/D24), never `fundedAmountMinor` (locked rule, restated from Phase 4 §0) — Animates from
the previous confirmed value to the new one; **never animates a `pending`/processing
contribution as if confirmed** (locked rule) — Reduced motion: a quick level change replaces
the traveling-droplet animation, per the amendment's own requirement — Screen-reader:
announces the new fraction and (Lobby/full-vessel only) who's still waited on, **not** every
intermediate frame and never a countdown tick (locked rule) — Interruption: an animation
interrupted by a second confirmation arriving mid-animation completes to the latest true
value, never stacks/queues animations. **New — designed, not built** (depends on
`contributionProgress`, D24).

**C29. Everyone's-in transition**
Lobby/Guest Session · System-driven screen state, no user tap · n/a — Trigger:
`contributionProgress` reaches 100% (all confirmed) — Vessel animation completes as its
final frame, not a separate second animation — "Everyone's in" is shown as a brief transition
banner/state, **not a permanent additional screen** (locked rule) — Auto-continues into the
Preparing Payment state (§C30) once card provisioning begins, with no organizer decision
required in between — **exactly one success confirmation for this event**, never a Lobby
banner plus a separate push notification plus a badge change all narrating the same thing
(locked rule) — Reduced motion: the transition is a brief text/color change, no
choreography — Accessibility: announced once as "Everyone's ready" (matches §16's
screen-reader pattern). **New — designed, not built** (depends on C28's data source).

**C30. Preparing payment**
Lobby · Transient screen state, no user action · n/a — Visible during `CARD_PROVISIONING` —
Label/copy: "Getting your card ready" (already correct today, Phase 1) — **No provider,
issuing, or card-provisioning terminology exposed** (locked rule, already satisfied) — **No
retry button** during normal preparation — a retry only appears if the system produces an
actual retryable failure (which today routes to `FUNDING_REVERSAL → EXPIRED`, a
non-retryable terminal outcome per Phase 0 §11 — so in practice, **no retry control exists
for this transition today, correctly** — flagged so a future implementer doesn't add one
speculatively) — If provisioning instead becomes a settlement-time recovery-required
situation, that's a distinct, later transition (§C-recovery, not this one) — Analytics:
`card_provisioning_started` (system event, not user-triggered). **Built** (label/copy),
confirmed correct, no changes needed.

**C31. Pay now (deliberate entry into the focused payment surface) — amended per D32**
Lobby · Button · Primary — Label "Pay now" — Visible once `CARD_READY` — **Requires a
deliberate tap; reaching `CARD_READY` never automatically reveals a sensitive payment
instrument or initiates merchant payment** (locked rule, reaffirmed by D32) — Immediate:
transitions the organizer into a **focused payment surface** — a distinct, dedicated
screen/moment, not an inline reveal within the Lobby — Disables after the first tap for the
duration of the transition, to prevent a redundant re-tap reading as re-submission —
**Never replays after reauthentication, reconnect, restoration, or app restart** —
restoring into `CARD_READY` returns the organizer to the same focused payment surface
consistently, not a fresh un-entered state requiring a second tap — Waiting-room controls
(participant list, vessel) visually recede in prominence once this becomes the dominant
object (locked rule) — No in-app "payment succeeded" confirmation is triggered by this tap
itself — that comes from C32, driven by the actual merchant authorization/settlement,
external to this tap — Analytics: `pay_now_entered` — Accessibility: "Ready to pay — $X
available" announced on entry — Haptic: a single confirming tap-buzz on entry (justified —
one clear, infrequent milestone).

**D32 amendment — what the focused payment surface actually contains is intentionally not
locked here:** it must **eventually** provide an actually usable, provider-supported
presentment method — last-four digits and the spending limit (Phase 0 §10's display-safety
rule) may appear as safe summary information inside that surface, but **are not, by
themselves, a complete payment experience**, and this contract does not claim otherwise. This
document does **not** commit the canonical design to wallet provisioning, full-card
presentation, or any other specific provider-dependent method — which method ships depends on
the still-open M0 provider gate (G1). If full virtual-card credentials are ever supported,
they appear **only** inside this focused surface, only after this deliberate tap, remain
masked until explicitly requested there, and **never** appear on Home, in Lobby progress, in
Activity, or in Vink Details. **Current implementation conflict:** today's Lobby displays
last-four/limit passively within `_CardCard` inline in the Lobby itself (Phase 1 §D.4), with
no distinct focused surface and no deliberate-tap gate at all — the deliberate-transition
shell of this contract is **New — designed, not built**; the focused surface's actual
provider-supported presentment content is **New — designed, not built, and explicitly
incomplete/provider-dependent (D32)**, not merely unbuilt.

**C32. Payment completion**
Lobby/Guest Session · System-driven screen state · n/a — Trigger: `SETTLEMENT_MATCHED` (→
`COMPLETED`) or the overage branch (`SETTLEMENT_OVERAGE_DETECTED` → `RECOVERY_REQUIRED`,
routes to the dedicated recovery contract, §C-guest-recovery, never shown as an ordinary
failure) — Visible information: "the merchant was paid $X" (Phase 4 §6/§11's outcome-clarity
fix) — No user action required — the screen is now purely informational — Analytics:
`vink_completed` (system event) — Accessibility: outcome sentence is the primary announced
content on arrival at this state. **Built** (mechanically), **Redesign** (outcome-clarity
copy, Phase 1 §C.11 fix).

### Group F — Activity / Profile

**C33. Activity row opening**
Activity · List row tap · n/a (whole row is the tap target, not a separate button) — Visible/
enabled always for every entry — Immediate: navigates to Vink details (§C34) — Not
optimistic — Loading: standard skeleton if the detail data isn't already cached from the list
fetch — Analytics: `activity_row_opened{vinkId}` — Accessibility: row's accessible label
states purpose/outcome/date together (Phase 4 §10), activating it is unambiguous. **New —
designed, not built** (today's list is non-interactive, Phase 1 confirmed via grep — D29).

**C34. Vink details actions**
Vink details · Read-only screen, no consequential actions · n/a — **No destructive or
financial action available here** (locked rule — matches current product behavior, which has
none) — The only interactive elements are: back navigation (tertiary) and, **where the
individual money outcome is unclear or recovery is required, a "Contact support" link**
(locked rule) reusing C37 — Analytics: `vink_details_opened{vinkId}`. **New — designed, not
built** (D29/D31).

**C35. Contact information editing**
Profile · Button → field editor · Secondary — Label "Edit" next to the contact-info row —
Enabled always — Opens an editor with name and contact-destination as **separate fields**
(locked rule) — Validates phone/email format without ever substituting the destination for
the visible display name anywhere else in the product (locked rule) — Save disabled until
valid — Success: returns to Profile, updated value shown — Analytics:
`contact_info_updated` — Accessibility: standard field-editor pattern. **New — designed, not
built** (D19/D27 prerequisite, Phase 4 §12).

**C36. Change Password**
Profile · Button → field editor · Secondary — Label "Change password" — Current password +
new password fields — Save disabled until both valid — Success: confirmation, returns to
Profile — Failure: inline, specific ("current password doesn't match") — Analytics:
`password_change_attempted`, `password_changed`. **New — designed, not built** (Phase 3 §5).

**C37. Support contact**
Profile (and Vink details, via C34) · Button/link · Secondary — Label "Contact support" —
Enabled always — Immediate: opens the configured support channel (e.g. a mail composer to a
support address) — **No response-time commitment is stated anywhere** (explicitly not
invented, per instruction) — Analytics: `support_contact_opened{source: 'profile'|'vink_details'}`.
**New — designed, not built** (D28).

### Group G — Guest-specific behavior

**C38. Guest not-open-yet behavior**
Guest "not open yet" state (Phase 4 §7) · No action exists · n/a — **Zero contribution
action, by definition** (locked rule) — The only "interaction" is passive: the screen
transitions itself automatically on `VINK_OPENED`, requiring no tap — Accessibility: `role=
"status"`, calm tone. **New — designed, not built** (D23).

**C39. Guest confirmed behavior**
Guest Session, `contributionStatus == confirmed` · No contribution action exists · n/a — This
is the direct implementation of C25's "never shown again" guarantee, stated here as its own
locked behavior for clarity — The screen instead shows the confirmed outcome statement — no
button, no re-offer, under any reload/reconnect/return path (D25). **New — designed, not
built.**

**C40. Guest expiry behavior**
Guest Session, `expired` category (D25) · No action, or "Share another way is unavailable"
implicitly (nothing to share, Vink is closed) · n/a — Outcome statement: "you were never
charged" — **Never invited to retry unless a genuinely new Vink exists** (locked rule) — no
"create a new one" CTA is invented here, since guests can't create Vinks (Phase 0 §1). **New
— designed, not built** (D24/D25).

**C41. Guest cancellation behavior**
Guest Session, `cancelled` category (D25) · No action · n/a — Outcome statement: "the
organizer cancelled — you were never charged" — Same no-retry rule as C40. **New —
designed, not built.**

**C42. Guest return-pending / returned behavior**
Guest Session, `return_pending`/`returned` categories (D25) · No action · n/a — Outcome
statement per Phase 2 §G's exact copy triggers — **Never invited to contribute again**
(locked rule) — the internal `REFUND_FAILED` retry loop (Phase 2 §9) is never surfaced as a
guest-facing failure requiring any tap. **New — designed, not built.**

**C43. Guest recovery-required behavior**
Guest Session, `recovery-required` category (D25) · No action · n/a — Outcome statement:
calm "your part is done" (Phase 2 §10) — **Never encourages paying again, under any
circumstance** (locked rule — this is the state most at risk of an incorrectly-invented "pay
the difference" button; explicitly, no such control exists in this contract or anywhere else
in this document). **New — designed, not built.**

### Group H — Cross-cutting

**C44. In-place reauthentication — "Sign in" (D26)**
Reauth sheet (Phase 4 §14) · Button · Primary — Label "Sign in" — **The only primary action
in the sheet** (locked rule) — "Cancel" is secondary, leads to full sign-out — Enabled once
both fields non-empty — Same processing/duplicate-tap-lockout shape as C3 — Success: sheet
dismisses; **refetches and reconciles server state for whatever screen was interrupted**
(locked rule) — for Create: restores safe wizard input where still valid (locked rule); for
Lobby: restores from a fresh server fetch, never a stale cached snapshot (locked rule) — if
the underlying Vink expired/completed/changed during the interruption, **the real new outcome
is shown**, not the pre-interruption state (locked rule) — **the action that originally hit
the auth failure is never automatically replayed** (locked rule — e.g. if "Pay my share" was
mid-flight when the session died, re-auth does not silently resubmit it; the organizer sees
the Lobby's true current state and takes a fresh, deliberate action if one is still needed) —
Analytics: `reauth_prompted`, `reauth_succeeded`, `reauth_cancelled`. **New — designed, not
built** (D26).

**C45. Offline, reconnect, retry, and unexpected-error actions**
Global pattern, not one screen · Inline banners/buttons · Secondary (retry actions),
n/a (status banners) — A persistent-but-quiet offline indicator (not a blocking modal) —
Any disabled action while offline states the reason inline ("You're offline") rather than
failing silently on tap — On reconnect, in-flight *reads* refresh automatically; in-flight
*writes* are never auto-resubmitted (matches the no-auto-retry-of-consequential-requests
rule extended globally) — A generic unexpected error (not one of the specific contracts
above) shows a calm, non-technical message with a manual "Try again" — **"Try again" retries
the read/fetch that failed, never blindly resubmits whatever the last consequential write
attempt was** — Analytics: `offline_detected`, `reconnected`, `generic_error_shown{context}`
— Accessibility: connectivity-state changes announced once, not repeatedly. **Built**
(general network-error handling exists per Phase 1's `human_errors.dart` on mobile),
**Redesign** (guest-web needs the equivalent layer, Phase 1 §D.1).

---

## 4. Master action inventory

| ID | Action | Screen | Tier | Status |
|---|---|---|---|---|
| C1 | Log in (nav) | Welcome | Secondary | Built |
| C2 | Create account (nav) | Welcome | Primary | Built |
| C3 | Log in (submit) | Login | Primary | Built |
| C4 | Create account (submit) | Registration | Primary | Built + New (contact field) |
| C5 | Start a Vink | Home | Primary | Built |
| C6 | Purpose entry | Create 1 | field | Built |
| C7 | Total entry | Create 1 | field | Built |
| C8 | Add participant | Create 2 | Secondary | Redesign |
| C9 | Edit participant | Create 2 | Secondary | New |
| C10 | Remove participant | Create 2 | Destructive | New |
| C11 | Organizer share editing | Create 2 | Secondary | Built + Redesign |
| C12 | Equal split selection | Create 2 | n/a | Built |
| C13 | Custom split selection | Create 2 | n/a | Built |
| C14 | Custom amount editing | Create 2 | field | Built |
| C15 | Open Vink confirmation | Create sheet | Primary | Redesign |
| C16 | Automatic invitation delivery | system | n/a | New |
| C17 | Invitation delivery failure | Lobby/Create | Secondary | New |
| C18 | Send again | Lobby/Create | Secondary | New |
| C19 | Share another way | Lobby/Create | Secondary | Built + Redesign |
| C20 | Copy Link | fallback sheet | Secondary | Built |
| C21 | System Share | fallback sheet | Secondary | Built |
| C22 | Show QR | fallback sheet | Secondary | Built |
| C23 | Organizer contribution | Lobby | Primary | Built + Redesign |
| C24 | Member contribution | Lobby | Primary | Built + Redesign |
| C25 | Guest contribution | Guest Session | Primary | Redesign + New |
| C26 | Retry contribution | Lobby/Session | Primary | Built + Redesign |
| C27 | Cancel Vink | Lobby | Destructive | Built + Redesign |
| C28 | Ink Progress updates | Lobby/Session | n/a | New |
| C29 | Everyone's-in transition | Lobby/Session | n/a | New |
| C30 | Preparing payment | Lobby | n/a | Built |
| C31 | Pay now | Lobby | Primary | New |
| C32 | Payment completion | Lobby/Session | n/a | Built + Redesign |
| C33 | Activity row opening | Activity | n/a | New |
| C34 | Vink details actions | Vink details | n/a | New |
| C35 | Contact information editing | Profile | Secondary | New |
| C36 | Change Password | Profile | Secondary | New |
| C37 | Support contact | Profile/Vink details | Secondary | New |
| C38 | Guest not-open-yet | Guest Session | n/a | New |
| C39 | Guest confirmed | Guest Session | n/a | New |
| C40 | Guest expiry | Guest Session | n/a | New |
| C41 | Guest cancellation | Guest Session | n/a | New |
| C42 | Guest return-pending/returned | Guest Session | n/a | New |
| C43 | Guest recovery-required | Guest Session | n/a | New |
| C44 | In-place reauthentication | Reauth sheet | Primary | New |
| C45 | Offline/reconnect/retry/error | global | Secondary | Built + Redesign |

---

## 5. Screen-by-screen primary-action matrix

| Screen | Primary (exactly one) |
|---|---|
| Welcome | "Create account" (C2) |
| Login | "Log in" (C3) |
| Registration | "Create account" (C4) |
| Home | "Start a Vink" (C5) |
| Create screen 1 | "Next" (unlisted trivial nav, same tier as C6/C7's implicit continue) |
| Create screen 2 | "Continue" (leads to C15) |
| Open Vink confirmation | "Open Vink" (C15) |
| Lobby (unpaid) | "Pay $X" (C23/C24) |
| Lobby (paid, waiting) | none — no primary while merely observing (correct: a screen may have zero primaries, never two) |
| Lobby (CARD_READY) | "Pay now" (C31) |
| Guest Join Form | "Join" (unlisted, same tier as C15's peer) |
| Guest Session (pre-contribution) | "Approve $X" (C25) |
| Guest Session (confirmed/terminal) | none |
| Activity | none (list, not a form) |
| Vink details | none (read-only) |
| Profile | none (a settings hub, not a task) |
| Reauth sheet | "Sign in" (C44) |

## 6. Secondary and tertiary action matrix

| Screen | Secondary | Tertiary |
|---|---|---|
| Create screen 2 | "Add person" (C8), "Edit" per row (C9) | "Back" |
| Lobby | "Share another way" (C19), "Send again" (C18) | "Back" |
| Invitation fallback sheet | "Copy link" (C20), "Share" (C21), "Show QR" (C22) | "Close" |
| Activity | — | "Back" from Vink details |
| Vink details | "Contact support" (C37, conditional) | "Back" |
| Profile | "Edit" contact (C35), "Change password" (C36), "Contact support" (C37) | — |
| Reauth sheet | — | "Cancel" (leads to sign-out, itself destructive-adjacent but framed tertiary in-sheet per D26's "only Sign in is primary" rule — its *consequence* is significant even though its *sheet-local* tier is quiet) |

## 7. Destructive-action matrix

| Action | Screen | Confirmation required? | Consequence stated |
|---|---|---|---|
| Cancel Vink (C27) | Lobby | Yes — dedicated sheet | "No one was charged" |
| Remove participant (C10) | Create screen 2 | Lightweight inline confirm | Split recalculates |
| Sign out (Phase 4 §12) | Profile | Yes — explicit confirmation | Session ends |

No other destructive actions exist anywhere in this document — **no destructive/financial
action lives on Vink details** (locked rule, C34).

---

## 8. Button state model

Every button in this document uses the same five-state model — no screen invents a sixth:

1. **Default** — enabled, at rest.
2. **Disabled** — visually reduced, never a mystery why (either self-evident, like an empty
   required field, or explained inline per that action's contract).
3. **Pressed/loading** — the instant-of-tap through in-flight-request state; label swaps to a
   processing treatment or an inline spinner appears, button locked against re-tap.
4. **Success** — brief, only where a discrete success confirmation is warranted (most
   consequential actions navigate away instead of lingering in a success state — an explicit
   design choice, avoiding the "multiple success confirmations" anti-pattern from the
   Everyone's-in rule).
5. **Error** — returns to Default's visual weight but with an inline error message attached;
   never a stuck permanent-error visual state — another tap always re-attempts.

---

## 9. Duplicate-tap and idempotency matrix

| Action | Client-side lockout | Server-side guarantee |
|---|---|---|
| Open Vink (C15) | Hard disable on tap | Single `VINK_OPENED` command, D13 command model |
| Pay $X / Approve $X (C23/C24/C25) | Hard disable on tap | Server-derived stable operation id per attempt (Spec §12) |
| Cancel Vink (C27) | Confirmation button disables on tap | Idempotent — cancelling an already-cancelled Vink is a no-op success |
| Send again (C18) | Disables on tap + cooldown | Server-side dedupe as a backstop against a bypassed client cooldown |
| Copy Link / Show QR (C20/C22) | n/a — synchronous, no server round-trip | n/a |
| Sign in (C3/C44) | Hard disable on tap | Naturally idempotent (re-authentication) |

**Standing rule, all actions:** no client ever auto-retries a consequential (state-changing)
request on timeout or failure. Only the user's own fresh tap re-attempts.

---

## 10. Loading and timeout interaction matrix

| Context | Loading treatment | Timeout behavior |
|---|---|---|
| Screen first paint (Home, Lobby, Guest Session) | Cached last-known content instantly, background refresh reconciles silently (Phase 4 §4/§6/§9) | n/a — cached content never "times out," it's simply superseded when fresh data arrives |
| Button-local action (Pay, Open Vink, Sign in) | Inline spinner/processing label on the button only, rest of screen stays interactive | Returns to Default+error state, never silently hangs |
| Vink details / Activity direct deep-link | Skeleton, not a blocking spinner | Clear "not available"/offline message on failure |
| Guest "not open yet" (C38) | No loading — a defined static state, not a wait | n/a |

---

## 11. Retry eligibility matrix

| Action | Retryable? | What "retry" actually means |
|---|---|---|
| Contribution (C23/C24/C25) after `DECLINED` | Yes | A genuinely new attempt (new `attemptNumber`), never resubmission of the declined one |
| Contribution after deadline passed | No | The screen shows the real outcome (expired) instead of a retry control |
| Open Vink (C15) after failure | Yes, manual only | Fresh tap, fresh request — no state carried over that could double-submit |
| Login/Registration after failure | Yes, unlimited manual | Standard re-submission, naturally idempotent |
| Refund (`REFUND_FAILED` → `REFUND_RETRIED`) | Not user-facing | Server-internal retry loop (Phase 2 §9); no UI retry control exists or should exist |
| Recovery ladder retries | Not user-facing | Organizer off-session charge retries are automatic, server-driven (Phase 0 §11); **no in-app "retry recovery" control exists anywhere in this document** |
| Send again (C18) | Yes, cooldown-gated | A new send attempt through the same pipeline |

---

## 12. Bottom-sheet inventory

| Sheet | Owns | Dismissal behavior | Unsaved-edit protection |
|---|---|---|---|
| Add/Edit Participant (C8/C9) | Name, contact, delivery-choice fields | Background tap or swipe-down prompts "Discard this person?" if any field has content | Yes — explicit prompt, never silent discard |
| Open Vink confirmation (C15) | The allocation summary + "Open Vink" | Background tap dismisses to Create screen 2 with all data intact (locked rule — no confirmation needed here since nothing is lost) | n/a — dismissal never loses data by construction |
| Invitation fallback (C19–C22) | Copy Link/System Share/Show QR | Background tap dismisses freely — no unsaved state exists in this sheet | n/a |
| Cancel Vink confirmation (C27) | "Cancel Vink" / "Never mind" | Background tap dismisses as "Never mind" (safe default — the destructive path always requires an explicit tap, never an accidental one) | n/a |
| Contribution confirmation | **Not required (ratified by D33)** — the amount-bearing action itself is the confirmation; the existing payment semantics (authorize → server-confirmed outcome) already provide the safeguard, and a second confirm-before-authorize step would contradict "one tap, one consequential request" for an action that isn't Open-Vink-scale irreversible (a declined contribution simply allows a new attempt) | n/a | n/a |
| Support contact context (C37) | Whatever context launched it (Profile vs. a specific Vink details screen) — pre-fills that context so the organizer doesn't have to re-explain | Dismisses freely | n/a |

**No sheet ever opens another sheet** (locked rule) — Show QR reveals inline within the
invitation-fallback sheet rather than stacking a second sheet on top of it.

---

## 13. Form interaction and validation contracts

- Every field validates inline, on blur or on a debounced keystroke — never only on submit
  attempt (matches Phase 4's existing error-behavior discipline).
- Required-but-empty is a **disabled** primary action, not a red error shown before the user
  has even tried — errors appear only after an actual invalid attempt (a value entered and
  found wrong, or a submit tapped while empty).
- Currency fields format live as the user types, always via the shared money-formatting
  utility (Phase 0 §12) — never a raw unformatted number shown even momentarily.
- Contact-info fields (Registration C4, Profile C35, Add Participant C8) validate phone/email
  shape but **never substitute the destination value for the person's display name anywhere
  else in the UI** (locked rule) — these remain visibly separate fields end to end.
- Custom split fields (C14) show a live running total; the primary action stays disabled
  until exact reconciliation — no "close enough" tolerance, no fee absorbs the remainder
  (locked rule).

---

## 14. Keyboard, focus, and field-advance rules

- Text fields advance focus to the next field on "return"/"next" where a clear next field
  exists (e.g. username → password on Login); the last field in a form submits instead of
  advancing.
- Numeric fields (Total, Custom Amount) show the numeric keypad, never the full alphanumeric
  keyboard.
- On sheet presentation (Add Participant, Reauth), focus moves to the sheet's first field
  automatically; on dismissal, focus returns to whatever triggered the sheet (matches Phase 4
  §14's accessibility behavior).
- No field auto-advances so aggressively that it skips validation feedback — advancing never
  suppresses an inline error that should be shown first.

---

## 15. Back-navigation and dismissal rules

- Create screen 2 → screen 1: preserves all entered data (locked rule).
- Open Vink confirmation → screen 2: preserves all data, no confirmation prompt needed since
  nothing is at risk of loss (locked rule).
- Create screen 1 → Home: prompts only if meaningful work would be lost — defined here as
  **any of purpose, total, or an added participant being non-empty**; a screen 1 with only a
  category selected and nothing else exits silently (not "meaningful").
- Lobby → Home: never prompts (leaving doesn't affect the Vink itself).
- Reauth sheet's device-back acts as "Cancel" (Phase 4 §14).
- Guest web has no in-app back stack beyond the browser's own (Phase 4, multiple contracts) —
  no back-navigation contract is invented for guest-web beyond standard browser behavior.

---

## 16. Invitation-delivery interaction model

Automatic (D19) is the primary path, evaluated first; manual is the fallback, always
available:

```
VINK_OPENED
  → automatic dispatch attempts per participant (C16)
      success → row shows "Sent" (fixes Phase 1 §C.5's premature "is in" — "is in" reserved
                for confirmed contribution status only, never delivery status)
      failure → row shows the compact "Share another way" action (C17)
  → organizer may at any time open the fallback sheet manually (C19), whether or not
    automatic delivery succeeded — this is always available, never gated behind a failure
  → within the fallback sheet: Copy Link (C20) / System Share (C21) / Show QR (C22)
  → "Send again" (C18) available per participant, cooldown-gated, clearly reflects whether
    another send was accepted
```

The fallback sheet **never auto-opens** after a successful automatic send (locked rule) — it
only opens on an explicit tap (C19) or a failure's compact action (C17).

---

## 17. Ink Progress interaction and motion specification

| Trigger | Affected elements | Interruption behavior | Reduced-motion alternative | Haptic? |
|---|---|---|---|---|
| A participant's contribution confirms | The vessel fill level, that participant's row | A second confirmation arriving mid-animation resolves to the latest true value, never stacks | Instant level change, no travel | No (frequent, not a milestone) |
| Final participant confirms (100%) | Vessel completes fill, "Everyone's in" transition (C29) | n/a — this is itself the completion of the prior animation | Instant full-level change + text state change | Yes — one clear milestone buzz |
| Guest's own contribution confirms | Vessel (aggregate) + a one-time droplet-joining moment for the guest's own confirmation | If the guest navigates away mid-animation, no animation replays on return — the end state is simply shown | Instant, no droplet travel | No (guest already gets a haptic-equivalent via their own success state, avoiding double feedback) |
| Payment becomes ready (CARD_READY) | "Pay now" becomes dominant, waiting-room controls visually recede | n/a (state-driven, not itself animated repeatedly) | Instant layout change | Yes — one milestone buzz (C31) |
| Merchant payment completes | Screen transitions to the outcome statement | n/a | Instant | Yes — one milestone buzz (C32) |

**Never:** decorative delays, forced celebration screens, or any animation that postpones
access to the "Pay now" action once it's genuinely available (locked rule, restated from the
amendment).

---

## 18. Countdown and deadline interaction rules

- Deadline is rendered on **both** mobile (already built) and guest-web (**new — designed,
  not built**, Phase 3 §6/§0 gap).
- Displayed only while `OPEN` and a countdown is meaningful; replaced by the terminal-state
  outcome once the Vink leaves `OPEN` — never shown alongside a terminal outcome
  simultaneously.
- The existing grace-window cutoff (D5's resolver) is respected exactly — the UI never
  invents its own earlier or later cutoff.
- On expiry, the countdown doesn't just stop or gray out — the whole affected area
  transitions to the reconciled server outcome (locked rule: "countdown expiry must
  transition from active interaction to the correct reconciled server outcome rather than
  relying only on the client clock") — i.e., the client shows the countdown reaching zero,
  then **waits for and shows the server's actual resulting state**, not an assumed one.
- No screen-reader announcement fires per countdown tick (locked rule, restated from §2/§16).

---

## 19. Contribution and merchant-payment safeguards

- Amount shown always equals amount confirmed — no fee, ever (D21, restated).
- No optimistic "You're in" / "confirmed" state anywhere — every confirmation waits for the
  server (C23/C24/C25).
- A confirmed contribution is never re-offered (D25, C39) — the single most safety-critical
  rule in this document, since violating it risks a guest believing they need to pay twice.
- Recovery-required states never present a "pay again" control anywhere, for anyone —
  organizer or guest (C43, §11's retry-eligibility matrix explicitly excludes it).
- "Pay now" (C31) requires a deliberate tap and never replays across interruption (C31, C44).
- No financial retry exists in this document beyond what the domain's own state machines
  support: a new contribution attempt after `DECLINED`, and the server-internal refund retry
  loop (never user-facing).

---

## 20. Reauthentication restoration interaction model

```
Unrecoverable 401 (refresh token dead)
  → global listener triggers the reauth sheet (C44), over whatever screen was active
  → underlying screen freezes-but-stays-visible (not interactive, not hidden)
  → "Sign in" (only primary action) or "Cancel" (→ full sign-out, Login screen)
  → on success:
      - sheet dismisses
      - underlying screen refetches fresh server state (never trusts pre-interruption cache)
      - Create flow: restores safe input where still valid (purpose/total/people/split —
        all local until Open Vink is actually tapped, so all of it is "safe")
      - Lobby: restores from a fresh fetch; if the Vink's real state changed while
        interrupted (expired, completed, someone else's action moved it forward), the new
        real state is shown, not the stale pre-interruption one
      - the specific action that hit the 401 (e.g. "Pay my share") is NOT auto-replayed —
        the organizer sees true current state and acts again deliberately if still needed
```

---

## 21. Accessibility and reduced-motion interaction requirements

- Every icon-only control has an accessible label; ambiguous ones also get visible text
  (§1's hierarchy rule).
- Every destructive action requires explicit confirmation, announced clearly (C10/C27,
  Sign out).
- The ink vessel's screen-reader pattern is fixed (Phase 4 §0, restated in §2/§16): meaningful
  fraction + waiting-for-name changes only, never countdown ticks, never per-frame animation
  narration.
- Reduced motion replaces every traveling/droplet animation with an instant level or state
  change (§17) — no screen loses functional information under reduced motion, only the
  travel/duration of the transition changes.
- Status-tone color (attention/positive/etc.) is never the only signal — text always
  accompanies it (Phase 4 §6, restated).
- Haptics are used only for genuinely infrequent, meaningful milestones (contribution
  confirmed, Vink opened, everyone's-in, payment ready, payment complete, cancel confirmed) —
  never for routine navigation or frequent live updates (explicitly not used on C28's
  per-confirmation vessel ticks, only on C29's completion).

---

## 22. Current-capability-versus-canonical-interaction matrix

| Area | Canonical (this document) | Current capability | Dependency |
|---|---|---|---|
| Create flow shape | Two screens + transient confirmation (C6–C15) | Five-step wizard, standalone Review | D30 — UI restructuring only, no backend change |
| Invitation delivery | Automatic primary, manual fallback (C16–C22) | Manual only, foregrounded as primary | D19/D27 — contact capture + send provider, unbuilt |
| Progress visualization | `contributionProgress`-driven vessel (C28/C29) | `fundedAmountMinor`-driven linear bar | D24 — API addition, unbuilt |
| Guest own-status | `contributionStatus`, never re-offered (C25/C39) | Local `hasAuthorized` flag, resets on reload | D24 — API addition, unbuilt |
| Guest deadline | Rendered (§18) | Not rendered at all | Pure rendering fix, no backend dependency — buildable now |
| Guest terminal states | Six-way D25 vocabulary (C40–C43) | One flat message | D24/D25 — API addition, unbuilt |
| Home/Activity data | Participant-inclusive (C5, C33) | Organizer-owned only | Phase 3 §1 — new read, unbuilt |
| Session expiry | In-place reauth, state preserved (C44) | Undefined, per-screen generic handling | D26 — global listener + state preservation, unbuilt |
| Contact info | Captured at Registration/Profile (C4/C35) | Not collected anywhere | D19/D27 prerequisite, unbuilt |
| Activity interactivity | Tappable, opens Vink details (C33/C34) | Fully static list | D29/D31, unbuilt |
| Support contact | Present (C37) | Absent | D28, unbuilt |
| "Pay now" entry | Deliberate tap transitions into a focused payment surface; that surface's actual presentment method stays open pending the M0 provider gate (C31, D32) | Card shown passively inline in the Lobby, no focused surface, no deliberate-tap gate | D32 — shell is a target refinement (buildable now); the surface's real content is provider-dependent, unbuilt and unresolved until G1 |

---

## 23. Dependencies the copy phase (Phase 7) must not contradict

1. Functional labels fixed in this document ("Open Vink," "Pay $X," "Try again," "Approve
   $X," "Send again," "Share another way," "Sign in," "Cancel Vink") are the **actions**
   Phase 7 writes tone around — Phase 7 may refine wording but must not change which action a
   label maps to, or introduce a second competing label for the same action.
2. "Is in" is reserved exclusively for confirmed contribution status (§2) — Phase 7 must not
   reintroduce it for delivery status, guest-added status, or any other moment.
3. The six-way guest terminal vocabulary (D25, C39–C43) is exhaustive — Phase 7 writes exactly
   these six outcome sentences, not a seventh, not variants that blur the categories.
4. No fee, no support-response-time commitment, no merchant-receipt language may appear in
   copy anywhere (D21/D28/D31, restated).
5. Every "New — designed, not built" action in §4 stays labeled as such through Phase 7 —
   copy may be written for it, but Phase 7 must not describe it as working.

## 24. Acceptance criteria for moving into the copy-system phase

- [ ] Owner confirms the button hierarchy system (§1) and the "exactly one primary per
      screen" rule as binding for Phase 8's visual system.
- [x] Owner resolved "Pay now" (C31) — deliberate entry into a focused payment surface is
      canonical; that surface's actual presentment method stays explicitly open pending the
      M0 provider gate, not locked to last-four-only or any specific provider method (D32).
- [x] Owner confirmed no additional confirmation sheet is needed before an ordinary
      contribution — the amount-bearing action itself is the confirmation (D33, ratifying
      §12's original conclusion).
- [ ] No item in this document contradicts D1–D33 or Phases 0–4.

**Stopping here per instruction — no copy-system work, visual refinement, or implementation
follows this document.**
