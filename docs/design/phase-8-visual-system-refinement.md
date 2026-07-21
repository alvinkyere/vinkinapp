# Phase 8 — Visual System Refinement

_UI/UX Engineering Plan, Phase 8 output: one coherent visual system for organizer/member
mobile and Guest Web. Source of truth: `docs/design/phase-0-product-behavior.md` through
`docs/design/phase-6-copy-system.md`, `docs/spec/decision-log.md` (D1–D36),
`docs/spec/open-questions.md`, the real Flutter/Guest Web implementation, and the real PV13
token sources (`apps/mobile/lib/design_system/{vink_typography,vink_spacing,vink_colors,
vink_radius,vink_shadows}.dart`, `apps/guest-web/app/globals.css`,
`docs/design/vinkin-design-system.md`)._

**Status:** DRAFT. **Documentation only — no Flutter, Next.js, backend, API, authentication,
notification delivery, database, infrastructure, or existing design-token code was
modified.** Journeys, screen ownership, action behavior, copy meaning, financial semantics,
and provider assumptions from Phases 0–6 are unchanged; this phase only formalizes how
they're rendered. Copy is not re-litigated here — Phase 6 already satisfies the copy-design
work.

**Explicitly not invented anywhere in this document:** new product screens, fees, percentage
splitting, contacts sync, payment methods, wallet availability, virtual-card behavior,
merchant receipts, legal content, support availability, financial states, implementation
code, or decorative illustrations/animations.

---

## 1. Visual design principles

1. **One system, not screen-by-screen decoration.** Every value traces to an existing
   verified token, a documented correction, or a newly proposed *semantic* token justified at
   system level — never invented because one screen looked better with it.
2. **Hierarchy before containment.** Typography, alignment, spacing, and grouping do the
   organizing work first; a white rounded card is reserved for an object that genuinely needs
   visual containment, not a default wrapper for every idea on a page.
3. **One dominant action.** Exactly one visually unmistakable primary per screen (Phase 5 §1),
   expressed through weight/fill/position, not through making every screen read like a
   landing page.
4. **Financial clarity.** The amount the user must understand or act on always wins the
   strongest numerical hierarchy on its screen — never competing with status chips,
   participant counts, timestamps, or metadata.
5. **Social clarity.** People are names, initials, amounts, and calm status words — never an
   administrative table, never icon-only status with no text backup.
6. **Status restraint.** Sixteen backend states do not mean sixteen visual treatments — tone
   communicates importance/actionability/money-outcome, not state-machine breadth (Phase 6
   §11 already collapsed most states to three tones: neutral, active/informational, positive,
   plus a narrowly-reserved attention tone).
7. **Feel:** simple, warm, financially clear, premium, socially aware, youthful without
   childishness, branded without resembling a generic generated fintech UI — measured against
   vinkin.org's own real, sourced design language (`docs/design/vinkin-design-system.md`),
   not an invented aesthetic.

---

## 2. Existing-token audit

**Mobile (`apps/mobile/lib/design_system/`) — the authoritative source, already real and
built:**

| File | Contents | Assessment |
|---|---|---|
| `vink_colors.dart` | `ink #0A0A0B`, `paper #F7F3EB`, `smoke #6E6A61`, `blue #315CFF`, `blueDeep #2247D6`, `white #FFFFFF`, `danger #D64545` (app-derived — the site itself has no error palette) | Complete, restrained, sourced. Zero green anywhere — "paid"/success already uses solid `blue`, not a separate success hue (confirmed by the file's own comment). This phase preserves that: **no green is introduced anywhere in this system.** |
| `vink_typography.dart` | Bricolage Grotesque (display: headings, amounts, buttons) + Inter (body) + a narrow monospace/eyebrow use | Complete, sourced, already role-oriented (`title`, `cardTitle`, `amountLarge`, `body`, `label`, etc.) — this phase mostly *names* existing styles into the roles §5 requires, rather than replacing them. |
| `vink_spacing.dart` | 4px-step scale: `xs 4, sm 8, md 16, lg 24, xl 32, xxl 48`, plus `cardPadding 28` (site's own `p-7`) | Complete, small, honest about which values are "app-derived" vs. site-sourced. |
| `vink_radius.dart` | `lg 8, xl 12, xxl 16, xxxl 24, card 32 (site's rounded-[2rem]), pill 9999` | Complete — six values, already minimal. |
| `vink_shadows.dart` | `card` (soft ink shadow), `cardElevated` (dramatic, "one per screen" per its own comment), `ctaGlow` (blue, **"use once per screen"** per its own comment) | Already encodes the restraint this phase would otherwise have to invent — `ctaGlow`'s own doc comment is functionally identical to this phase's "one dominant action" rule. |
| `vink_status_badge.dart` (Phase 1 finding) | An existing, undeclared four-tone system: `neutral` (`ink/8` bg, `smoke` text), `active` (`blue/12` bg, `blue` text), `positive` (solid `blue` bg, `white` text), `attention` (`danger/12` bg, `danger` text) | **This is the closest thing to a semantic color system that already exists** — §4 below formalizes and extends it rather than replacing it. |

**Guest Web (`apps/guest-web/app/globals.css`):** mirrors the five colors + `danger` +
the two font families exactly, via Tailwind `@theme inline` CSS variables. **Gap found this
phase:** no equivalent explicit spacing/radius/shadow token file exists for Guest Web — it
relies on Tailwind's own default scale (4px-based, e.g. `p-4`=16px) applied ad hoc per
component, not a named, shared scale mirroring `vink_spacing.dart`/`vink_radius.dart`. §6/§7
below formalize a shared scale both platforms should converge on.

**Overall assessment:** the existing token set is small, sourced, and already disciplined —
this phase's job is mostly **naming existing values into semantic roles**, filling a small
number of real gaps (a few missing states: disabled, tertiary text, warning/recovery/returned
tones, focus, scrim, skeleton), and fixing the one confirmed miscalibration (`EXPIRED`'s
`attention` tone, corrected to neutral in Phase 6 §11) — not a rebuild.

---

## 3. Proposed semantic token architecture

**Naming convention:** `role.variant` (e.g. `surface.primary`, `text.secondary`,
`action.primary.pressed`). Every semantic token resolves to one of the six existing hues
(`ink`, `paper`, `smoke`, `blue`, `blueDeep`, `danger`) at a defined opacity/weight — **no
new hue is introduced anywhere in this document.** Where an opacity value is needed beyond
what exists today, it's chosen to match an opacity **already present in the codebase**
(`vink_status_badge.dart` already uses `ink/8`, `blue/12`, `danger/12` — these three exact
values are reused as the base "tinted" opacity throughout this system, not reinvented per
role).

---

## 4. Color-role table

| Semantic role | Resolves to | Source |
|---|---|---|
| `canvas.background` | `paper` | Existing (app background) |
| `surface.primary` | `white` | Existing (card surfaces) |
| `surface.secondary` (subtle, non-card grouping) | `ink` at 4–8% | **New, justified** — extends the exact opacity already used for the neutral badge tone; used for a grouped row background that needs *some* separation from canvas without becoming a full card (Phase 8 §13's "hierarchy before containment" tool) |
| `action.primary` | `blue` | Existing |
| `action.primary.pressed` | `blueDeep` | Existing — already documented as "hover/pressed state for blue" |
| `action.primary.disabled` | `blue` at ~35–40% | **New, justified** — no disabled token exists today; chosen as a fixed-opacity reduction of the existing hue, not a new color |
| `text.primary` | `ink` | Existing |
| `text.secondary` | `smoke` | Existing — **contrast finding: 4.86:1 on `paper`, passes AA, limited margin** (§24) |
| `text.tertiary` (timestamps, fine metadata) | `smoke` at ~70% (equiv. `ink` ~45%) | **New, justified** — a third, more-recessed tier below `smoke`; **contrast finding: below AA for small text — restrict to non-essential metadata only, never for anything a screen reader needs read as primary content** (§24) |
| `border.divider` | `ink` at 8–12% | **New, justified** — same family as `surface.secondary`, used for hairline separators instead of a card edge |
| `focus.indicator` | `blue` | Existing hue, new *role* — matches the site's own documented use of blue for "focus rings" |
| `status.informational` | `blue` at 12% bg / `blue` text | Existing (`active` tone, renamed) |
| `status.waiting` | `ink` at 8% bg / `smoke` text | Existing (`neutral` tone, renamed) |
| `status.success` | solid `blue` bg / `white` text | Existing (`positive` tone, renamed) — **no green, confirmed system-level decision, matching vinkin.org itself** |
| `status.warning` / `status.destructive.tinted` | `danger` at 12% bg (non-text, passes 3:1) / **`text.primary` badge text, not `danger` text** (D36 correction below) | Existing (`attention` tone, renamed) — **narrowed scope per Phase 6 §11: reserved for `RECOVERY_REQUIRED`/`RECOVERY_PENDING` (organizer-only) and `RESTRICTED`; `EXPIRED` and `FUNDING_REVERSAL` moved OFF this tone (corrected, see §17/§26). Per D36 (§24): `danger` text on this tinted background fails AA at every realistic badge size in this system (`label`, 14px/600 does not meet WCAG's large-text threshold — font weight alone does not qualify it). Corrected here: the badge's tinted background stays `danger` at 12% (a non-text use, passes 3:1), but the label word itself renders in `text.primary`, matching the badge outline/dot as the color signal instead of the text.** |
| `status.destructive.solid` (destructive button fill) | solid `danger` bg / `white` text — **pending tool verification; interim safe default is `text.primary`-tier text-only destructive styling (§10), not a solid danger fill, until verified** | **New, justified, but not yet approved (D36)** — hand-computed contrast on this exact pairing fails AA at every realistic button-label size in this system (§24); resolved by either a verified darker `status.destructive.solid.fill` variant or by not using a solid danger fill for text at all — decided in §10/§24, not asserted safe here |
| `status.dangerText` (proposed, D36) | a darker same-hue variant of `danger`, illustrative candidate `#A83A3A` — **not adopted, pending tool verification** | **New, proposed only** — exists so that if red customer-facing text is ever genuinely required, a verified token is available instead of reusing `danger` itself, per D36's explicit requirement |
| `status.recovery-required` | same as `status.warning` | Alias — organizer-only, per Phase 6 §11 |
| `status.returned` (money coming back, calm) | `blue` at 12% bg / `blue` text | **New, justified** — deliberately reuses `status.informational`'s exact weight rather than `status.success`'s solid fill, to visually distinguish "in motion, resolving" from "confirmed/complete" using weight, not a new hue |
| `scrim` | `ink` at 40–60% | **New, justified** — standard modal/sheet backing, same hue as everything else |
| `skeleton.loading` | `ink` at 4–6%, pulsing | **New, justified** — lighter than `surface.secondary`, same hue family |

**No new hue is introduced. No green is introduced.** Red (`danger`) stays reserved for
destructive actions, true failures requiring attention, and the two remaining organizer-only
consequential states — never for `EXPIRED`, which is a defined, non-alarming closed outcome
(Phase 6 §11).

---

## 5. Typography system

All roles resolve to existing `VinkTypography` styles (`apps/mobile/lib/design_system/vink_typography.dart`) — Guest Web should adopt the identical scale via its own CSS custom
properties, mirroring size/weight/line-height/tracking exactly (already partially true per
Phase 0's PV13 "restyled guest-web onto the identical tokens" note).

| Role | Token source | Size/LH | Weight | Tracking | Use | Max lines | Scaling |
|---|---|---|---|---|---|---|---|
| Brand/display heading | `heroDisplay` | 48/45.6 | 800 | −0.04em | Welcome only | 2 | Scales with OS text size; wraps, never truncates |
| Screen title | `title` | 30/28.5 | 800 | −0.04em | Screen-level headings (Home section headers, "Ready to pay") | 2 | Scales; wraps |
| Section heading | `cardTitle` | 18/17.1 | 800 | −0.04em | Card/row-group headings, Vink purpose in a card | 1 (ellipsis on overflow at the row level only, never in sentence-form copy per Phase 6 §27) | Scales |
| Primary amount | `amountLarge` | 36/34.2 | 800 | −0.04em | The one dominant amount per screen (§ Financial clarity) | 1 | Scales; never abbreviated (no "$1.2k") |
| Secondary amount | `amountMedium` | 24/22.8 | 800 | −0.04em | A supporting amount where a primary amount already exists elsewhere on-screen | 1 | Scales |
| Body | `body` | 16/24 | 400 | 0 | Supporting copy, form values | Unlimited, wraps | Scales |
| Supporting body | `bodySecondary` | 16/24 | 400 (smoke) | 0 | Supporting copy that should recede slightly | Unlimited | Scales |
| Label | `label` | 14/20 | 600 | 0 | Field labels, section labels | 1 | Scales |
| Button label | `buttonLabel` | 15/~14.25 | 700 | +0.025em | All button text (rendered uppercase visually, authored sentence-case per Phase 6 §4) | 1 | Scales moderately; button grows to fit rather than truncating label text |
| Participant name | `participantName` | 14/20 | 600 | 0 | Participant rows | 1, ellipsis only at the row's fixed-width name slot | Scales |
| Participant metadata | `bodySmallSecondary` | 14/20 | 400 (smoke) | 0 | Row status word, timestamps | 1 | Scales |
| Status (badge text) | `bodySmall` (600 weight variant) | 14/20 | 600 | 0 | Status pills | 1 | Scales |
| Countdown | `bodySmallSecondary` (numeric) | 14/20 | 400–600 depending on urgency tier (§16) | 0 | "Closes in 4 minutes" | 1 | Scales |
| Legal/support link | `bodySmall` | 14/20 | 400, underline on Guest Web | 0 | Support link, deferred legal-link placement | 1–2 | Scales |

**Editorial heading character is preserved by restraint, not repetition:** `heroDisplay` and
`title` are reserved for genuinely screen-defining moments (Welcome, a section header, "Ready
to pay") — not applied to every card's own internal heading, which uses `cardTitle` instead.
This is the direct fix for "oversized headings on every surface."

---

## 6. Spacing and layout system

Base unit: **4px**, matching `vink_spacing.dart` exactly (`xs 4, sm 8, md 16, lg 24, xl 32,
xxl 48`, `cardPadding 28`). No new spacing values are introduced; roles are assigned to the
existing scale:

| Role | Value | Notes |
|---|---|---|
| Compact spacing (icon-to-label, chip padding) | `xs`–`sm` (4–8) | |
| Field spacing (between form fields) | `md` (16) | |
| Row spacing (participant rows, list items) | `sm`–`md` (8–16) depending on density need — **default `sm` (8)** to fix the "long stacks of cards" complaint; `md` reserved for rows that need more breathing room (e.g. Home's Vink cards, which are denser objects than a participant row) | |
| Section spacing | `xl` (32) | Between distinct screen sections (e.g. vessel → participant list → invite controls) |
| Screen gutters (mobile) | `md`–`lg` (16–24) horizontal | 16 on narrow devices, 24 on standard+ |
| Top-safe-area | OS-provided safe-area inset + `sm` (8) | Never a fixed pixel guess |
| Bottom-action-safe-area | OS-provided safe-area inset + `md` (16), primary action never sits flush against a device's rounded corner/home indicator | |
| Card/surface internal padding | `cardPadding` (28) | Matches the site's own `p-7` exactly |
| Modal/bottom-sheet padding | `lg` (24) horizontal, `md` (16) top before content, `lg` (24) bottom above the primary action | |
| Guest Web desktop max content width | **640px** (new, justified below) | |

**Guest Web max-width justification:** Guest Web is a single-purpose, single-column,
amount-focused surface (Phase 3 §6) — a wide desktop viewport should not stretch a "$24.50"
figure across the full screen. 640px is chosen as a reading-width comparable to the mobile
app's own effective content width at `cardPadding` margins on a standard phone, keeping the
two surfaces visually consistent rather than Guest Web reading as a generic wide web form.

**Density rule, stated once, applied everywhere:** a screen that would otherwise become "a
long stack of cards" (Home's Vink list, People and Split's participant list, Live Vink's
participant list) uses **row spacing (`sm`/`md`), not card spacing (`lg`/`xl`)** between
repeated items of the same kind — cards are for singular, distinct objects (the Ink vessel,
the temporary card), not for every repeated row in a list (§13).

---

## 7. Radius system

No new radius value is introduced — `vink_radius.dart`'s six values are assigned roles,
not expanded:

| Role | Value |
|---|---|
| Buttons | `pill` (9999 — fully rounded, matches "every button on the site is a pill") |
| Inputs | `xl` (12) |
| Primary surfaces (the Ink vessel container, the temporary-card surface) | `card` (32 — the site's own hero-mockup radius) |
| Compact rows (participant rows, list items) | `lg` (8) or no radius at all if the row has no distinct background (§13 — rows using `surface.secondary` at low opacity use `lg`; rows with no fill need no radius) |
| Bottom sheets | `xxxl` (24) on the top two corners only |
| Modal/dialog surfaces | `xxxl` (24), all corners |
| Ink Progress vessel | `card` (32) for its outer container; the fill itself follows the vessel's own shape, not a separate radius token (§15) |

---

## 8. Elevation and shadow system

No new shadow is introduced — `vink_shadows.dart`'s three values, used exactly as their own
doc comments already prescribe:

| Context | Shadow | Rule |
|---|---|---|
| Flat surface (canvas, most rows, most body content) | none | Default — most of the product is flat |
| Raised interactive surface (a Vink card on Home, the Ink vessel container) | `card` | Everyday elevation |
| The single most prominent object on a screen (the Live Vink's vessel, the temporary-card surface once revealed) | `cardElevated` | **One per screen, matching its own doc comment** |
| The primary CTA | `ctaGlow` | **Once per screen, matching its own doc comment** — this token already encodes "one dominant action" |
| Bottom sheet/modal | `cardElevated`-equivalent on its top edge, or platform-native modal elevation on Guest Web (CSS `box-shadow` mirroring `card`) | |
| Passive sections (participant list, status text, form fields) | **none — shadows are explicitly removed here** | Direct fix for decorative-shadow overuse; a participant row is not a "raised" object |

---

## 9. Icon system

**Family in use today:** not independently audited in this pass beyond what's inferable from
the design system doc (Material-adjacent line icons, consistent with Flutter's default
icon font usage) — **flagged as unverified**, not asserted. This phase specifies rules,
not a new icon set:

| Rule | Specification |
|---|---|
| Canonical sizes | 16px (inline, inside text-height contexts), 20px (default row/button icon), 24px (standalone tappable icon-only controls) — three sizes only |
| Stroke/fill | Line-weight consistent with Inter's body weight (avoid mixing filled and outlined icons within one screen) |
| Text alignment | Optically centered on the cap-height of adjacent text, not the full line-height box |
| Icon-only eligibility | Only where meaning is universally obvious (close ✕, back chevron, per Phase 5 §1) — every other icon-only candidate pairs with a visible label |
| Destructive icon treatment | `danger`-colored icon permitted independently once its own non-text contrast (3:1) against its background is tool-verified — **not required to pair with `danger`-colored text** (D36: icon/border/accent use and text use are verified separately; per D36's explanatory-copy rule, the *label* next to a destructive icon is `text.primary`, not `danger`) — never color-only signaling regardless |
| Participant-state icons | **Avoided as the primary signal** — status is a text word (§14) with color as reinforcement, never an icon standing alone for "paid"/"waiting"/"failed" |
| Accessibility | Every icon-only control has an accessible label (Phase 5 §1); decorative icons (paired with visible text) are marked decorative/hidden from screen readers to avoid redundant announcement |

**Avoid:** generic banking illustrations, decorative fintech iconography (piggy banks, coins,
credit-card-with-sparkles), ambiguous status symbols (a lone colored dot with no text is
never sufficient — matches §24's non-color-communication requirement).

---

## 10. Button visual system

| Tier | Fill | Text | Height | Horizontal padding | Radius | Icon spacing | Width |
|---|---|---|---|---|---|---|---|
| Primary | `action.primary` (pressed: `action.primary.pressed`) | `white`, `buttonLabel` | 52px (comfortable mobile tap target, exceeds the 44pt minimum) | `lg` (24) | `pill` | `sm` (8) between icon and label if present | Intrinsic-width by default; full-width only on screens where the action *is* the dominant task (Login, Register, Open Vink confirmation, Pay) — **never full-width merely by default**, fixing the brief's "giant full-width buttons where the action is not the dominant task" concern |
| Secondary | `surface.primary` with `border.divider` outline, or no fill (text + subtle underline on Guest Web) | `text.primary` or `action.primary` (context-dependent — a secondary action referencing the primary color, like "Share another way," may use `action.primary` text on a transparent fill) | 44px | `md` (16) | `pill` | `sm` (8) | Intrinsic-width |
| Tertiary/text | none | `text.secondary` | 40px (smaller tap target acceptable at tertiary weight, still ≥44pt effective hit area via padding) | `sm` (8) | none (text button, no chrome) | `xs` (4) | Intrinsic-width |
| Destructive | **Pending D36 verification.** Interim safe default: transparent/`text.primary`-tier fill with a `danger` icon accent and `text.primary` label ("Cancel Vink," "Sign out") — matches Sign-out's existing text-tier treatment. `status.destructive.solid` (solid `danger` fill, white text) is specified but **not approved for use** until a tool-verified fill variant clears AA at the button's actual label size (§4/§24 — hand computation shows the current `danger`/`white` pairing fails at every realistic button size in this system, since `buttonLabel` at 15px/700 does not meet WCAG's large-text threshold) | `text.primary` (interim) or `white` on a verified darker fill (once approved) | 52px (confirm actions) or 44px (text-only, e.g. "Remove") | `lg`/`md` matching the fill tier | `pill` | `sm` (8) | Intrinsic-width, never full-width for a destructive action (never make "Cancel Vink" the easiest, widest target on the screen) |
| Icon-only | transparent or `surface.secondary` | icon color matches the tier it represents | 44×44 minimum tap target regardless of visual icon size | n/a | `pill` (circular hit area) | n/a | Fixed |

**States:** loading (label replaced by an inline spinner, fill/height unchanged, tap
disabled), disabled (`action.primary.disabled` fill or 40% opacity on any tier, text
correspondingly reduced, never fully invisible), pressed (`action.primary.pressed` for
Primary; a subtle opacity/scale reduction for other tiers), focused (2px `focus.indicator`
outline, offset from the button edge, visible on keyboard focus — Guest Web primarily, though
mobile platforms' own focus rings apply for external keyboard/switch-control use).

**Placement above safe areas:** the primary action on a scrollable screen with a single
dominant next step (Login, Open Vink confirmation, Guest contribution) is pinned above the
bottom safe-area inset, not requiring a scroll to reach — matches Phase 4's existing
"step's primary action stays pinned/visible" contracts.

**Mobile vs. web:** identical visual tier system; Guest Web additionally supports a visible
focus outline (keyboard navigation, §24) and hover states (`action.primary.pressed`-equivalent
on `:hover`, not just `:active`) that mobile doesn't need.

---

## 11. Form system

| Element | Specification |
|---|---|
| Text field | `surface.primary` fill, `border.divider` 1px border (2px `action.primary` on focus), `xl` (12) radius, `md` (16) internal padding, `label` above (never placeholder-as-label, Phase 5 §13) |
| Amount entry (Total, Custom Amount) | Distinct, larger treatment — uses `amountMedium` for the entered value itself (not `body`), numeric keypad, live currency formatting — **the total field on Purpose+Total specifically uses `amountLarge`**, matching §4's "financial clarity" rule that creation-time entry gets the strongest numerical hierarchy on that screen |
| Phone/email field | Standard text field, keyboard type matches the selected contact method, inline format validation (Phase 5 §13) |
| Participant-name field | Standard text field, always visually and structurally separate from the contact-destination field (Phase 5 §13's locked rule) — the two never share one input or one visual row |
| Custom-share entry | Per-row numeric field, right-aligned (amounts align on their decimal/trailing edge across rows), live running total displayed above the list (`label` weight, not `amountMedium` — this is a *checking* number, not the dominant amount) |
| Segmented Equal/Custom control | Two-option pill-group, `action.primary` fill on the selected option, `surface.secondary` on the unselected — no third (Percentage) option ever rendered (D22) |
| Error state | `danger` border (non-text, 3:1 threshold — clears comfortably against `paper`/`white`, §24) + inline `bodySmall` error text in **`text.primary`, not `danger`** (D36: explanatory error copy uses primary text; `danger` is reserved for the border/icon accent, not the sentence itself), field label unchanged |
| Focused state | `action.primary` 2px border, no fill change |
| Disabled state | `surface.secondary` fill, `text.tertiary` value text, no border |
| Helper text | `bodySmallSecondary`, below the field, replaced (not stacked) by an error message when one is present |
| Truncation | Field *values* never truncate mid-edit; a display value (e.g. a saved contact) may truncate with an ellipsis only outside active editing |
| Keyboard-safe layout | The focused field always scrolls into view above the keyboard; the screen's primary action (where present above the fold) stays reachable via the keyboard's own "next/done" affordance, matching Phase 5 §14 |

---

## 12. Navigation system

- **Bottom navigation:** unchanged three-tab shell (Home, Activity, Profile) — no fourth tab,
  **explicitly no Invitations tab** (matches D19/D27's resolution that delivery is a pipeline,
  not a destination surface).
- **Home's creation action:** "Start a Vink" is a primary button on Home, not a floating
  action button competing with the tab bar — Create remains **an action flow, never a
  permanent content destination** (it has no tab, no persistent entry beyond that one
  button).
- **Pushed screens:** standard platform push transition (slide-from-trailing-edge on mobile),
  used for Live Vink, Vink Details, Contact Information, Change Password.
- **Modal routes:** none required beyond the sheets in §18 — no screen in this system is a
  full-screen modal takeover.
- **Transient confirmation (Open Vink):** a bottom sheet, not a route — per D30, never a
  pushed screen of its own.
- **Back affordances:** platform-native back gesture/chevron; Guest Web uses browser-native
  back only (no in-app back chrome, per Phase 4/5 — Guest Web has no back-stack of its own to
  manage).
- **Guest Web navigation:** minimal-to-absent chrome — no persistent header/nav bar beyond a
  small VinkIn wordmark for brand identity, no menu, no tabs. The page **is** the task.

---

## 13. Surface and card rules

**Decision framework** (in order of preference — start at the top, escalate only when the
object genuinely needs it):

1. **No container** — plain typography + spacing. Default for most content (headings,
   supporting copy, status text, the countdown).
2. **Grouped row section** — a set of related rows (participant list) separated by
   `border.divider` hairlines or `row spacing`, no background fill. Default for lists.
3. **`surface.secondary` fill** (low-opacity `ink`) — a group that needs *some* visual
   separation from canvas without full elevation (e.g. a compact info block). Used sparingly.
4. **White surface (`surface.primary`, no shadow)** — a genuinely distinct object that isn't
   yet the screen's single most prominent one.
5. **White surface + `card` shadow** — the everyday "this is a card" treatment. Reserved for
   objects like a Home Vink-card, not every section of a detail screen.
6. **White surface + `cardElevated` shadow** — the one most prominent object per screen (the
   Ink vessel, the revealed temporary-card surface). At most once per screen.
7. **Transient banner** — full-width, no radius, used only for the brief "Everyone's in"
   transition (Phase 4/5) — not a persistent UI element.
8. **Bottom sheet / modal** — for the six sheets in §18 only.

**Current over-cardification to remove:** per Phase 1's audit, the Lobby currently wraps the
organizer's own "Your share" amount in a separate card *in addition to* their own participant
row (Phase 1 §F.1/Phase 3 §3 already decided this consolidates into one row) — this phase's
visual instruction is the same: **that second card is removed entirely**, not just
data-consolidated; the single remaining row uses tier 2 (grouped row section), not a card.
Status badges likewise never sit inside their own card — they're inline text/pill elements
within whatever container already exists (tier 1 or 2).

---

## 14. Participant-row system

| Attribute | Specification |
|---|---|
| Avatar/initial | A deterministic-color circle (derived from the name, from the existing 6-hue palette only — e.g. a hash of the name selects among `blue`/`smoke`/`ink`-tinted variants, never an arbitrary new hue) showing 1–2 initials, `participantName` weight |
| Name | `participantName` style, truncates with ellipsis only at a fixed-width slot (never wraps to a second line in a row) |
| Amount | Right-aligned, `bodySmall` weight — **never competing with the screen's dominant amount** (§4) |
| Status placement | Trailing, compact word (§ Phase 6 §7's row/badge vocabulary: "Waiting," "Processing," "Paid," "Needs another try," "Sending…," "Sent," "Couldn't send") — text-led, color as reinforcement only |
| Tap affordance | Organizer/member Lobby only: tapping a row opens Edit Participant (Create-phase) or is inert (Lobby-phase, post-open — no participant editing after a Vink opens, matching the domain's own constraints) |
| Trailing action | "Share another way" (compact, per-row, only while relevant, Phase 5 C17/C19) |
| Privacy differences | Organizer/member: full row for every participant. **Guest Web: no participant rows at all** — only the aggregate vessel and the guest's own status, per Phase 0 §2/D24's privacy boundary — this is a structural absence, not a stripped-down row |

**Role-specific rows:** the organizer's own row carries no separate visual badge beyond
appearing first in the list (or in natural alphabetical/insertion order — no special
"(you)" chrome beyond a small trailing label if needed for clarity) — reinforcing D19/Phase
6's "organizer is a normal participant" principle visually, not just financially.

**The participant row must not resemble an administrative database row:** no monospace IDs,
no raw timestamps, no grid-of-columns treatment — one line, name-forward, amount and status
trailing, consistent with a contacts-list or messaging-app row, not a spreadsheet.

---

## 15. Ink Progress System — visual specification

The vessel is a single reusable component with four size/context variants, driven only by
`contributionProgress` (D20/D24) — **never a linear bar beside it, anywhere, under any
circumstance** (locked rule, restated).

| Variant | Context | Container | Fill treatment |
|---|---|---|---|
| Primary — Lobby | Organizer/member, full detail | `card` radius, `cardElevated` shadow (this screen's one most-prominent object) | Fill rises smoothly from previous confirmed value to new value (Phase 5 §17); headline `amountLarge`-adjacent treatment for "$X of $Y ready" |
| Primary — Guest Session | Guest, aggregate-only | Same container treatment as Lobby | Identical fill behavior; **no per-participant breakdown ever rendered inside or beside it** (privacy boundary) |
| Compact — Home preview | Per-Vink card on Home | No separate container — lives inside the existing Vink card (tier 5 surface, §13), not its own elevated object | Small, non-interactive fill indicator, no waiting-clause text (Phase 4 §0 — Home shows only the fraction) |
| — | — | — | — |

**States:**
- **Empty** ($0 confirmed): fill at its minimum visible baseline (not literally zero-height —
  a sliver remains visible so the vessel reads as "a container," not "missing"), "Waiting for
  everyone."
- **Partial**: fill proportional to `confirmedAmountMinor/totalAmountMinor`, waiting clause
  per Phase 6 §12's exact name/count rules.
- **Near-complete**: same fill logic, no special treatment beyond the number itself changing
  — no separate "almost there" visual state invented.
- **Complete**: fill reaches its maximum, completes the "Everyone's-in" transition (Phase 5
  §17) as its final animated frame, not a second animation layered on top.
- **Waiting** (organizer/member's own unpaid share): the vessel itself is state-agnostic
  about *who* hasn't paid — the waiting clause carries that information in text, not a
  distinct vessel visual state.
- **Reduced motion**: instant level change, no traveling fill/droplets (Phase 5 §17,
  restated).
- **Loading vs. confirmed progress**: a contribution in `pending`/`processing` state **never
  visually fills the vessel** — the vessel only reflects `confirmed`-or-later contributions
  (locked rule, restated) — a processing contribution may show a subtle indicator *elsewhere*
  (the participant row's own "Processing" status word) but the vessel itself stays at its
  last true confirmed level until the server confirms the new one.

**Screen-reader text is authored independently of the decorative fill rendering** (Phase 6
§12/§23's exact announcement pattern) — the vessel's visual animation and its accessible
announcement are two separate implementation concerns, never coupled such that a
reduced-motion or screen-reader user gets a degraded information experience, only a degraded
*decorative* one.

**Explicitly avoided:** liquid/physics-simulation effects, splashing, bubbles, game-like
sound-adjacent visual flourish, or any rendering that reads as playful rather than as a
precise, calm financial indicator.

---

## 16. Countdown system — visual specification

| State | Treatment |
|---|---|
| Normal active window (>1 min) | `bodySmallSecondary` weight, `text.secondary` color — quiet, informational |
| Under 1 minute | Steps up to `label` weight (600), `text.primary` color — **noticeably** more present, still no color change to `danger`, no animation |
| Submission cutoff reached (client-optimistic) | Replaced by "Finishing up" copy (Phase 6 §13), `status.informational` tone — a calm transitional state, not a stopped clock |
| Server reconciliation complete | Countdown UI is entirely replaced by the resulting terminal-state treatment (§17's badge/heading system) — never coexists with a "0:00" |
| Expired | No countdown remnant at all — the screen has fully transitioned to `EXPIRED`'s neutral tone (§4/§17) |

**Never:** flashing, pulsing red, shake/attention-seeking animation, or any treatment that
manufactures panic the underlying deadline doesn't itself create (matches Phase 6 §1's "no
artificial urgency" trait). The countdown becomes *more legible* (weight/color step) as
urgency genuinely increases — it never becomes *alarming*.

---

## 17. Loading and state-feedback visual grammar

| Context | Treatment |
|---|---|
| Initial page load (genuine first fetch, no cache) | A content-shaped skeleton (`skeleton.loading` fill, matching the real layout's proportions) — never a bare centered spinner replacing a screen whose shape is already known |
| Inline action loading (button) | Spinner replaces the button's label only, button retains its size/position (§10) |
| Skeleton use | Reserved for first-fetch-no-cache moments; a screen with cached data **never** shows a skeleton over content it already has (Phase 4/5's cached-first-paint principle — this is a visual-system enforcement of that behavioral rule) |
| Realtime reconnect | **No visual change at all** for a brief drop — content stays exactly as last known (§ Phase 5 §11); a prolonged disconnect shows only the quiet `status.waiting`-toned "You're offline" indicator (Phase 6 §19), never a full-screen interruption |
| Payment processing | Inline status text ("Confirming your payment…") at `bodySmallSecondary`, replacing the action button's label per §10's loading state — no separate full-screen processing graphic |
| Invitation sending | Per-row inline status word only (§14), no screen-level loading treatment |
| Preparing payment | `status.informational` tone, `cardTitle`-weight heading ("Getting your card ready"), no provider iconography (§9's "avoid decorative fintech icons" applies directly here) |
| Return pending | `status.returned` tone (§4) |
| Recovery-required | `status.warning` tone, organizer-only surface (§4/§14) |
| Unexpected error | Centered, calm — icon (if any) is a simple, non-alarming mark, never a red exclamation-triangle cliché; `text.primary` heading, `text.secondary` explanation, per Phase 6 §16 |

**Guest Web specifically:** server-known invite context (organizer, purpose, guest's own
share) renders on first paint from server-rendered data, **before** any realtime
enhancement — the realtime channel only ever *upgrades* an already-complete screen, never
gates it (Phase 4 §8, restated as a visual/rendering-order rule here).

---

## 18. Bottom sheets and dialogs

| Sheet | Width/mobile behavior | Radius | Handle | Title | Actions | Destructive treatment | Scrim | Dismissal | Unsaved-change handling |
|---|---|---|---|---|---|---|---|---|---|
| Open Vink confirmation | Full-width mobile, max **480px** on any wider surface | `xxxl` top corners | Yes (drag handle) | `cardTitle`, "Ready to open?" | "Open Vink" (primary) | n/a | `scrim` | Background tap → dismiss to People+Split, data intact (no unsaved-change prompt needed, §D30) | n/a — nothing is ever lost by dismissing this sheet |
| Add/Edit Participant | Full-width mobile, max 480px | `xxxl` top corners | Yes | `cardTitle`, "Add person"/"Edit {name}" | "Add"/"Save" (primary) | "Remove" (destructive, Edit only, text-tier) | `scrim` | Background tap with content entered → confirm-before-discard prompt (§ Phase 5 §12) | Explicit prompt, never silent discard |
| Participant actions (row's own trailing menu, if any beyond the inline "Share another way") | Compact, content-height only | `xxxl` top corners | Yes | none needed (self-evident from context) | Row-specific (e.g. "Share another way," "Remove") | Per-action tier | `scrim` | Background tap dismisses freely | n/a |
| Invitation fallback | Full-width mobile, max 480px | `xxxl` top corners | Yes | `cardTitle`, "Share another way" | "Copy link," "Share," "Show QR code" (all secondary-tier) | n/a | `scrim` | Background tap dismisses freely | n/a |
| Cancel Vink confirmation | Full-width mobile, max 480px | `xxxl` top corners | Optional (short sheet, handle still recommended for consistency) | `cardTitle`, "Cancel this Vink?" | "Cancel Vink" (destructive, solid), "Never mind" (tertiary) | Full destructive-solid treatment (§10) | `scrim` | Background tap → "Never mind" (safe default) | n/a |
| Support-contact context | Full-width mobile, max 480px | `xxxl` top corners | Yes | `cardTitle`, "Contact support" | "Send" or platform mail-composer handoff | n/a | `scrim` | Background tap dismisses freely | n/a |

**Keyboard behavior:** any sheet containing a text field resizes/scrolls to keep the focused
field visible above the OS keyboard, matching §11's form rule.

**No sheet ever opens another sheet** (locked rule, restated) — Show QR reveals inline within
the Invitation-fallback sheet itself, not as a nested second sheet.

---

## 19. Ready-to-Pay shell (provider-independent, D32/D35)

Only the stable, provider-independent visual shell is specified — the module inside it is
represented by the internal marker `[provider-supported payment method]` (D35), never
rendered as real customer-facing content in this document.

| Element | Specification |
|---|---|
| Readiness heading | "Ready to pay" — `title` weight, top of the shell |
| Available amount | `amountLarge`, directly below the heading — the dominant number on this screen (§4) |
| Safe context | "Card ending {last4} · Up to $X" as safe summary information only, `bodySmallSecondary` — never the visual focus of the screen |
| Deliberate entry | The shell itself is only reached via the deliberate "Pay now" tap (D32) — it is never auto-presented |
| Bounded module | A clearly bounded region (a `surface.primary` + `card` shadow container, distinct from the shell's own chrome) reserved for `[provider-supported payment method]` — its visual weight is deliberately **unresolved/neutral** in this document: no button, no wallet mark, no card-network logo, no PAN/CVV field, no "copy number" control, no register/checkout instructions are drawn here. The bounded region exists so implementation has a defined slot to fill later, not so this document can imply what fills it. |
| Exit/back behavior | Standard back navigation returns to the Lobby, vessel/participant list unaffected (§15) |
| Loading/recovery placement | If provisioning fails after this point, the screen transitions to the dedicated recovery/reversal treatment (§17), never leaves the bounded module in a stuck/ambiguous visual state |

**Explicitly not designed here:** a wallet button, full virtual-card credential display,
PAN/CVV reveal, copy-number controls, register instructions, online-checkout instructions, or
a provisioning animation. **The unresolved module must not visually appear complete or
approved** — it is bounded and neutral, not styled to look finished.

---

## 20. Vink Details — visual specification

Read-only historical surface (D29/D31 — "Vink details," never "Receipt," never styled to
resemble a merchant receipt or bank statement).

| Role | Treatment |
|---|---|
| Organizer role | Full detail: every participant's outcome, timeline, merchant settlement figure |
| Participant role | Same structural layout, same data scope (Phase 0 §2 — members see full detail like organizers) |
| Completed | `status.success`-toned heading ("Payment complete") |
| Expired | Neutral-toned heading (§4/§17's `EXPIRED` correction) |
| Cancelled | Neutral-toned heading |
| Return pending | `status.returned` tone |
| Returned | `status.returned` tone (settled weight — no longer "in motion," but the same hue family as return-pending for continuity, distinguished by verb tense in copy, not a new color) |
| Recovery-resolved | `status.success` tone once resolved (same as Completed — a resolved recovery *is* a completed Vink from this view's perspective, Phase 0 §11) |

**Visual restraint:** no itemized line-by-line "receipt" layout (no tax lines, no merchant
letterhead styling, no faux-thermal-printer typography) — this screen uses the exact same
typographic/spacing system as every other screen in the product, reinforcing D31's naming
decision visually, not just lexically.

---

## 21. Profile, Support, and Legal — visual specification

| Element | Treatment |
|---|---|
| Profile grouping | Three groups, `border.divider`-separated rows within a single grouped-row section (tier 2, §13) — no separate card per row |
| Contact-information hierarchy | Name (`body`) above contact destination (`bodySecondary`) — always two visually distinct lines, never merged (Phase 5/6's separate-fields rule, extended visually) |
| Change-password entry | Standard pushed-screen form (§11) |
| Minimal support affordance | A single row, `label` weight, trailing chevron — no icon implying live chat/phone support unless that's genuinely what's configured (§9 — avoid implying capability that doesn't exist) |
| Deferred legal-link placement | **No visual placeholder is rendered for Terms/Privacy** — the row simply doesn't exist yet (D28) — this phase does not reserve visual space for content that doesn't exist, avoiding the "implies something already exists" anti-pattern the brief explicitly warns against |
| Sign-out treatment | Destructive-tier, text-only (not solid — a lower-consequence destructive action than Cancel Vink, per Phase 5 §1's tier guidance), requires confirmation (Phase 4 §12) |

**Do not visually imply** deferred payment methods, advanced security, legal documents, or
support-response guarantees exist — their absence is a plain absence, not a grayed-out
"coming soon" placeholder (which would itself be a form of implying existence).

---

## 22. Screen-by-screen visual composition deck

Template: Background — Chrome — Heading placement — Amount hierarchy — Supporting copy —
Primary action — Secondary actions — White surfaces — Participants — Ink Progress — Deadline
— Status treatment — Loading/error replacement — Scroll — Accessibility.

**Welcome:** `canvas.background` (paper) — no chrome — `heroDisplay` centered upper-third —
n/a — one line below heading — "Create account" pinned lower area — "Log in" tertiary below
it — no white surfaces (full-bleed background) — n/a — n/a — n/a — n/a — n/a (static) — no
scroll needed — standard heading semantics.

**Login:** paper canvas — minimal back chevron chrome — `title` "Sign in" upper — n/a —
n/a — "Log in" pinned above keyboard-safe-area — "Create account instead" tertiary link
below — form fields on canvas, no card wrapper (tier 1, §13) — n/a — n/a — n/a — inline error
only — skeleton n/a (instant) — scrolls above keyboard — error via live region.

**Register:** identical structure to Login, plus the contact-info field (§11) — Dependency:
**New — designed, not built** (D19/D27).

**Home — empty:** paper canvas — tab chrome visible — `title` "Start your first Vink"
centered mid-screen — n/a — one supporting line — "Start a Vink" primary centered below — n/a
— no surfaces — n/a — n/a — n/a — n/a — n/a — no scroll — standard.

**Home — with active Vink(s):** paper canvas — tab chrome — section headers ("Needs your
attention"/"Waiting on others," `label` weight) — compact vessel per card carries the amount
hierarchy (§15) — status word per card — "Start a Vink" pinned/accessible without scrolling
past the list — cards tappable, no separate "view" action — Vink cards are tier-5 white
surfaces with `card` shadow (§13) — n/a (no per-participant detail on Home) — compact vessel
variant (§15) — n/a (Home doesn't show individual Vink deadlines, only status) — badge tone
per §4/§17 — cached-first-paint, no skeleton on warm navigation — vertical scroll, single
list — each card's accessible label per Phase 4 §4.

**Purpose and Total (Create screen 1):** paper canvas — minimal back chevron — `title` "What's
this for?" upper — the Total field itself uses `amountLarge`-weight entry (§11) — purpose
field below — "Next" pinned primary — "Back" via chevron only — form fields on canvas, no
card — n/a — n/a — n/a — n/a — inline validation only — no scroll needed on standard devices
— keyboard-safe.

**People and Split (Create screen 2):** paper canvas — back chevron — `title` "Who's
splitting this?" — running-total check-figure at `label` weight only when Custom is active
(§11 — never competing with participant rows) — Equal/Custom segmented control — "Add
person" secondary, "Continue" primary pinned — participant rows tier-2 (grouped, no card per
row, §13/§14) — n/a (Ink Progress doesn't appear pre-open) — n/a — n/a — cached local state
only, no network loading — scrolls if the list is long, "Continue" stays pinned — each row's
accessible label states name/amount/delivery-choice.

**Open Vink confirmation:** sheet per §18 — `cardTitle` "Ready to open?" — full allocation
summary, total at `amountMedium` (secondary to nothing else on this compact sheet, so it may
read as the dominant figure here even at "secondary" token weight — a sheet-local exception
noted, not a new token) — every share listed, `bodySmall` rows — "Open Vink" primary pinned
in the sheet — dismiss via drag/tap-outside — sheet itself is the white surface — participant
shares listed as compact rows — n/a — n/a — n/a — button-local loading only — sheet content
scrolls if the participant list is long, action stays pinned — sheet announces itself per
§18.

**Live Vink just opened:** identical structural composition to "Live Vink partial progress"
below, at its empty state (§15) — no separate composition needed.

**Live Vink partial progress:** paper canvas — minimal chrome (back chevron, no tab bar
since this is a pushed screen) — purpose + status badge upper — **Ink vessel is the dominant
visual object**, `amountLarge`-weight headline inside it (§15) — waiting clause
`bodySmallSecondary` beneath the vessel — organizer's own "Pay $X" primary if unpaid, else no
primary action visible — "Share another way" secondary, only while incomplete — participant
list below the vessel, tier-2 rows — vessel per §15's Lobby variant — countdown per §16,
placed just below the status badge, above the vessel — status badge per §4/§17 — cached
snapshot instant, realtime upgrades in place, no blocking spinner (§17) — vertical scroll,
vessel stays near top not pinned — vessel announcement per §15/Phase 6 §12.

**Live Vink one person remaining:** identical composition, waiting clause reads a single
name (§ Phase 6 §12).

**Everyone's-in transition resting frame:** same screen, vessel at its complete state,
"Everyone's in" as a brief transient banner (tier 7, §13) overlaying/preceding the
Preparing-Payment state — not a new screen.

**Preparing payment:** same screen shell, vessel replaced by (or transitions into) a
`status.informational`-toned card-shadow surface, `cardTitle` "Getting your card ready" — no
action visible — participant list may collapse/recede beneath this (waiting-room controls
visually recede, Phase 5 §17).

**Ready to Pay shell:** per §19 in full.

**Payment complete:** paper canvas — purpose/status header — `status.success` tone —
`amountLarge` restates the final amount ("The merchant was paid $X") — no primary action (a
resolved, passive screen) — "View Vink details" secondary — no vessel (resolved, the vessel's
job is done) — participant list may remain visible below, all rows "Paid" — no countdown —
badge `status.success` — n/a — static, no scroll typically needed — outcome sentence is the
primary accessible content on arrival (Phase 4 §11).

**Activity:** paper canvas — tab chrome — no heading needed (a list) — no dominant amount at
the list level, each row carries its own `bodySmall` amount — n/a — n/a — n/a — no card
wrapper for the list itself (tier 2 rows, divider-separated) — n/a — n/a — n/a — outcome
label per row (§ Phase 6 §11's vocabulary, tone-matched) — cached list, background refresh —
vertical scroll — each row's accessible label per Phase 4 §10.

**Vink Details:** per §20 in full — pushed screen, back chevron chrome, no tab bar.

**Profile:** per §21 — pushed within the Profile tab (or the tab root itself) — tab chrome
present at the root.

**Contact information / Change Password:** standard pushed form screens (§11), back chevron
chrome, no tab bar.

**In-place reauthentication:** sheet, not a full route (§18-adjacent, though not in the
core six — same visual family: `scrim`, `xxxl` top-corner radius, drag handle) — "Sign in to
continue" heading, underlying screen dimly visible/frozen behind the scrim, per Phase 4 §14.

**Guest not open yet:** paper canvas — no chrome — centered, generous whitespace — `title`
"Not open yet" — one supporting line — no action — no white surface, no vessel, no
participant content (§19-adjacent restraint — nothing is rendered that the DRAFT-stage gate
wouldn't actually provide, D23) — static, `role="status"`.

**Guest active contribution (Join Form / pre-contribution Session):** paper canvas — minimal
VinkIn wordmark chrome only — organizer/purpose header — **guest's own share at
`amountLarge`, the dominant object on this screen** (§4) — group vessel (compact-to-primary
per Phase 4 §8, using the primary Guest variant, §15) below it — countdown visible (§16,
fixing the confirmed Guest Web gap) — "Approve $X" primary pinned — name field (Join Form
state only) — no participant rows (privacy boundary, §14) — no white card wrapper around the
share figure itself (tier 1, typography carries it) — server-rendered first paint (§17).

**Guest processing:** same screen, action button in its loading state (§10/§17), no
optimistic state change elsewhere on screen.

**Guest confirmed:** same screen shell, action removed permanently, outcome statement
("Your payment is confirmed" — Phase 6 §25) becomes the dominant heading in place of the
action.

**Guest completed / expired / cancelled / return pending / returned / recovery-required:**
one shared composition — outcome statement (D25/D34's exact phrase) as the dominant heading,
`status`-toned per §4, no action, simulation banner retained beneath (Phase 0 §12, unchanged
placement) — differs only by which of the six phrases and tones is shown, never by layout.

**Shared offline/reconnect/error states:** a persistent, quiet inline indicator (§17/Phase 6
§19) — never a full-screen takeover for offline/reconnect; a genuine unexpected error uses
the centered, calm composition described in §17's table.

---

## 23. Guest Web responsive-breakpoint system

| Breakpoint | Range | Max content width | Gutters | Notes |
|---|---|---|---|---|
| Narrow mobile | <380px | 100% | `sm` (8) | Amount figure steps down one size tier if needed (`amountMedium` instead of `amountLarge`) to avoid wrapping |
| Standard mobile | 380–767px | 100% | `md` (16) | Primary reference size — matches the app's own phone-width assumptions |
| Tablet | 768–1023px | 640px, centered | `lg` (24) | Content stays column-width, doesn't stretch |
| Desktop | 1024–1439px | 640px, centered | `xl` (32) | Same content width as tablet — this is a single-task page, not a dashboard that should use extra width |
| Very wide desktop | ≥1440px | 640px, centered | `xl` (32), with generous canvas margin beyond the content column | Never stretches further; excess space stays as calm background, not empty white cards |

**Vertical rhythm:** section spacing (`xl`, 32) between the header block, the share/vessel
block, and the action block — consistent across all breakpoints, only the horizontal
container width changes.

**Action width:** the primary action never exceeds the 640px content column's own width, and
narrows to an intrinsic width (§10) rather than full-bleed on tablet/desktop — full-width is
a mobile-only pattern here.

**Card/surface behavior:** at no breakpoint does the page become "repeated centered white
cards" — the guest experience is one continuous column (tier 1–2 surfaces predominantly),
with white/`card`-shadow surfaces reserved the same way §13 reserves them on mobile (the
vessel, at most one other genuinely distinct object).

**Footer/legal placement:** none exists yet (D28) — no reserved footer region is drawn for
content that doesn't exist (§21's restraint, applied to Guest Web).

**QR/fallback behavior:** the Invitation-fallback sheet (§18) becomes a centered modal
dialog (not a bottom sheet) at tablet/desktop widths — same content, platform-appropriate
presentation.

**Keyboard/viewport resizing:** on-screen keyboards are a mobile-web concern only; standard
browser viewport-resize reflow applies at all breakpoints — no fixed-height containers that
would clip content on a resized/rotated viewport.

**Guest Web must feel designed for the browser:** achieved by *not* recreating mobile's tab
bar/card-stack idioms — no bottom navigation, no pill-card list of "screens," a single
vertical reading column with browser-native scrolling and focus behavior throughout.

---

## 24. Accessibility and contrast audit (amended per D36)

**D36's discipline governs this whole section: no pairing is "universally accessible"
because one usage passes, normal-size text must meet the full AA threshold, and font weight
alone never grants the large-text exception — only WCAG's actual size test does (≥24px any
weight, or ≥18.66px **and** bold). Every number below is a hand-computed estimate via the
standard WCAG relative-luminance formula against the real hex values in `vink_colors.dart` —
flagged risk, not certification. Every pairing must be re-verified with a real contrast tool
before implementation, individually, per role — not inferred from a neighboring pairing that
happened to pass.**

**Checking `VinkTypography`'s actual sizes against the true large-text threshold first** (this
corrects an error in this document's own earlier draft, which had incorrectly treated
`buttonLabel` 15px/700 and `label` 14px/600 as qualifying for the relaxed 3:1 threshold on the
strength of their bold weight alone — they do not; 15px and 14px both fall under the 18.66px
bold-text floor): only `title` (30px), `amountMedium` (24px), `amountLarge` (36px), and
`heroDisplay` (48px) clear ≥24px and qualify as large text regardless of weight.
`cardTitle` (18px, even at 800 weight) falls **under** 18.66px and does **not** qualify.
Every other role (`body`, `bodySecondary`, `bodySmall`, `label`, `buttonLabel`,
`participantName`, `bodySmallSecondary`) is normal text for contrast purposes, full stop.

| Pairing | Approx. ratio | Realistic role(s) at this size | AA threshold that actually applies | Finding |
|---|---|---|---|---|
| `ink` on `paper` | ~17.9:1 | All roles | 4.5:1 (all are normal-text-sized in practice) | Pass, comfortably — primary text is never a concern |
| `smoke` on `paper` | ~4.86:1 | `bodySecondary`, `bodySmallSecondary` (both normal text) | 4.5:1 | **Pass, narrow margin** — tool-verify before shipping; no size in this system pushes `smoke` into the relaxed threshold |
| `blue` on `paper` (link/focus text use) | ~4.62:1 | `label`, inline links (normal text) | 4.5:1 | **Pass, narrow margin** — same caution, tool-verify |
| `white` on `blue` (primary button fill) | ~5.1:1 | `buttonLabel`, 15px (normal text — does not qualify as large despite bold weight) | 4.5:1 | Pass — primary buttons are safe |
| `danger` on `paper`/`white` (badge text, error accents, any body-scale use) | ~3.96:1 (`paper`) / ~4.38:1 (`white`) | `label` (14px/600), `bodySmall` (14px/400) — **neither qualifies as large text** | 4.5:1 | **Fail.** Corrected finding: this is not a narrow-context risk, it's a fail at every realistic body/label/badge size actually used in this system, because none of them clears the true 18.66px-bold or 24px floor. `danger` must not be used as text at these sizes (D36). |
| `white` on `danger` (destructive-solid button fill) | ~4.38:1 | `buttonLabel`, 15px/700 — **does not qualify as large text; the earlier draft's weight-based exception was wrong (D36's exact correction)** | 4.5:1 | **Fail.** `status.destructive.solid` is not approved for use as specified (§4/§10) — a verified darker fill/`dangerText` candidate is required before any solid-danger-fill button ships with white text. |

**Non-text contrast** (borders, focus indicators, UI component boundaries — 3:1 minimum, a
genuinely different, lower bar than text contrast — this is where `danger` remains usable
today): `focus.indicator` (`blue`) against `paper`/`white` clears 3:1 comfortably (~4.6:1) —
focus rings are not a concern. `danger` as a border/icon/accent color (not text) against
`paper`/`white` — luminance contrast ≈3.96–4.38:1 computed above, which clears the 3:1
non-text threshold — **usable for the field-error border and destructive icon accents
specifically because those are non-text uses, evaluated under the 3:1 bar, not the 4.5:1 text
bar** (D36's "icons, borders, accents, or controls only where the relevant... non-text
contrast requirements pass" clause). `border.divider` (`ink` at 8–12%) is intentionally
subtle/decorative, not a required-contrast UI boundary — not held to the 3:1 standard, which
applies to meaningful boundaries.

**Proposed remediation for genuinely-needed red text (D36):** a darker same-hue
`status.dangerText` candidate, illustratively `#A83A3A` (chosen to reduce relative luminance
toward the ~0.16 needed for a ~4.5:1 ratio against `paper`'s ~0.90 luminance) — **proposed
only, not adopted, pending real tool verification.** Until verified, no red customer-facing
text ships anywhere in this system at normal-text sizes; explanatory error/destructive copy
uses `text.primary` (§11), and any short label that must stay visually "red" does so only via
a `danger`-colored icon/border accent beside `text.primary` text, never via `danger`-colored
text itself.

**Other accessibility requirements:**
- **Touch targets:** 44×44pt minimum everywhere (§10) — never reduced for density; §6's
  row-spacing tightening affects the *gap between* rows, not the tappable height of each row
  itself.
- **Dynamic text scaling:** every typographic role (§5) scales with the OS text-size setting;
  layouts wrap/reflow rather than clip at larger sizes — verified as a rule here, not a
  per-screen exception.
- **Layout at increased text size:** the vessel's headline and the countdown both reflow to a
  second line before truncating; button labels grow the button rather than shrinking the
  text.
- **Screen-reader reading order:** matches each screen's visual top-to-bottom order in §22 —
  no composition in this document relies on a reading order that diverges from visual order.
- **Non-color status communication:** every status treatment in §4/§17 pairs color with text
  — restated as a hard requirement, not a preference.
- **Countdown announcement restraint:** §16/Phase 6 §12 — no per-tick announcements.
- **Reduced motion:** every animated moment in §15/§16/§17 has a defined static/instant
  alternative that loses no information, only decoration.
- **Guest Web keyboard navigation:** every interactive element (§10's focused state, form
  fields, the fallback-sheet's actions) is reachable and operable via keyboard alone, with a
  visible focus indicator at every step.
- **Error association with fields:** §11's error-state treatment places the message
  immediately below its field, programmatically associated (not merely visually adjacent) so
  assistive technology announces the correct field/error pairing.

---

## 25. Dark-mode decision

**Explicit MVP decision: dark mode is deferred, consistently, not partially built.** No
screen in §22 defines a dark-theme variant; no color role in §4 defines a dark counterpart.
This is a deliberate choice, not an oversight: vinkin.org's own sourced design language
(`docs/design/vinkin-design-system.md`) is built around a specific warm-cream/cobalt-blue
light identity — the brand's "feel" (§1) depends on `paper`'s warmth in a way a naively
inverted dark palette would undermine, and no dark-specific token audit exists today to build
one correctly. Building a partial or guessed dark mode would violate this phase's own "never
invent arbitrary values" rule as surely as an arbitrary light-mode color would. **Revisit
trigger:** a future phase explicitly scoped to design a dark theme from vinkin.org's own
source material (if the site ever defines one) or a direct product request — not implied by
this phase's silence.

---

## 26. Current-visual-system-versus-canonical-system matrix

| Area | Current | Canonical (this document) | Fix type |
|---|---|---|---|
| `EXPIRED` badge tone | `attention` (red, `danger/12`) | Neutral (`status.waiting`-equivalent) | **Fix required** — Phase 1/6 finding, now a formal token reassignment (§4) |
| Organizer "Your share" card | Separate card + separate participant row (duplicate) | One consolidated row (tier 2, §13/§14) | **Fix required** — Phase 1 §F.1 |
| Progress visualization | Linear `VinkProgressIndicator`, `fundedAmountMinor`-driven | Ink vessel, `contributionProgress`-driven (§15) | **Fix required, backend-dependent** — D20/D24 |
| Guest Web spacing/radius | Ad hoc Tailwind defaults, no named scale | Explicit shared scale mirroring `vink_spacing.dart`/`vink_radius.dart` (§6/§7) | **Formalization required**, no visual regression expected |
| Guest Web deadline | Not rendered | Rendered per §16/§22 | **Fix required** — pure rendering addition, no backend dependency |
| Destructive button color pairing | `white` on solid `danger` fill, unverified | **Not approved as-is (D36)** — interim `text.primary`-tier styling until a verified fill exists (§10/§24) | **Fix required, verification-gated** |
| `RESTRICTED`/`RECOVERY_REQUIRED` badge text color | `vink_status_badge.dart`'s existing `attention` tone renders `danger`-colored text on `danger/12` background today — the same pairing this phase's audit now flags as failing AA at the badge's actual 14px size | `danger`-tinted background retained (non-text, passes 3:1), label text moves to `text.primary` (§4/§24) | **Fix required** — a real, currently-shipping contrast issue, not merely a new-system consideration |
| Card usage on Lobby/Activity | Some over-cardification (every section wrapped) | Tiered surface system (§13), most sections uncontained | **Fix required** — visual density pass |
| Icon system | Unaudited | Rules defined (§9), specific family not re-specified | **Audit required at implementation** — this document sets rules, doesn't inventory every icon in use today |

---

## 27. Components and visual patterns to remove or consolidate

1. The Lobby's separate "Your share" card — removed, consolidated into the participant list
   (§13).
2. `EXPIRED`'s `attention`/red badge tone — reassigned to neutral (§4).
3. Any card wrapper around a status badge, countdown, or single line of supporting text —
   removed; these render as plain typography (tier 1, §13).
4. Guest Web's ad hoc spacing values — consolidated onto the shared scale (§6).
5. Any full-width button used by default on a screen where the action isn't the dominant task
   — narrowed to intrinsic width (§10).

---

## 28. Implementation dependencies

Restating Phases 3–6's own designed-but-pending list, now also visual-system-relevant —
none of these are built, and this document's visual specs for their screens (§22) describe
target rendering, not current rendering:

- Automatic SMS/email delivery (D19/D27)
- Contact capture (D19/D27, Register/Profile)
- Participant-inclusive Home and Activity retrieval (Phase 3 §1)
- `contributionProgress` (D24) — blocks §15's vessel from being real
- Guest `contributionStatus` (D24) — blocks §22's guest terminal-state compositions from
  being real
- Guest submission-deadline rendering (pure rendering fix, no backend dependency — the one
  item here that's implementable immediately)
- Guest terminal-state differentiation (D25)
- In-place reauthentication (D26)
- Provider-supported payment presentment (D32/D35 — genuinely unresolved, not merely unbuilt)

---

## 29. Dependencies Phase 9 (Motion System) must not contradict

1. The Ink vessel's motion triggers/states are fixed here (§15) — Phase 9 specifies
   *duration/easing*, not new triggers or a different data source.
2. The countdown never animates aggressively (§16) — Phase 9 must not add urgency-signaling
   motion (flashing, shaking) regardless of how "engaging" it might seem.
3. Reduced-motion alternatives are already defined per animated moment (§15/§16/§17) — Phase
   9 designs the *motion*, this document has already guaranteed the *static fallback* exists
   for each one.
4. No shadow/elevation change is itself an animation trigger beyond what §8 already scopes
   (`cardElevated`/`ctaGlow`, once per screen) — Phase 9 must not introduce elevation changes
   on hover/scroll as a new decorative pattern.
5. The Ready-to-Pay shell's bounded, unresolved module (§19) gets **no entrance animation
   implying completeness** — Phase 9 must not animate it in a way that makes an unresolved
   provider slot look like a finished, polished feature.

## 30. Acceptance criteria for moving into Phase 9

- [x] Owner corrected the contrast-approval discipline: verification is semantic-role- and
      pairing-specific, tool-verified, and font weight alone never grants the large-text
      exception (D36) — §4/§10/§11/§24 amended accordingly; `danger` text is not approved for
      use at any realistic body/label/badge/button size in this system until a darker
      `dangerText`/verified-fill candidate clears a real tool, and explanatory error copy now
      uses `text.primary` throughout.
- [ ] Owner confirms the dark-mode deferral (§25) as a deliberate MVP decision, not an
      oversight to revisit immediately.
- [ ] Owner confirms the Ready-to-Pay shell's deliberately unresolved, unstyled
      `[provider-supported payment method]` module (§19) as acceptable to carry into Phase 9
      exactly as bounded and neutral, not needing further visual resolution first.
- [ ] Owner confirms the over-cardification removals (§13/§27) — a real, if modest, visual
      change to existing built screens, not purely net-new design.
- [ ] No item in this document contradicts D1–D36 or Phases 0–6.

**Stopping here per instruction — no Phase 9 motion design, visual mockup generation, or
application implementation follows this document.**
