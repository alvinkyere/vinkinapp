# Phase 9 — Motion and Transition System

_UI/UX Engineering Plan, Phase 9 output: one restrained motion system making VinkIn's cause
and effect immediately understandable. Source of truth: `docs/design/phase-0-product-behavior.md`
through `docs/design/phase-8-visual-system-refinement.md`, `docs/spec/decision-log.md`
(D1–D36), `docs/spec/open-questions.md`, and a direct audit of the real Flutter/Next.js
source (cited by file:line throughout)._

**Status:** DRAFT. **Documentation only — no Flutter, Next.js, backend, API, authentication,
notification delivery, database, infrastructure, or existing design-token code was
modified.** No journey, screen, action, copy, financial state, screen ownership, visual
hierarchy, provider assumption, or accessibility requirement from Phases 0–8 changes here —
this phase adds timing and movement to states that already exist.

**Explicitly not invented anywhere in this document:** financial states, provider motion,
card-provisioning animations, wallet behavior, virtual-card reveal, fees, percentage
splitting, contacts sync, notification guarantees, merchant receipts, legal content,
decorative illustration, celebratory spectacle, or implementation code.

---

## 1. Motion design principles

1. **State truth before animation.** Motion reflects authoritative (server-confirmed) state;
   it never invents it. A contribution never fills the Ink vessel while merely processing.
   "You're in" never animates before confirmation. Ready-to-Pay motion never begins because
   the client *predicts* completion. A client countdown never visually declares expiry before
   server reconciliation.
2. **Cause and effect.** Every animation has a traceable trigger — a tap, a field validation,
   a participant addition/removal, a confirmed server response, a realtime event, a route
   transition, or a reconnect reconciliation. Decorative movement with no state or navigation
   purpose is prohibited.
3. **Continuity.** Prefer transformations that preserve the user's mental model over
   full-screen replacement: the Open Vink confirmation returns to People and Split without
   rebuilding the screen; Live Vink transforms into Preparing Payment and Ready to Pay rather
   than reading as an unrelated product; in-place reauthentication preserves recognizable
   context; Guest Web keeps known invitation information visible through reconnect.
4. **Interruptibility.** Every animation tolerates rapid navigation, app backgrounding,
   browser tab changes, a newer realtime event, route replacement, screen resize, and the
   reduced-motion preference. **A newer authoritative state always supersedes an unfinished
   animation** — restated as the single governing rule of this entire document.
5. **Financial restraint.** No confetti, coins, bouncing money, celebratory card spins,
   slot-machine counters, liquid splashes, pulsing payment instruments, dramatic failure
   shakes, or theatrical draining of returned funds. Success may feel satisfying without
   becoming spectacle.
6. **Reduced-motion equivalence.** Reduced motion preserves hierarchy, state understanding,
   focus movement, progress value, action feedback, and success/failure meaning — it is never
   merely "animation off" leaving an ambiguous interface.
7. **Restrained, not bouncy** — vinkin.org's own sourced motion language
   (`docs/design/vinkin-design-system.md` "Animation" section) is explicit: entrances are
   "fade + slide-up... a consistent, restrained reveal, not bouncy or elastic." No spring,
   elastic, or overshoot curve appears anywhere in this system.

### A note on the Ink vessel and the site's own reference

Worth stating plainly: vinkin.org's own sourced "Animation" section states its real
product-preview mockup "uses a plain horizontal progress bar," and that the ink/droplet idea
"lives in the logo and in copy... not as an animated UI metaphor forced onto every progress
indicator." **This exact reasoning is already written into the shipping code** —
`apps/guest-web/components/ProgressBar.tsx:3-4`'s own comment: *"same as the Flutter app's
`VinkProgressIndicator`... the ink metaphor stays in the logo and copy, not the product's own
progress UI."* The Ink Progress System amendment — already load-bearing through Phases 4–8 —
requires the opposite: a literal vessel as the primary progress visualization. **This
document does not reopen that decision** — the amendment is an explicit, owner-directed
requirement superseding the site's own earlier choice. But the tension is real and resolves
this system's motion toward the **restrained end** of what a vessel could be: a smooth
fill-level transition with a subtle accent, never a physics-simulated liquid — consistent
with Phase 8 §15's explicit "no liquid/physics-simulation effects."

---

## 2. Existing-motion audit

**Direct source inspection, cited by file:line — not inferred:**

| Area | Finding |
|---|---|
| Flutter implicit/explicit animation widgets | **None found.** Zero `AnimatedContainer`/`AnimatedSwitcher`/`AnimatedOpacity`/`AnimationController`/`Hero`/`SlideTransition`/`FadeTransition` anywhere in `apps/mobile/lib`. The only `CustomPainter` in the app (`design_system/components/vink_logo.dart:19,24-66`) paints the **static** logomark — not animated. |
| Flutter route transitions | **Platform default, uncustomized.** `apps/mobile/lib/app/router.dart` uses `go_router`'s `GoRoute` with no `pageBuilder`/`transitionsBuilder` override anywhere — routes get whatever the platform's default push transition is, never audited or intentionally designed. |
| Flutter loading indicators | `VinkLoadingState` (`design_system/components/vink_empty_state.dart:39-63`) — a centered `CircularProgressIndicator` (Flutter's own built-in indeterminate spin is the only animation in the whole mobile app) + optional message. **This is the literal "Connecting…" full-screen blocker Phase 1 §C.2 flagged** — no skeleton, no cached-content-first-paint, a blank replacement of a screen whose shape is already known. |
| Flutter button loading state | `VinkPrimaryButton`/`VinkSecondaryButton`/`VinkDestructiveButton` (`design_system/components/vink_buttons.dart:57-66,105-110,155-160`) swap `Text` for a `CircularProgressIndicator` with **no cross-fade and no reserved width** — the button visibly resizes between its label and its spinner today, since nothing constrains a stable width across the two states. **Real finding, not hypothetical: this violates the "button width does not jump" lock rule as currently built**, not just as a risk. |
| Flutter destructive button — **live contrast issue, not just a Phase 8 hypothetical** | `VinkDestructiveButton` (`vink_buttons.dart:126-172`) is **already shipping as a text/outline button** (transparent fill, `danger`-colored border + `danger`-colored text, `buttonLabel` 15px/700) — disabled state renders `danger` at 40% opacity text, even fainter. Per Phase 8 §24/D36's corrected analysis, `danger` text at this exact size fails AA against `white`/`paper` (~4.38:1, under the 4.5:1 floor) — **this is a real, currently-built accessibility gap**, not a speculative one, and it's the enabled-state text, before the disabled state makes it worse. |
| Flutter haptics | **None found.** Zero `HapticFeedback` usage anywhere in `apps/mobile/lib`. Every haptic in this document (§22) is designed-but-pending. |
| Flutter reduced-motion handling | **None found.** No `MediaQuery`-based `disableAnimations`/accessible-navigation check anywhere — unsurprising given there's almost no motion to gate yet, but also means the *pattern* for respecting the OS reduced-motion setting doesn't exist as precedent either. |
| Guest Web CSS transitions | Three files use Tailwind transition utilities: `components/ProgressBar.tsx:25` — `transition-[width] duration-500` (the current linear bar's fill, **500ms**, Tailwind's default easing `cubic-bezier(0.4, 0, 0.2, 1)`); `features/join/JoinForm.tsx:101` and `features/join/SessionView.tsx:122` — both primary buttons use bare `transition` (Tailwind's default: **150ms**, same `cubic-bezier(0.4, 0, 0.2, 1)`, covering `hover:bg-blue-deep` and `disabled:opacity-40`). |
| Guest Web keyframes / `prefers-reduced-motion` | **None found anywhere** in `apps/guest-web` — zero `@keyframes`, zero `prefers-reduced-motion` media query. |
| Guest Web loading | `JoinExperience.tsx:59,73,96` — three separate bare `<StatusMessage>Loading…</StatusMessage>` returns, no skeleton, confirmed in Phase 1 §C.2 as a real gap, now confirmed at the exact line level. |
| Guest Web progress bar accessibility | `ProgressBar.tsx:16-22` already correctly implements `role="progressbar"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-label` — **a pattern worth explicitly preserving** when this component is replaced by the vessel (§10), not discarded along with the linear-bar visual it's attached to. |
| Guest Web hover micro-interaction | `hover:bg-blue-deep` on both primary buttons (`JoinForm.tsx:101`, `SessionView.tsx:122`) — a color transition only, **no** `-translate-y` lift is actually implemented in the app today, even though the marketing site itself uses one (`docs/design/vinkin-design-system.md`'s `hover:-translate-y-0.5`) — the app's hover treatment is narrower than the site's own. |

**Classification, applying the required retain/adjust/replace/remove/absent taxonomy:**

| Behavior | Classification |
|---|---|
| Guest Web button transition (150ms, `cubic-bezier(0.4,0,0.2,1)`, hover+disabled) | **Retain** — becomes `motion.fast` (§3), reused exactly |
| Guest Web ProgressBar width transition (500ms) | **Adjust** — duration reused as `motion.deliberate`'s grounding (§3), but the component itself is **replaced** by the vessel (§10) |
| Guest Web `role="progressbar"` accessibility wiring | **Retain**, ported to the vessel's own accessible representation |
| Flutter button loading swap (no cross-fade, no width reservation) | **Adjust** — add a reserved minimum width + cross-fade (§7) |
| Flutter `VinkLoadingState` full-screen blocker | **Replace** — with cached-first-paint + skeleton (§19), per Phase 8 §17 |
| Flutter destructive button's `danger` text | **Adjust** — pending Phase 8 §24/D36's verified `dangerText`/fill remediation; this document does not re-litigate that color decision, only notes it's a real, live issue also relevant to any *motion* added around this component (§7) |
| Flutter route transitions | **Currently absent (uncustomized default)** — formalized in §6 |
| Any haptic anywhere | **Currently absent** — the full vocabulary in §22 is new |
| Any reduced-motion handling anywhere | **Currently absent** — §23 defines it from nothing |
| Guest Web hover lift (`-translate-y`) | **Currently absent** on the app itself despite existing on the marketing site — added in §18 as M21-equivalent, sourced from the site's own convention |

---

## 3. Semantic duration tokens

**Audited first, per instruction — reused where a real precedent already exists, not
reinvented:**

| Token | Duration | Grounding |
|---|---|---|
| `motion.instant` | 0ms | The reduced-motion target for every token below |
| `motion.micro` | 150ms | **Reused exactly** from Guest Web's existing button `transition` (`JoinForm.tsx:101`, `SessionView.tsx:122`) |
| `motion.standard` | 250ms | **New, justified** — sits between the audited 150ms micro-interaction and the audited 500ms progress-bar precedent; used for sheet/route transitions, which are visually larger than a button hover but shorter than a meaningful progress change |
| `motion.emphasized` | 350ms | **New, justified** — for state transitions that are more consequential than a standard sheet open but not themselves the progress indicator (e.g. Everyone's-in banner, Preparing Payment cross-fade) |
| `motion.bounded-progress` | 500ms | **Reused exactly** from Guest Web's existing `ProgressBar.tsx:25` `duration-500` — governs the Ink vessel's fill transitions, deliberately inheriting the one duration this codebase already decided was right for "a progress value changing" |

**No sixth duration is introduced.** Five tokens, one of which is "off," cover every motion
in this document — matching the instruction not to introduce "dozens of near-identical
values."

---

## 4. Semantic easing tokens

| Role | Curve | Grounding |
|---|---|---|
| Entering | `ease-out` (`cubic-bezier(0, 0, 0.2, 1)`) | Standard "arrives with intent, settles gently" curve — matches the site's own "restrained reveal, not bouncy" entrance language |
| Exiting | `ease-in` (`cubic-bezier(0.4, 0, 1, 1)`) | Mirror of entering — leaves with intent, doesn't linger |
| Transforming in place (state/color/value changes that aren't entrances or exits) | `cubic-bezier(0.4, 0, 0.2, 1)` | **Reused exactly** — this is the literal curve already shipping on both Guest Web buttons and the current progress bar (Tailwind's default `transition-timing-function`); reusing it here is the "rationalize existing values" instruction applied directly |
| Progress interpolation (the Ink vessel's fill specifically) | `cubic-bezier(0.4, 0, 0.2, 1)` | Same curve as "transforming in place" — the vessel's fill is a value transform, not a new easing category; not given its own curve to avoid a near-identical duplicate |
| User-controlled dismissal (drag-to-dismiss sheets) | Linear, 1:1 with the finger/pointer while dragging; `ease-out` only on release-and-settle or release-and-snap-back | Standard platform-native sheet-drag convention, not a custom curve invented here |

**No spring, elastic, bounce, or overshoot curve is defined anywhere in this system.**

---

## 5. Flutter/CSS token mapping

| Token | Flutter | CSS |
|---|---|---|
| `motion.instant` | `Duration.zero` | `transition-duration: 0ms` (or `@media (prefers-reduced-motion: reduce)` override) |
| `motion.micro` (150ms) | `Duration(milliseconds: 150)`, `Curves.easeOut`/`Curves.easeIn` per role | `duration-150` (Tailwind), `ease-out`/`ease-in` |
| `motion.standard` (250ms) | `Duration(milliseconds: 250)` | `duration-250` (custom value; Tailwind's default scale doesn't include 250 — acceptable, a single non-default value here rather than forcing an ill-fitting default) |
| `motion.emphasized` (350ms) | `Duration(milliseconds: 350)` | `duration-350` (custom value, same reasoning) |
| `motion.bounded-progress` (500ms) | `Duration(milliseconds: 500)` | `duration-500` (Tailwind default — **already in use**, `ProgressBar.tsx:25`) |
| Entering curve | `Curves.easeOut` | `ease-out` / `cubic-bezier(0,0,0.2,1)` |
| Exiting curve | `Curves.easeIn` | `ease-in` / `cubic-bezier(0.4,0,1,1)` |
| Transform-in-place / progress curve | `Curves.easeInOut` (Flutter's built-in closest match to `cubic-bezier(0.4,0,0.2,1)`) | `cubic-bezier(0.4,0,0.2,1)` (Tailwind default `ease-` / bare `transition`) |

---

## 6. Route-transition system

Formalizes what's currently an uncustomized platform default (§2) into an intentional,
minimal system — not a new visual language:

- **Pushed screens** (Live Vink, Vink Details, Contact Information, Change Password): platform-native push transition, left as platform default (iOS slide-from-trailing-edge, Android's default) — **not overridden**, since the platform default already satisfies "restrained, not bouncy" and overriding it would be motion added for its own sake, contradicted by §1.2.
- **Tab switches** (Home/Activity/Profile): instant cross-fade at `motion.micro` (150ms) — tab switches are frequent, low-stakes navigation, not a moment worth `motion.standard`'s weight.
- **Sheet presentation/dismissal**: not a "route transition" in the push sense — covered in §20.
- **Create screen 1 → screen 2**: an in-flow transition (Phase 4 §5, D30's two-screen model), `motion.standard` (250ms) slide, matching the weight of a meaningful step forward without the full push-transition duration of leaving the flow entirely.
- **Open Vink confirmation → Lobby**: sequenced, not simultaneous (§16) — the sheet finishes dismissing before the Lobby's own first-paint begins.

---

## 7. Component-state transition system

| Component | Trigger | Motion |
|---|---|---|
| `VinkPrimaryButton`/`Secondary`/`Destructive` loading swap | `loading` becomes true/false | **Adjust from current (§2):** cross-fade label ↔ spinner at `motion.micro`, **and reserve the button's width at its label's natural width** (a `SizedBox`/min-width constraint sized to the label before the swap) so the button never visibly resizes — this is the direct fix for the audited real gap |
| Button pressed state | Tap-down | Flutter's native `InkWell` splash/highlight (already implemented, `vink_buttons.dart:48-52` — **retained as-is**, it's already a restrained, platform-appropriate press feedback, not decorative) |
| Button disabled state | `onPressed == null` | Instant opacity/color change (already implemented via conditional color logic in `vink_buttons.dart` — **retained**, disabled states don't animate into being, they simply *are*) — matches the existing `disabled:opacity-40` precedent from Guest Web (§2), applied consistently |
| Focus ring appearance (Guest Web, keyboard nav) | Tab-focus | `motion.micro` opacity-in of the focus outline |
| Row insertion/removal (participant rows) | Add/remove participant | See §9 |
| Status badge tone change | A Vink/contribution state transition | `motion.micro` cross-fade of background+text color together (never text and background changing on different timings) |

---

## 8. Form and validation motion

**1. Authentication and onboarding.** Welcome → Login/Register: `motion.standard` fade + a
restrained slide (matching §1.7's sourced entrance language, translateY in the 16–24px
range — the site's own smaller range, not its 60px marketing-section range). Form
validation: an invalid field's error message cross-fades in at `motion.micro` **directly
below the field it belongs to** — **no shake, no red flash, no whole-form animation on
failure** (explicit lock rule, restated: "do not animate entire forms aggressively on
validation failure. Focus and error association must remain clear.") — focus moves to the
first invalid field programmatically, without an animated scroll flourish beyond the
standard keyboard-safe scroll-into-view. Password visibility toggle: instant icon swap, no
transition (a functional toggle, not a moment worth animating). Submission loading: the
primary button's own loading state (§7). Invalid-credential response: the error message
appears via the same `motion.micro` cross-fade as any field error — no distinct "shake the
whole form" treatment despite this being a common pattern elsewhere; it's excluded here per
the same no-blame, no-alarm principle governing every error in this system (Phase 6 §1).
Successful authentication: no separate success animation — the screen simply navigates to
Home via §6's route transition, immediately. Keyboard appearance: standard OS keyboard-safe
scroll, primary action stays reachable (Phase 4/5, restated).

**2. Home.** First load: cached-first-paint, no entrance animation on warm navigation (data
simply appears, since it was already known — Phase 8 §17's cached-first-paint principle
applied at the motion layer: *the absence* of an entrance animation is itself the correct
behavior for cached content). First-ever load (cold, no cache): `motion.standard` fade-in
for the whole list, once. Active-Vink insertion (a new Vink appears, e.g. after Create):
`motion.standard` fade + slide-in for that one card, at the top of its section — not a
reflow-everything animation. Active-Vink removal into Activity (a Vink resolves to a terminal
state and leaves the active list): `motion.standard` fade + collapse-height for that card,
**but only if the user is currently looking at Home when it happens** — a background-state
change while the user is on another screen never animates on return, it simply reflects the
new true list (§1.4's interruption rule). Compact Ink-vessel update (per-card): follows §10's
compact variant, `motion.bounded-progress` (500ms). Action-required emphasis: no animation —
the "needs your attention" grouping (Phase 8 §1) is a static layout position, not something
that pulses or draws attention via motion (matches §1.5/§1.6 — urgency comes from information
architecture, not movement). Refreshed participant-inclusive data (§ Phase 3 §1, once built):
same treatment as any Home refresh — cached-first, new cards insert/remove per the rules
above, never a full-list re-animation. Return from another route: **no animation** — Home is
simply shown again, current data as of now, per §1.1/§1.4 — "Home must not reorder content
with distracting movement while the user is trying to tap" is satisfied by *not animating
reflows the user didn't directly cause* (an insertion the user caused, like completing
Create, does animate per above; a background reorder from someone else's action does not, if
it would disrupt an in-progress tap).

**3. Purpose and Total.** Amount-field focus: `motion.micro` border-color change to
`focus.indicator` (Phase 8 §11). Currency formatting: **no per-keystroke animation** — the
formatted value updates instantly as digits are typed (explicit lock rule: "do not animate
each entered digit as though it were a financial market ticker" — a slot-machine-style
digit-roll is exactly the kind of decorative movement §1.2/§1.5 prohibit). Purpose-field
validation: `motion.micro` inline error per §8.1's pattern. Valid-state transition ("Next"
enabling): instant enabled-state color change, no animation drawing attention to it. Keyboard-
safe primary-action movement: standard OS behavior, not custom. Transition to People and
Split: §6's in-flow `motion.standard` slide.

**4. People and Split.** Add participant: new row `motion.standard` fade+slide-in (§9).
Edit participant: the sheet's own §20 presentation, no special row treatment beyond the
sheet's return updating the row's content via `motion.micro` cross-fade if any displayed
value changed. Remove participant: row `motion.standard` fade+collapse-height (§9).
Organizer-share adjustment: same numeric cross-fade pattern as any custom-amount edit (§8.3's
"no digit-ticker" rule applies equally here — the number itself never rolls). Equal/Custom
mode transition: `motion.standard` cross-fade of the entire allocation list's display mode
(amount fields fade out, the segmented control's selection slides per §7's focus/selection
pattern, then the new mode's fields fade in) — **sequenced, not simultaneous**, so the
relationship between "you changed the mode" and "the amounts changed" stays legible (the
explicit "share recalculation must explain the relationship... without causing rows to jump
unpredictably" requirement). Equal-share recalculation (participant added/removed while Equal
is active): every remaining row's amount cross-fades at `motion.micro` to its new value,
**starting at the same moment** the add/remove row-animation begins (not sequenced after it)
— because both are effects of the *same* cause (Phase 5 §2's "recalculates immediately," now
given its motion-layer meaning: the numbers update in the same breath as the person
being added/removed, not as a separate, later action). Custom-share validation: inline
`motion.micro` error per §8.1's pattern, on the specific over/under row. Exact-total
reconciliation: the running "Assigned $X of $Y" total cross-fades at `motion.micro` on every
edit (§ Phase 8 §5's numeric cross-fade pattern, reused). Participant-row insertion/removal:
§9 in full. Transition to Open Vink confirmation: §16's sheet presentation (§20).

---

## 9. Participant-row motion system

| Row state | Visual properties that change | Row position change? | Amount change? | Icon/label transition | Organizer vs. participant visibility | Screen-reader timing | Reduced motion |
|---|---|---|---|---|---|---|---|
| Added | Row fades + slides in (`motion.standard`) at its insertion point | Yes — new row appears | Reflects its assigned share, cross-fades if Equal split shifts it | Avatar/initial fades in with the row | Organizer/member: full row. Guest Web: never rendered (privacy boundary, unchanged) | Announced once, on completion of the fade-in, not mid-animation | Row appears at final position instantly, no slide |
| Invitation pending / sent | Status word cross-fades (`motion.micro`) | No | No | Status word only, no icon change | Organizer/member only | Announced once per change | Instant text swap |
| Viewed *(no such state exists in the current domain — flagged, not designed: there is no "viewed" signal anywhere in `packages/domain`; not given motion here because it would be motion for a state that can't occur)* | — | — | — | — | — | — | — |
| Processing | Status word cross-fades to "Processing" (`motion.micro`) — **never a looping/pulsing indicator** (explicit lock rule) | No | No — the vessel does not reflect this row yet either (§10's core lock) | Status word only | Organizer/member only | Announced once | Instant |
| Confirmed / in | Status word cross-fades to "Paid" **at the same moment** the vessel begins its rise (§10, "one coherent transition" timing rule) | No | No (amount was already shown) | Status word transitions; no separate checkmark-pop animation, the color/text change *is* the signal | Organizer/member: full. Guest Web: no per-participant rows exist, only the guest's own outcome (§18) | Announced once, coincident with the vessel's own announcement | Instant status swap + instant vessel level change, still coincident |
| Delivery failed | Status word cross-fades to "Couldn't send" (`motion.micro`) | No | No | Compact "Share another way" action fades in beside it | Organizer/member only | Announced once | Instant |
| Contribution failed (declined) | Status word cross-fades to "Needs another try" | No | No | No icon change | Organizer/member only | Announced once | Instant |
| Return pending / Returned | Status word cross-fades per Phase 6 §10's vocabulary | No | No | No icon change | Organizer/member only (guest sees their own outcome screen instead, §18) | Announced once | Instant |
| Recovery-required | **No row-level change at all** — a participant/guest whose own status is already `confirmed` shows no distinct row treatment for this Vink-level state (Phase 6 §8's continuity rule) | No | No | n/a | Organizer sees the Vink-level recovery treatment elsewhere (Phase 8 §14), not on the row | n/a | n/a |

**Avoid looping or pulsing statuses**, restated as a hard rule already reflected in every row
above — the only continuously-animating element permitted anywhere near a participant row is
Flutter/CSS's own built-in indeterminate spinner glyph, and only while a row's own action
(not the row's status display) is mid-request.

---

## 10. Ink Progress motion specification

**Locked, restated precisely:** `contributionProgress` is the only input. Processing
contributions never fill the vessel. Progress moves from the last server-confirmed *rendered*
value to the newest server-confirmed value. Multiple missed updates may animate once to the
latest aggregate value rather than replaying every intermediate event. A newer authoritative
value interrupts an older progress animation. No linear progress bar accompanies the vessel
(the current `ProgressBar.tsx`/`VinkProgressIndicator` are **replaced**, per Phase 8 §26, not
supplemented). The vessel does not splash, wobble excessively, overflow, or behave like a
game reward. Screen-reader progress is announced independently from the decorative animation.

| State | Motion |
|---|---|
| Empty vessel ($0 confirmed) | Renders at its minimum visible baseline instantly on first paint — no "filling from nothing" entrance animation, since this is the vessel's resting state, not a change |
| First confirmed contribution | `motion.bounded-progress` (500ms, `cubic-bezier(0.4,0,0.2,1)`) rise from the baseline to the new level — the vessel's first real motion |
| Ordinary incremental increase | Same treatment, rising from the last *rendered* level to the new one |
| Large increase (e.g. several contributions confirmed in a burst) | **Same single 500ms rise directly to the new aggregate total** — never a faster "catch-up" animation and never a series of smaller stepped rises; one true value, one transition, regardless of how large the jump is |
| Multiple updates received together (a burst of realtime events) | Coalesced into **one** rise to the latest value — the intermediate values within the burst are never individually animated through (direct implementation of the "may animate once... rather than replaying every intermediate event" lock rule) |
| Near-complete state | No distinct treatment — the same rise logic, no special "almost there" animation invented |
| Final contribution | The rise's own terminal frame reaches 100% — not a second animation layered on top (§14 picks up immediately from here) |
| Complete resting state | Vessel holds at full, no idle animation (no shimmer, no pulse — a resting complete state is exactly that, resting) |
| Reconnect to a newer confirmed value | Identical to "ordinary incremental increase" — a reconnect is just another source of a new true value, not a special motion case |
| Stale event ignored | **No motion at all** — an event that doesn't represent the current true value (e.g. arriving out of order) never triggers a rise; only the reconciled true value ever animates |
| Server-corrected value (downward correction) | See dedicated treatment below |
| Terminal expiry or cancellation | The vessel does **not** animate a drain or collapse — the screen transitions to the dedicated outcome surface (Phase 8 §17/§22) via that surface's own `motion.emphasized` cross-fade; **the vessel is never the explanation for a terminal state**, only for progress toward one |
| Compact Home version | Same rise logic, `motion.bounded-progress`, visually smaller, no waiting-clause text to coordinate with (Phase 8 §15) |
| Primary Lobby version | Full treatment as above, coincident with the triggering participant row (§9) |
| Aggregate Guest Session version | Identical motion to the Lobby's primary version; **never** any per-participant breakdown animates in or out beside it (privacy boundary, unchanged) |

**Unexpected downward correction** (a previously-confirmed value is corrected down by the
server — not a state the current domain's contribution machine is known to produce today,
specified for completeness/robustness): the vessel transitions to the corrected level via the
**same** `motion.bounded-progress` rise-or-fall treatment, direction-agnostic — **never a
"draining" animation** (explicitly excluded, matching the amendment's own "an expired Vink
should not use a theatrical draining animation" requirement, generalized here to any downward
correction) — and this does not, by itself, imply an unconfirmed financial outcome: the
number simply reflects the new true value, calmly, exactly as an upward change would.

**Screen-reader announcement, restated from Phase 6 §12/Phase 8 §0:** "$X of $Y ready.
Waiting for {clause}." or "Everyone's ready." — announced once per *meaningful* change,
**decoupled entirely from the decorative rise animation's own duration** — the announcement
fires when the new true value is known, not when the 500ms visual transition finishes,
so a screen-reader user is never waiting on decoration to receive information a sighted user
already has visually mid-animation.

---

## 11. Countdown motion specification

**Locked, restated:** no flashing, no pulsing red, no shaking, no continuous screen-reader
announcements, no client-only terminal declaration. Visual urgency increases through
hierarchy and weight, not panic effects.

| State | Motion |
|---|---|
| Normal minute changes (>1 min remaining) | **No animation** — the displayed minute count simply updates its text at each change, instantly, no transition (a countdown re-rendering every ~60s doesn't need motion to be legible) |
| Under-one-minute second changes | **No animation** on the per-second tick itself (matches "no continuous... announcements" extended to visual ticking too — a visibly ticking seconds display is a legitimate *static* pattern, but each individual second-change is not an animated event) — only the **one-time step** into this state (weight/color change, Phase 8 §16) animates, at `motion.micro` |
| Submission cutoff reached | Cross-fades (`motion.standard`) from the countdown display to "Finishing up" (Phase 6 §13) |
| Local clock drift | Not separately animated — the display always reflects best-known time, corrected silently if the client/server drift is detected, no visible "jump" treatment beyond the normal per-change (non-)animation above |
| Server reconciliation | The countdown UI is **replaced entirely** by the resulting terminal-state treatment (`motion.emphasized` cross-fade) — never coexists with a stopped "0:00" |
| Expiry transition | Same as server reconciliation — no countdown remnant, no distinct "expired" flash |
| Background/foreground return | On foregrounding, the countdown (if still applicable) simply reflects current true time — no catch-up animation, no re-entrance flourish |

---

## 12. Invitation-delivery motion model

Delivery-state motion stays visually and temporally secondary to contribution status — never
sharing timing, color weight, or emphasis with a "Paid" row transition (§9).

| Event | Motion |
|---|---|
| Sending | Status word appears at `motion.micro`, **no looping indicator** (lock rule, restated) |
| Sent | `motion.micro` cross-fade from "Sending…" to "Sent" — **never animated as though the participant contributed** (explicit lock rule: this is a delivery fact, visually lighter-weight than §9's "Paid" transition — different color role, `status.informational` not `status.success`, per Phase 8 §4) |
| Delivery failure | `motion.micro` cross-fade to "Couldn't send" + the "Share another way" compact action fading in beside it |
| Resend accepted | Button's own loading→success cycle (§7's button pattern) — "Sent" reappears |
| Resend rejected/rate-limited | Button returns to enabled state with an inline explanation (Phase 5 C18's cooldown messaging), `motion.micro` |
| Fallback-sheet entry | §20's sheet presentation |
| Copy Link feedback | `motion.micro` label cross-fade to "Copied," then back after a brief hold — **no toast/snackbar invented**, the feedback lives in the button itself |
| System Share return | No app-controlled motion — the OS owns that surface; on return, the sheet is simply as the user left it |
| QR appearance | Reveals inline within the same sheet at `motion.standard` (fade + slight expand of the reserved region) — **never a nested second sheet** (Phase 8 §20, restated) |

---

## 13. Contribution-action motion model

| State | Motion |
|---|---|
| Pressed state | `motion.micro`, platform-native press feedback (§7) |
| Immediate duplicate-tap lock | Instant, no animation needed — the button is simply disabled the frame the first tap registers |
| Processing state | Label cross-fades to a processing indicator at `motion.micro`, width reserved (§7's fix) |
| Server-confirmed success | Row/vessel transition per §9/§10 — **no success animation plays before this confirmation arrives**, restated as the single most safety-critical rule in this entire document (mirrors D25/D33's behavioral guarantee at the motion layer) |
| Retryable failure | `motion.micro` inline error, "Try again" becomes available |
| Non-retryable failure | `motion.micro` inline transition directly to the real outcome state (e.g. expired) — no generic error shown first |
| Already-confirmed reconciliation | If a stale UI somehow offers the action again and the server reports already-confirmed, the screen **self-heals directly to the confirmed state** with a `motion.micro` cross-fade — no error is shown for this case (Phase 6 §16, restated) |
| App backgrounding mid-request | The request continues; on foreground, the UI reflects whatever the server's true outcome was by then — no animation "catches up" the missed time, the current state simply renders |
| Reload/reconnect | Same principle — current true `contributionStatus` renders, no replay of any prior animation |
| Authentication interruption | Routes to §21 — the action is never auto-replayed after reauth |

**The amount-bearing action remains the confirmation under D33** — no separate confirmation
animation/sheet is introduced here; this section only times the *existing* action's own
states.

---

## 14. Everyone's-in sequence

One coherent sequence, timed explicitly (extends Phase 5 §17/Phase 8's earlier draft with
exact relationships):

```
t=0ms      Final participant's contribution confirms (server event received)
t=0ms      That participant's row begins its status cross-fade (§9)          ┐ overlap:
t=0ms      The vessel begins its final rise, motion.bounded-progress (500ms) ┘ same cause
t=500ms    Vessel reaches 100% — this IS the trigger for the next step, not a separate check
t=500ms    "Everyone's in" banner fades in, motion.standard (250ms)
t=~1500ms  Banner has held ~1000ms (enough to read six words), begins fade-out, motion.standard
t=~1750ms  Banner fully faded; screen cross-fades into Preparing Payment, motion.emphasized (350ms)
```

**Interruption by app backgrounding:** if backgrounding occurs mid-sequence, on return the
screen renders whatever the current true state is (possibly already past Preparing Payment
into Ready to Pay) — the banner is **never shown retroactively** once its moment has passed.
**Immediate-ready behavior:** if card provisioning happens to complete unusually fast, the
sequence above is **not compressed or skipped** — the banner still holds its full ~1000ms,
since it's explaining a real, meaningful transition regardless of backend speed. **Delayed-
preparation behavior:** if Preparing Payment takes longer than usual, §15's own delayed-state
treatment takes over *after* this sequence completes normally — this sequence's own timing
never stretches to compensate. **Reduced motion:** all cross-fades/rises become instant state
changes; the banner still holds for its full ~1000ms read-time (a *duration* users need to
read text is not "motion" and is not shortened by the reduced-motion preference). **Optional
single success haptic:** exactly one, at t=500ms when the vessel completes (§22) — never a
second one when the banner itself appears, avoiding a double-fire of the same milestone.

**Do not create a permanent intermediate screen** (the banner is `motion.standard`-timed and
gone by ~1750ms, never a screen requiring its own back-navigation). **Do not delay access to
Pay now merely to finish animation** — this entire sequence is automatic and pre-payment; the
deliberate "Pay now" tap (§16) is never gated by whether this sequence has *visually*
finished, only by whether `CARD_READY` has been *actually* reached, which by construction
happens after this sequence's real trigger anyway.

---

## 15. Preparing-payment transition

Brief preparation: `status.informational`-toned surface (Phase 8 §17), entered via
`motion.emphasized` cross-fade from §14's sequence. **Perceptible delay** (provisioning taking
longer than the ordinary case): after a threshold (an implementation-tunable value, not fixed
here), the surface's copy updates to Phase 6 §16's "preparation delayed" line via a
`motion.micro` text cross-fade — **the surface itself doesn't change type**, only its copy,
avoiding a jarring shift from "normal" to "concerned." **Background/foreground behavior:**
identical principle to §13 — on return, current true state renders, no catch-up animation.
**Recovery-required transition** (if provisioning fails in a way that routes to recovery
rather than simple reversal): `motion.emphasized` cross-fade directly to the organizer-only
recovery treatment (Phase 8 §14/§17) — never through a generic "failed" state first.
**Success into Ready to Pay:** `motion.emphasized` cross-fade the instant `CARD_READY`
arrives (§16's heading appears automatically; the focused surface itself still waits for the
deliberate tap, per D32).

**Use restrained activity feedback. Do not animate provisioning, card creation, provider
handshakes, or hidden infrastructure** — restated as a hard rule: no spinner-with-card-icon,
no "connecting to your bank"-style progress choreography. The surface's only motion is its
own entrance/exit cross-fade and, if needed, the delayed-copy swap above.

---

## 16. Ready to Pay — provider-independent transition shell

Extends Phase 8 §19/D32/D35 with exact timing:

- **Live Vink resting state → Ready-to-Pay shell:** the "Ready to pay" heading and available
  amount fade in (`motion.emphasized`) automatically the instant `CARD_READY` is reached —
  no user action gates *this* part, since it's informational, not the payment action itself.
- **Deliberate "Pay now" entry:** the focused payment surface only animates in
  (`motion.standard` slide/cross-fade, matching a route-transition weight since this is
  effectively navigating into a dedicated surface) on the deliberate tap — **never
  automatically**, restated precisely at the motion layer: reaching readiness never reveals
  credentials automatically, and that includes not *animating toward* revealing them
  automatically either.
- **Focused payment-surface transition:** the bounded `[provider-supported payment method]`
  region (D35) itself receives **no invented internal animation** — it is a static, neutral,
  bounded area in this document, exactly as Phase 8 §19 specifies visually; motion design for
  its actual contents is explicitly out of scope until the M0 gate resolves.
- **Back/exit behavior:** standard back navigation (`motion.standard`, reverse of entry)
  returns to the Lobby; the vessel/participant list are unaffected, rendering their current
  true state, not a cached pre-navigation snapshot.
- **Re-entry behavior:** re-entering (e.g. backgrounding then returning to this exact screen)
  shows the same surface consistently — no re-triggered entrance animation for a screen the
  user never actually left in the underlying navigation stack.
- **Recovery behavior:** if the flow routes to recovery from here, §15's recovery transition
  treatment applies identically.

---

## 17. Merchant-payment completion motion

**Server-confirmed completion:** `motion.emphasized` cross-fade from whatever the prior
screen state was into the Payment Complete composition (Phase 8 §22). **Amount and outcome
transition:** the outcome heading/amount fade in together, not sequentially (they're one
fact, not two). **Participant/waiting content receding:** any remaining waiting-room chrome
fades out at `motion.standard` as part of the same cross-fade, not a separate later step.
**Completion resting frame:** no idle animation once settled — a resting complete screen is
exactly that. **Route to Home or Vink Details:** standard navigation motion (§6), nothing
special added because the destination follows a "success." **Reduced motion:** instant cut,
full information present immediately. **Optional haptic:** exactly one, at the moment of
`VinkCompleted` (§22) — coincident with, not after, the visual cross-fade begins.

**Avoid confetti, exaggerated celebration, or prolonged blocking success screens** — restated
as a hard rule; this screen is reachable in under 500ms of its own motion and requires no
dismissal tap to "get past" a celebration.

---

## 18. Guest Web motion behavior

- **Initial invitation rendering:** server-known organizer/purpose/share/deadline render
  **before** any client-side motion runs at all — no entrance fade gates the first paint of
  known data (Phase 4 §8/Phase 8 §17, restated at the motion layer: the *content* isn't
  animated in from nothing, since it was server-rendered; only genuinely new client-side
  state changes thereafter get motion).
- **Realtime connection enhancement:** the moment the realtime channel comes alive is
  **never** visually marked — it's a silent upgrade (§19).
- **"Not open yet" → open:** `motion.standard` cross-fade from the D23 static state directly
  into the Join Form, triggered by the realtime push, never a manual refresh.
- **Form entry:** standard field-focus/validation motion, identical discipline to §8.1.
- **Contribution processing → confirmed → completed/expired/cancelled/return
  pending/returned/recovery-required:** each transition is a `motion.emphasized` cross-fade
  between whole-screen compositions (Phase 8 §22), matching §13's contribution-action model
  and §10's terminal-state handling (the vessel is never the explanation for a guest's own
  terminal outcome either).
- **Reconnect:** identical silent principle to mobile (§19) — no visual change for a brief
  drop.
- **Viewport and virtual-keyboard resize:** standard browser reflow, no custom animation —
  content simply reflows to the new viewport per Phase 8 §23's responsive system.
- **Cross-input support:** every motion in this section works identically via pointer,
  keyboard, and touch — none of Guest Web's motion is a hover-only or touch-only experience
  for anything *functional* (§18-equivalent hover lift, M21-style, remains a decorative-only
  addition layered on top for pointer users, never load-bearing).
- **Browser back / tab backgrounding:** no custom handling — standard browser behavior,
  restated as intentionally *not* overridden (Guest Web has no in-app back-stack to protect,
  Phase 4/5, restated).

**Never replace a known page with a blank spinner** — the single clearest, most repeatedly-
confirmed real gap in this whole audit (§2's three `JoinExperience.tsx` "Loading…" call
sites) — fixed here by the skeleton/cached-first-paint discipline in §19.

---

## 19. Loading, offline, reconnect, and error motion grammar

| Context | Motion |
|---|---|
| Initial page load (genuine first fetch, no cache) | Content-shaped skeleton (`skeleton.loading`, Phase 8 §4) fades in at `motion.micro`, matching the real layout's proportions — **replaces** every bare spinner call site audited in §2 |
| Cached data present | **No loading motion at all** — content renders instantly; this is the fix for `VinkLoadingState`'s current unconditional use |
| Inline action loading | §7's button pattern |
| Realtime reconnect | **No motion** — content stays exactly as last known; a prolonged disconnect shows only the quiet, non-animated "You're offline" indicator fading in once at `motion.micro` when it first appears, then static |
| Reconnect success | The offline indicator fades out at `motion.micro` — no "back online!" banner, no celebration |
| Newer-state reconciliation after reconnect | Whatever the specific component's own rules say (row/vessel/countdown/etc. above) — reconnect itself adds no additional motion on top of those |
| Prolonged disconnection | Same static indicator, no escalation animation (no color shift to alarm, matching §1.5/§1.6) |
| Unexpected server error | `motion.micro` cross-fade to the calm error composition (Phase 8 §17) — no shake, no icon animation |

---

## 20. Bottom-sheet and dialog motion

Extends Phase 8 §18 with exact timing, for: Open Vink confirmation, Add/Edit Participant,
Participant actions, Invitation fallback, Cancel Vink confirmation, Support-contact context.

- **Entry:** `motion.standard` (250ms) slide-up from the bottom edge + scrim fade-in,
  simultaneous.
- **Exit:** `motion.standard` reverse (slide-down + scrim fade-out).
- **Drag:** 1:1 with the pointer/finger while dragging (§4); release either completes the
  dismissal (`motion.micro` finish) or snaps back to fully open (`motion.micro` ease-out) based
  on drag distance/velocity — standard platform convention, not custom-designed here.
- **Scrim:** `scrim` token (Phase 8 §4), fades with the sheet, never a separate timing.
- **Keyboard:** a sheet containing a focused text field resizes/scrolls to keep it visible,
  no extra animation beyond the standard keyboard-safe adjustment (§8).
- **Focus:** moves into the sheet's first field/control on presentation, returns to the
  trigger on dismissal (Phase 4 §14, restated).
- **Dismissal affordance:** drag-handle + background tap (where permitted per Phase 8 §18's
  per-sheet table) + explicit action buttons.
- **Unsaved-change handling:** follows the Phase 5 §12 dismissal contract exactly — a sheet
  with unsaved edits that would be lost prompts before dismissing (Add/Edit Participant); a
  sheet with nothing to lose dismisses freely (all others) — this section adds no new motion
  for the confirm-before-discard prompt beyond a `motion.micro` inline appearance, matching
  §8.1's error-message treatment in spirit (a lightweight, non-alarming confirmation).
- **No nested sheets, no stacked independent animations** — restated; Show QR reveals inline
  within the Invitation-fallback sheet's own bounds (§12), never as a second sheet layered on
  top.

---

## 21. In-place reauthentication motion

- **Overlay appearance:** `motion.standard` slide-up + scrim fade-in, identical shape to any
  other sheet (§20) — deliberately unremarkable, not a special "alarm" presentation.
- **Preservation of recognizable context:** the underlying screen stays visible, dimmed by
  the scrim, **frozen but present** — no blur/scale/zoom effect applied to it beyond the
  standard scrim dimming (an exaggerated background treatment would work against "preserves
  recognizable context").
- **Focus transfer:** into the sheet's username/password field immediately.
- **Keyboard behavior:** standard keyboard-safe layout (§8.1).
- **Authentication loading:** the "Sign in" button's own §7 pattern.
- **Failed authentication:** `motion.micro` inline error, identical to Login's own (§8.1) —
  no distinct treatment for this being a *re*-authentication.
- **Successful authentication:** sheet dismisses (`motion.standard`, reverse of entry); the
  underlying screen then **refetches and re-renders** — this refetch's own result renders per
  whatever that screen's normal state-rendering rules are (no special "welcome back"
  animation).
- **Server refetch / restoration to unchanged state:** if nothing changed while interrupted,
  the screen simply looks the same — no animation "proving" continuity, continuity is
  achieved by *not* rebuilding the screen from scratch, a structural/implementation
  guarantee, not a motion one.
- **Transition to changed/expired/completed state:** if the underlying Vink's true state
  changed during the interruption, the screen cross-fades (`motion.emphasized`) to the real
  new state — the same treatment any such transition gets normally, not a special
  "surprise" treatment.
- **Cancellation behavior:** "Cancel" dismisses the sheet (`motion.standard`) and proceeds to
  full sign-out → Login, per Phase 5 C44.

**The interrupted financial or destructive action never resumes automatically** — restated at
the motion layer: no animation plays that would suggest an action is continuing or has
completed; the screen only ever animates to reflect what the server actually reports once
re-fetched. **The overlay must not visually imply the stale screen behind it remains
actionable** — the scrim's dimming + the underlying screen's non-interactive state (Phase 4
§14) together are the signal; no additional motion is layered on to reinforce this, since the
static dimmed treatment is already sufficient and additional motion would be decoration.

---

## 22. Haptic vocabulary

**Audited: zero haptics exist anywhere in the codebase today (§2) — this entire vocabulary is
new.**

| Haptic | Trigger | Platform | Intensity | Repetition | Accessibility note |
|---|---|---|---|---|---|
| Light confirmation | Reconciliation reaching exact custom-split total (Phase 8 §5, "Continue" enabling) | Mobile only | Light/selection-tier | Fires once per reconciliation-reached transition, not per keystroke | Supplementary only — the visual/text state change is never haptic-dependent for meaning |
| Consequential success | Vink opened (C15), own contribution confirmed (C23/C24/C25 — **viewer's own only**, never for another participant's row), vessel reaching 100%/Everyone's-in (§14), card ready + deliberate Pay-now entry (§16, two distinct events), payment complete (§17) | Mobile only | Medium/success-tier | Exactly once per event, never repeated if the same state is re-rendered (e.g. on reload) | Never the sole indicator — always paired with a visible state change and, where applicable, a screen-reader announcement |
| Failure | A light failure buzz on login/action error (Phase 5 C3, restated) | Mobile only | Light/warning-tier | Once per distinct failure, never on repeated identical errors from a single root cause | Paired with the inline error text, never standalone |
| Destructive warning | **Not used** — Cancel Vink's confirmation sheet and Sign-out's confirmation intentionally get **no** distinct destructive haptic beyond the ordinary consequential-success buzz once the action actually completes; a *pre-emptive* "careful!" haptic on merely opening the confirmation sheet would manufacture urgency (§1.5), so it's deliberately omitted | — | — | — | — |

**Never fires for:** countdown ticks, realtime reconnect, every participant status change,
passive background updates, ordinary navigation — restated as the explicit exclusion list,
matching §1.5/§1.6 and Phase 5 §21's original restraint.

---

## 23. Reduced-motion matrix

| Emphasized motion | Full-motion version | Reduced-motion version | Static resting state | Focus behavior | Screen-reader announcement |
|---|---|---|---|---|---|
| Ink vessel rise (§10) | 500ms rise, `cubic-bezier(0.4,0,0.2,1)` | Instant level change | Fill at the current true level | n/a (not a focusable element) | Identical in both modes — decoupled from the animation entirely (§10) |
| Everyone's-in sequence (§14) | ~1750ms full sequence with banner hold | Instant state changes; **banner still holds its full read-time** (a duration for reading text is not "motion") | Whatever state the sequence resolves to | n/a | Identical announcement timing in both modes |
| Sheet presentation (§20) | 250ms slide+fade | Instant appearance | Sheet fully visible | Focus still moves to the first field/control, instantly | Sheet's title still announced on presentation |
| Route/tab transitions (§6) | Platform default / 150ms cross-fade | Instant cut | New screen fully visible | Focus moves to the new screen's primary landmark | Screen title/primary content still announced |
| Row insertion/removal (§9) | Fade+slide / fade+collapse | Instant appear/disappear | Row present or absent | n/a | Still announced once |
| Button loading swap (§7) | Cross-fade label↔spinner | Instant swap | Spinner or label shown | n/a | Loading state still announced via the button's accessible state |
| Guest droplet-joining accent (§10-adjacent, guest-only) | Deliberate accent motif | **Omitted entirely** — only the vessel's own instant level change plays | Outcome text present | n/a | Outcome text still the primary announced content |
| Hover lift (§18, Guest Web) | −2px translateY | **Omitted entirely** (already optional/decorative by nature, not merely shortened) | Button at rest position | n/a | n/a |

**Reduced motion never disables a necessary loading indicator or removes confirmation
feedback** — restated as a hard constraint satisfied by every row above (every reduced form
still communicates loading/success/failure, just without travel or duration).

---

## 24. Accessibility-motion audit

- **No flashing above safe thresholds:** nothing in this document flashes at all — the
  strongest "urgency" treatment anywhere is a one-time weight/color step (countdown, §11),
  never a repeating flash.
- **No motion-only meaning:** every animated state change in this document is paired with a
  text/color change that would communicate the same fact with the animation entirely removed
  (verified per-item across §9/§10/§11/§13).
- **Focus placement after navigation/modal presentation:** §6 (route landmarks), §20/§21
  (sheet's first field/control).
- **Screen-reader announcement timing:** decoupled from decorative animation duration
  everywhere it matters most (§10's vessel, explicitly) — an announcement fires when the true
  value is known, not when a 500ms transition finishes.
- **Countdown announcement restraint:** §11, restated — no per-tick announcements, ever.
- **Progress-value announcements:** §10's exact pattern, inherited from Phase 6 §12/§23.
- **Keyboard focus preservation on Web:** §18/§20/§21 — focus is explicitly managed on every
  sheet/overlay transition, never left ambiguous.
- **Browser-back behavior:** §18, explicitly left as standard, unoverridden browser behavior.
- **Animation interruption:** §1.4's governing rule, applied consistently in every per-item
  spec above — a newer true value always wins.
- **Reduced-motion parity:** §23's full matrix.
- **Vestibular-safety considerations:** no large spatial travel anywhere in this system (the
  largest single movement is a sheet's own slide-up, a standard, expected, single-axis
  motion) — no parallax, no zoom/scale bounce, no rotation, matching §6's reduced-motion
  guidance ("no large spatial travel... no scaling bounce") as a description of the
  full-motion system too, not just its reduced form.

---

## 25. Screen-by-screen motion deck

Cross-references rather than re-deriving — every screen's motion is already fully specified
in §6–§21; this is the lookup index the deliverables list requires:

| Screen | Primary motion source(s) |
|---|---|
| Welcome | §8.1 |
| Login / Register | §8.1 |
| Home (empty/active) | §8.2 |
| Purpose and Total | §8.3 |
| People and Split | §8.4, §9 |
| Open Vink confirmation | §16(-adjacent sheet pattern)/§20, §6 |
| Live Vink — Lobby (all progress states) | §9, §10, §11 |
| Everyone's-in / Preparing Payment / Ready to Pay / Payment Complete | §14, §15, §16, §17 |
| Activity | §8.2's list-motion principles (no dedicated new section — reuses Home's insertion/removal treatment for its own list) |
| Vink Details | §6 (route entry only — a static, read-only screen per Phase 8 §20, no further motion) |
| Profile / Contact Information / Change Password | §6, §8.1's form-validation pattern (reused) |
| In-place reauthentication | §21 |
| Guest: not-open-yet / active / processing / confirmed / terminal states | §18 |
| Offline / reconnecting / unexpected error (shared) | §19 |
| All six bottom sheets | §20 |

---

## 26. Trigger-to-animation ownership matrix

| Trigger type | Owns which animations |
|---|---|
| Tap | Button press/loading states (§7), sheet-opening actions (§20), "Pay now" deliberate entry (§16) |
| Field validation | Inline error cross-fades (§8.1) |
| Participant addition/removal | Row insertion/removal + recalculation cross-fade (§9, §8.4) |
| Confirmed server response | Row status change, vessel rise, invitation status change, contribution outcome (§9, §10, §12, §13) |
| Realtime event | Same set as "confirmed server response" — a realtime push and a direct request-response are not motion-distinct, both are "a new true value arrived" |
| Route transition | §6 |
| Reconnect reconciliation | **Explicitly no dedicated animation of its own** — reconnect only ever triggers whichever of the above categories actually changed as a result (§19) |

**No animation in this document belongs to more than one trigger category** — this table is
exhaustive, not illustrative.

---

## 27. Current-motion-versus-canonical-motion matrix

| Area | Current (§2) | Canonical (this document) | Fix type |
|---|---|---|---|
| Any animation infrastructure | None | Full system, §3–§26 | **New — designed, not built**, entirely |
| Button loading swap | Instant swap, width jumps | Cross-fade + reserved width (§7) | **Fix required** — a real, currently-shipping gap |
| `VinkLoadingState` full-screen blocker | Unconditional bare spinner | Skeleton/cached-first-paint (§19) | **Fix required** |
| Guest Web "Loading…" (3 call sites) | Bare text, no skeleton | Skeleton/cached-first-paint (§19) | **Fix required** |
| Guest Web `ProgressBar` | 500ms width transition, plain bar | Replaced by the vessel (§10), duration reused as `motion.bounded-progress` | **Replace**, duration **retained** |
| Guest Web button transitions | 150ms, correct curve already | Retained exactly as `motion.micro` | **Retain** |
| Guest Web hover | Color-only, no lift | Lift added, sourced from the marketing site's own convention (§18) | **Adjust** |
| Route transitions | Platform default, unaudited | Formalized as intentional (mostly unchanged) (§6) | **Formalization**, minimal actual change |
| Destructive button (`danger` text) | Live contrast gap (§2) | Not re-litigated here — Phase 8/D36's remediation governs; this document's own motion additions to this component (§7) don't depend on which color ultimately ships | **Tracked, not owned by this phase** |
| Haptics | None | Full vocabulary (§22) | **New — designed, not built**, entirely |
| Reduced motion | None | Full matrix (§23) | **New — designed, not built**, entirely |

---

## 28. Motion patterns to remove or consolidate

1. The Guest Web `ProgressBar` component itself — removed, replaced by the vessel (§10); its
   `duration-500` value and `role="progressbar"` accessibility wiring are the only parts
   carried forward.
2. Any future temptation to add a distinct "digit-roll" animation to currency fields — never
   introduced (§8.3's explicit lock).
3. Any future temptation to add a pulsing/looping participant-status indicator — never
   introduced (§9's explicit lock).
4. The button loading state's current unreserved-width swap — consolidated into one
   consistent cross-fade-with-reserved-width pattern across all three button tiers (§7).

---

## 29. Designed-but-pending implementation dependencies

Every Ink Progress motion (§10) is blocked on `contributionProgress`/guest
`contributionStatus` (D24), same as the vessel's visual existence (Phase 8 §28). Invitation-
delivery motion (§12) is blocked on D19/D27. The Ready-to-Pay shell's automatic heading
entrance (§16) is blocked on D32's shell existing at all; its bounded module's *own* motion
remains unspecified pending D32/D35's provider resolution. In-place reauthentication motion
(§21) is blocked on D26. Guest deadline motion (the one-time under-a-minute step, §11 applied
to Guest Web) is a pure rendering addition with no backend dependency, same as Phase 8 §28
already noted. Participant-inclusive Home/Activity retrieval (Phase 3 §1) gates §8.2's
insertion/removal motion having real data to react to. Shared Guest Web spacing/radius tokens
(Phase 8 §6/§7) are a visual, not motion, dependency, noted here only because §5's Flutter/CSS
mapping assumes they exist for consistent sheet padding during motion. Verified accessible
`dangerText`/destructive-fill treatment (D36) is tracked in Phase 8, not owned by this
document, but §7's destructive-button motion additions are written to be agnostic to which
color ultimately ships.

---

## 30. Dependencies the next design or implementation-planning phase must not contradict

1. No spring/elastic/bounce curve exists anywhere in this system (§1.7/§4) — must not be
   introduced later "for polish."
2. The Ink vessel's motion is deliberately restrained (§1's resolved tension, §10) — never
   escalated toward literal liquid-physics simulation.
3. Every reduced-motion alternative in §23 is a hard requirement, not a nice-to-have.
4. §19/§11 (reconnect, countdown ticks) are explicitly silent/minimal — never made "more
   alive" later.
5. Haptics are exactly the §22 list — never expanded to make interactions "feel more
   responsive" without a genuinely new milestone to justify it.
6. The five duration tokens (§3) and the small easing set (§4) are the complete system — a
   later phase introducing a sixth near-identical duration violates the audited,
   rationalized-not-proliferated approach this phase was built on.

## 31. Acceptance criteria for completing Phase 9

- [ ] Owner acknowledges the noted tension between vinkin.org's own sourced/shipped "plain
      progress bar" comment (`ProgressBar.tsx:3-4`, literally in the codebase) and the Ink
      Progress System amendment (§1) — resolved here in the amendment's favor per its
      standing authority, restraint chosen as the resolution's character.
- [ ] Owner confirms the audited, reused duration/easing values (§3/§4 — 150ms/500ms/
      `cubic-bezier(0.4,0,0.2,1)`, all pulled from real shipping code) as the system's
      foundation, with the three new values (250/350ms, and the "off" token) as the only
      additions.
- [ ] Owner confirms the two real, currently-shipping gaps this audit surfaced beyond what
      Phase 8 already knew — the button loading width-jump (§2/§7) and the destructive
      button's live contrast issue in its *current, already-built* text-only form (§2, tracked
      against D36 in Phase 8) — are accurately characterized as existing-code findings, not
      hypothetical ones.
- [ ] Owner confirms the haptic vocabulary (§22) is exhaustive and no additional milestone
      warrants one.
- [ ] No item in this document contradicts D1–D36 or Phases 0–8.

**Stopping here per instruction — no implementation, visual mockup generation, or
provider-specific payment-surface design follows this document.**
