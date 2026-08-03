# I6 Reference Pack — Home, Activity, Vink Details

R0 design-input checkpoint, owner-directed, before the I6 implementation slice
(`docs/design/phase-10-implementation-readiness.md` §I6). Research and documentation only —
no production code was touched to produce this document. Source screenshots:
`~/Downloads/Mobbin UI Screens/{Cash App ios Nov 2025, Monzo ios Jul 2024, Revolut ios May 2025,
Wise ios Jan 2026, Venmo ios Oct 2023, Splitwise ios Jan 2026}`. See `00-reference-index.md` for
the full inventory, coverage table, and repository handling rules.

**Authority order, restated:** existing VinkIn decisions and design contracts are authoritative.
Every recommendation below traces to an approved Phase 4/5 contract, a ratified decision (D39,
D41, D42), or is flagged explicitly as a new observation requiring owner judgment before
adoption — none is presented as settled just because a reference app does it.

---

## 1. Reference matrix

One row per retained reference. "VinkIn use" names the specific I6 surface it informs.

| App | Flow/screen | Customer problem solved | Borrow | Reject | VinkIn use |
|---|---|---|---|---|---|
| Monzo | Home w/ Activity card (109, 316) | See balance + recent activity at a glance | Icon-left/label-center/amount-right row; amount color as the only status color (green credit/black neutral); thin 1px dividers, no per-row card | 316's "Payment link expired" is plain gray text with no distinguishing color at all — too low-salience for a state that needs the user's attention | Home active-Vink row |
| Monzo | Home, empty-ish (108) | Soften a genuinely empty account | System-generated first row + "Suggested actions" section rather than a bare blank card | The referral-bonus row itself (marketing-adjacent) | Home empty state |
| Monzo | Activity list (114) | Scan a long transaction history | Date-header grouping ("Yesterday", full weekday+date once &gt;1 week old); amount as dominant right-aligned element | — | Activity list |
| Monzo | Shared Tabs (249, 250) | Track a named multi-person group payment | Named session + stacked participant avatars + "+2" overflow badge, tappable row | "Friends owe you / You owe friends" debt-ledger framing | Home active-Vink row (participant-avatar treatment only) |
| Monzo | Pot/payment detail (115, 121) | Understand one transaction fully | Amount-first hero, metadata (reference, category) demoted below primary actions, timestamp promoted to nav-bar title | "History with [sender]" relationship rollup — no VinkIn analog, not needed | Vink Details hierarchy |
| Monzo | Payment success (262) | Confirm a payment landed | Plain-language sentence ("You've sent £10.00") + lightweight immediate follow-up, no celebratory/certificate aesthetic | Category-picker follow-up itself (not a VinkIn concept) | Vink Details completed-outcome tone |
| Monzo | Inline submit spinner (261) | Show a mutation is in flight without losing context | Button-level spinner, rest of the confirmation sheet stays static and visible | — | Already matches VinkIn's existing `VinkPrimaryButton.loading` convention — confirms, doesn't change, current practice |
| Monzo | Get-help-from-transaction flow (115, 326, 338, 340, 350, 352) | Get support without losing transaction context | Bottom-of-detail-screen "Something wrong? Get help" as a low-alarm **text link**, not a button; the flagged transaction stays visually pinned through the whole support conversation | The full multi-step article/chat flow — VinkIn's current scope is a single copy-link affordance, not a support flow | Vink Details support affordance (validates the text-link treatment already chosen) |
| Cash App | Pool detail, empty (173) | Show a fresh group-payment session with nothing in it yet | "$0 of $100" progress numeral dominant, thin empty progress bar, centered "No activity yet — be the first to contribute!" | — | Vink Details / Activity empty state |
| Cash App | Pool detail, closed (184) | Show a resolved group-payment session's history | Same screen template as the empty state, now showing a flat chronological list (pool-closed system entry → balance-transfer entry → per-contributor entries) | — | Vink Details timeline — validates using ONE component across a Vink's whole lifecycle rather than a different screen per state |
| Cash App | Activity list (190) | Scan recent activity | "This month" date-bucket header, flat list, tap-for-detail | The "Expired" row's status is plain gray text at the *same* visual weight as a timestamp — easy to miss on a quick scan | Activity list — cautionary example, not to imitate as-is |
| Cash App | Sent/pending confirmation (187) | Confirm a payment was initiated but not yet resolved | — | Headline reads "Sent!" (sounds final) while the actual pending condition is buried in a body sentence ("once they accept") — a real ambiguity risk | Anti-pattern for Vink Details' own pending/in-progress framing — VinkIn must keep "not yet resolved" legible even from the headline alone |
| Cash App | Support entry from transaction list (224) | Get help scoped to a specific transaction | Support screen pre-lists the user's own recent real transactions as tappable rows into scoped help | — | Vink Details support affordance (secondary validation) |
| Revolut | Payments/activity feed (396) | See several concurrently-live payment threads | Description-forward row (not amount-forward), small circular status-icon overlay (check/no-entry/clock) | Status conveyed by icon shape/color *only* in the list — no text label until the user opens detail | Home multiple-active-items — cautionary on status legibility |
| Revolut | Transactions, date-grouped (96, 121, 123) | Scan transaction history with a sense of daily net flow | Date header + per-day running net total; rounded-rect row "chips" | Declined row distinguished only by strikethrough + red icon, no text label in list view | Activity list grouping |
| Revolut | Declined-transaction detail (115) | Understand exactly what went wrong and what to do | Status conveyed redundantly: red "Declined" **text label** + reason line + immediate "Get help" action, on top of the strikethrough amount | — | Vink Details failed/declined-outcome treatment — the strongest a11y-correct example found across all six apps |
| Revolut | Scheduled-transfer paused (400) | Distinguish a recoverable pause from permanent cancellation | Two distinct actions (Reactivate vs. destructive Delete) with different visual weight; three redundant status signals (strikethrough + icon + headline text) | — | Vink Details cancelled-outcome treatment |
| Revolut | Party group settled (497) | Confirm every participant in a group has paid | Green check + "You are settled up" header; each history entry retains its own "Marked as paid ✓" pill after settling | — | Vink Details completed-outcome tone; validates keeping full history visible post-completion |
| Revolut | Party group Details tab (504) | Show every participant's own outcome in one place | Per-participant row = name + verb + colored amount ("Are owed $6.74" green / "Owes $3.36" red) — verb and color are redundant, not color-alone | Debt-ledger verbs themselves ("owes"/"is owed") | Vink Details participant-outcome list — the closest per-participant-row structural precedent found, language must be rewritten |
| Revolut | Blocked-payments empty state (92) | Show an empty sub-list without over-designing it | Minimal single greyed-out row + muted icon + "Add new" at section-header level | Low text contrast (mid-grey on black) on the empty-state row itself | Activity/Vink Details empty sub-sections |
| Wise | Friendship Fund / Main Group (292, 698, 703) | Show a named, multi-person shared balance | Group name + avatar stack + huge centered balance; empty-state illustration + "Nothing to show here yet / Your transactions will show here," with nav tabs staying visible | — | Home active-Vink row and empty state — closest single analog to a Vink's own "named group session with a balance" shape |
| Wise | Personal Home (42, 44) | Show one or several balances/transactions at a glance | Amount as single largest/boldest element per row; stacked balance cards for multiple currencies/items | Multi-currency dual-amount display (no VinkIn analog, single-currency product) | Home active/multiple-active layout |
| Wise | Activity, merchant-branded rows (322, 323) | Recognize a transaction at a glance | Real merchant/brand icon anchoring the row instead of a generic direction arrow | Two-currency amount stack (not applicable) | Activity list row identity — informs using Vink purpose as the anchor text |
| Wise | Transfer status "In progress" section (315) | Separate what's still moving from what's settled | A status-based group header ("In progress") pinned above ordinary date groups | — | Validates VinkIn's own Home/Activity split (active vs. terminal) as an architectural choice, not just a UI grouping trick |
| Wise | Send-via-link, unclaimed (555) | Communicate a time-boxed pending state | "Expires in 5 days" countdown framing instead of a generic "pending" word | — | Vink Details / Home pending-with-deadline framing |
| Wise | Cancelled transfer detail (310) | Explain a cancellation and what happens next | Explicit "Your money will be refunded... usually take 3-5 working days" plain-language expectation-setting | Status word ("Cancelled") has zero color treatment at all — a real legibility gap even by this document's own standard | Vink Details cancelled/returned-outcome copy |
| Wise | Transfer "Updates" timeline (327) | Show a payment's full lifecycle at a glance | Vertical checkmarked step timeline ending in bold "Your transfer's complete"; uniform green (not color-coded per step) — completion signaled by the final bold line, not a unique color | "Rate the app" CTA (not a VinkIn concept) | Vink Details timeline — the strongest single reference in the whole pack for a non-receipt-feeling event log |
| Wise | Transfer "Details" tab (311) | Provide reference-grade facts separate from the narrative | Two-tab split: narrative timeline tab + cold-facts tab (recipient, transaction number, amount, bank details) | Bank-account-detail fields (not applicable) | Optional structural idea for Vink Details (see §6) |
| Wise | Loading skeleton (307) | Show a list is loading, not empty | Gray placeholder bars matching the real row shape, search/filter chrome stays rendered | Placeholder-to-background contrast is low — flagged as its own weak point, not to imitate uncritically | Home/Activity loading state |
| Wise | Get-help-from-transaction (328) | Get support scoped to a specific transfer | Transaction context (amount, direction) stays pinned above a plain "Select an issue" list | — | Vink Details support affordance (third validation of the pattern) |
| Venmo | Home tab feed (28, 44, 72, 76, 80) | — (this is the anti-pattern itself) | — | **Everything**: public feed of other users' payments, heart/comment icons on every row (including the user's own transactions), emoji captions | Reject list — see §2 |
| Venmo | "Who can see this?" sheet (69) | — | — | Per-transaction audience/visibility selector | Reject list — see §2 |
| Venmo | Social notification settings (154, 155) | — | — | "Social" treated as a first-class app-level notification category alongside "Money" | Reject list — see §2 |
| Venmo | Me tab, Pending/Completed sections (120, 121, 122) | Separate in-flight from settled money | Explicit status-based section headers ("Pending" above "Completed", the latter year-grouped) | Icon-only privacy indicator (padlock/globe) with no text label | Validates a Pending-vs-Completed split conceptually (VinkIn implements this as Home-vs-Activity, two screens, not one sectioned list) |
| Venmo | Transfer-initiated confirmation (133, 134) | Communicate an ACH transfer is pending without alarm | Calm centered message, sets expectation ("may result in delays") without a specific countdown | — | Vink Details/pending tone (secondary to Wise's countdown framing) |
| Venmo | Cancel-transaction sheet (65) | Confirm a destructive/reverting action | Plain-language question headline + one clear primary action + a "Back" safe exit | Non-red ("blue") styling on what is functionally a destructive action — VinkIn already uses `VinkColors.danger`/red conventions correctly elsewhere, don't regress to this softer treatment | Cancel-Vink confirmation copy tone only |
| Venmo | Get Help hub (156) | Generic support entry point | Clean single-column list, icon-left, generous row height | Not transaction-contextual (weaker than Monzo/Revolut/Wise's attached versions) | Lower-priority reference; Monzo/Revolut/Wise's transaction-attached pattern is stronger and already chosen |
| Venmo | Search-empty and disputes-empty (137, 158) | Show "nothing here yet" without over-designing it | Pure typographic empty state, no illustration required | — | Activity/Home empty state (validates a lighter-weight option than Wise's illustrated version) |
| Splitwise | Groups list (77) | List several active group sessions | Group thumbnail + name + one-line summary + right-aligned amount pill | "You owe John D. $200.00" — explicit debt-ledger framing; color alone (no icon/shape) carries all status meaning | Home multiple-active-items — cautionary on both framing and a11y |
| Splitwise | Group settled/member list (110) | Show each participant's terminal status | Avatar+name row, "settled up" as a neutral right-aligned label; visually distinguishes a real member (avatar) from a pending invite (envelope icon) | The "settled up" framing is still a balance concept, not a payment-completion concept | Vink Details participant list — the pending-invite-vs-member visual distinction is a genuinely reusable idea |
| Splitwise | Expense detail (135, 137) | Show one expense's full breakdown | Amount/purpose header dominant; payer/split breakdown with connecting tree-lines; comment thread | "You owe $22.50 / Sam L. owes $22.50" — textbook debt-ledger language, the clearest reject-example of this framing in the whole pack | Vink Details participant-outcome row shape (language must be fully rewritten) |
| Splitwise | Deleted-expense audit trail (139) | Show a field-level change history | System-generated log: "Cost changed from $35.00 to $200.00," participant add/remove log | — | Flags a genuine data gap — VinkIn's D42 timeline (`eventType` + `at` only) cannot reproduce field-level diffs; noted in §5, not implementable today |
| Splitwise | Fresh-group empty state (79) | Empty state for a brand-new, participant-free group | Centered explanatory card, one primary + one secondary CTA | — | Home/Vink-creation empty state (secondary reference; VinkIn's own `VinkEmptyState` component already matches this shape) |

---

## 2. Adopt / Adapt / Reject

### Adopt

Patterns that already align with an approved VinkIn contract or an already-shipped convention —
no branding or semantic change needed beyond normal implementation.

- **Amount-first, status-second row hierarchy** on every list and detail screen (Monzo, Wise,
  Revolut, Cash App all converge on this). Matches Phase 4 §10's own "purpose, outcome label...
  date, amount" ordering and Phase 8 §22's "amount hierarchy" line for Activity rows.
- **Date-grouped list sections** for a historical/terminal list (Monzo #114, Revolut #96, Wise
  #322/#323). Matches Phase 4 §10's "newest first" ordering; VinkIn's own D42 data
  (`VinkOutcomeSummary.date`) supports this directly.
- **Button-local loading, not full-screen takeover, for a mutation in flight** (Monzo #261).
  Already VinkIn's own established convention (`VinkPrimaryButton.loading`) — this reference
  confirms it, doesn't change it.
- **Redundant status signaling (icon + color + text label together, never color/icon alone)**
  on detail screens (Revolut #115, #400). Directly reinforces Phase 4's own accessibility
  requirements (§4/§10/§11's "accessible label states X, Y, Z together") and the existing
  `accessibility_test.dart` convention of asserting a label contains the human copy, never a
  raw code or color-only signal.
- **Support affordance as a low-alarm text link at the bottom of the detail screen, scoped to
  that specific record** (Monzo #115, Revolut #115, Wise #328). Already the exact shape I6's
  own build settled on independently (a conditional "Contact support" `VinkTextButton`) —
  three separate reference apps converging on the same pattern is a strong validation, not a
  change.
- **One screen template spanning a session's whole lifecycle (empty → active → resolved)**
  rather than a different screen per state (Cash App #173 → #184). Matches how VinkIn's own
  Vink Details is already built — one screen, data-driven.

### Adapt

Patterns worth using, changed for VinkIn's identity, semantics, or privacy boundaries.

- **Adapt from Monzo's Shared Tabs / Wise's Friendship Fund / Revolut's Party group**
  (named multi-person session + participant avatars + running balance): adopt the *named
  session + avatar-row* visual structure for Home's active-Vink card, but replace every
  "owes/is owed/settled up" debt-ledger word with VinkIn's own payment-completion vocabulary
  ("paid $X" / "hasn't paid yet" / "Vink funded"). VinkIn has no avatar photo upload today
  (see §5) — adapt the avatar-stack idea into an **initials circle** (already buildable from
  `displayName`), not a blocked feature.
- **Adapt Cash App's obvious-single-action Home emphasis**: keep "Start a Vink" as Home's one
  unambiguous primary action, but — unlike Cash App's Money tab, which keeps the balance card
  visually dominant regardless of state — reduce its visual dominance specifically when
  active Vinks exist that need attention, so the "Needs your attention" section (already
  built, Phase 3 §1) isn't competing with a large static action card for the user's first
  glance.
- **Adapt Wise's two-tab (narrative timeline / cold facts) transfer-detail split** as an
  *optional* future refinement of Vink Details, not a requirement — VinkIn's current build
  keeps both in one scroll (timeline + participant facts), which is simpler and still matches
  Phase 4 §11's own "outcome header → amount/participant breakdown → timeline" element order.
  Flagged for owner consideration, not adopted outright (see §7).
- **Adapt Splitwise's member-vs-pending-invite visual distinction** (avatar vs. envelope icon,
  #110): genuinely useful for Vink Details' participant list to distinguish a registered
  member from a still-pending guest invite — but VinkIn's own guest/member distinction already
  exists server-side (`Participant.guestIdentityId`); this is a presentation idea to route
  through existing data, not a new field to invent.
- **Adapt Wise's countdown framing for pending state ("Expires in 5 days")**: directly
  applicable to a Vink's own funding deadline, but must route through VinkIn's own
  `submissionDeadline` field and existing `_timeRemainingLabel`-style copy, never a generic
  "processing" word with no time context.

### Reject

Patterns that contradict VinkIn's approved plan outright.

- **Reject Venmo's public social feed in full**: no feed of other users' payment activity, no
  like/comment icons on any transaction (including the user's own), no per-transaction
  public/private visibility toggle, no "Social" notification category, no emoji-encouraged
  marketing language. This is the single largest and clearest reject-cluster in the whole
  pack — confirmed against the R0 brief's own explicit prohibition ("must not... create a
  social feed").
- **Reject debt-ledger framing wherever it appears** (Splitwise throughout; Monzo's Shared
  Tabs "you owe/friends owe you"; Revolut's Party "owes/is owed"). VinkIn is a
  payment-completion tool, not a peer-debt tracker — no VinkIn surface should ever say one
  participant "owes" another; the only relationship VinkIn models is "has this participant
  paid their assigned share into this Vink yet."
- **Reject banking-dashboard density and adjacent feature modules**: crypto, stocks/investing,
  budgeting, card-design/ordering flows, loan/overdraft marketing, KYC/identity-verification
  screens (Revolut, Wise, Cash App all contain large volumes of this). None of it was
  force-fit into any I6 category and none of it should influence Home/Activity/Vink Details.
- **Reject color-or-icon-alone status signaling in list rows** (Revolut #96's list view,
  Monzo #316, Cash App #190's "Expired," Wise #310's uncolored "Cancelled"). A text label must
  always accompany any status color/icon on a VinkIn row — several reference apps get this
  wrong even in their own detail screens' list-adjacent contexts, and it is a real, documented
  accessibility failure mode, not a style preference.
- **Reject headline framing that can read as "done" when the state is actually pending**
  (Cash App's "Sent!" headline with the true pending condition buried in body text). Any
  VinkIn pending/in-progress state must be unambiguous from its own headline alone.
- **Reject softened/non-red styling on a destructive or reverting action** (Venmo's blue
  "Yes, cancel it"). VinkIn already uses a consistent danger-color convention elsewhere in the
  design system; a cancel-Vink confirmation should not regress to a softer treatment just
  because one reference app happens to.

---

## 3. Per-screen reference boards

Each board lists 3–6 references with the reason for inclusion and what must not be copied. A
reference may appear on more than one board only where it teaches something materially
different each time (marked below where that happens).

### Home — no active Vinks

| Ref | Why included | Must not copy |
|---|---|---|
| Wise, Main Group empty (698) | Shows a named-group screen at zero balance with a text-only "No transactions yet" line — closest to a brand-new, empty Vink's own Home presence | The unrelated card-signup nudge competing for attention on the same screen |
| Monzo, Home softened-empty (108) | Shows how a single system-generated row can make "genuinely nothing yet" feel less bare without inventing fake activity | The referral-bonus mechanic itself (not a VinkIn concept) |
| Venmo, search/disputes empty (137, 158) | Validates a lighter-weight, pure-typographic empty-state option (headline + one line, no illustration) as a legitimate alternative to an illustrated empty state | — |
| Splitwise, fresh-group empty (79) | Centered card + one primary/one secondary CTA — structurally matches VinkIn's own existing `VinkEmptyState` component already in use | The two-CTA content itself ("Add members"/"Share a link" — not what VinkIn's Home empty state offers) |

### Home — one active Vink

| Ref | Why included | Must not copy |
|---|---|---|
| Wise, Friendship Fund (292) | Named group + avatar pair + huge centered balance + single transaction row — closest single-item analog available across the whole pack | Multi-currency balance display |
| Monzo, Home w/ one real row (109, cross-referenced from "multiple," teaches the single-row case) | Icon-left/label-center/amount-right row density at its simplest | The system "Tap to view your PIN" row style (not a VinkIn concept) |
| Cash App, Pool detail w/ one contribution (184) | Shows one active/resolved session's own detail hierarchy, useful for what a tapped single-item Home card should lead to | The literal "Pool" branding/iconography |

### Home — several active Vinks

| Ref | Why included | Must not copy |
|---|---|---|
| Monzo, Home w/ 3 mixed rows (109) | Demonstrates a financial row, a non-financial system row, and a pot-transfer row coexisting cleanly in one list — informs how VinkIn's "needs attention" vs "waiting on others" sections should read when mixed | The system-row content itself |
| Wise, personal Home w/ 2 balance cards (44) | Shows multiple concurrent "sessions" (currency balances, here) each getting their own compact card before the list begins | Multi-currency framing |
| Revolut, Payments feed (396) | Description-forward, multiple-thread list — useful negative/positive comparison against Monzo's amount-forward row for VinkIn to choose between deliberately | Icon-only status with no text label |
| Splitwise, Groups list (77) | Multiple named group sessions each with their own status pill — closest multi-item structural analog to several concurrent Vinks | The debt-ledger amount pill wording |

### Activity list

| Ref | Why included | Must not copy |
|---|---|---|
| Monzo, Activity full list (114) | Cleanest date-grouped, amount-dominant row template in the whole pack | — |
| Wise, merchant-branded rows (322, 323) | Shows a purpose/identity element anchoring the row instead of a generic icon — directly maps to showing a Vink's own purpose text | Two-currency amount stack |
| Revolut, date + daily net total (96) | Per-day running total is a genuinely novel idea worth owner consideration, not yet adopted | Icon-only declined-row treatment (no text label) |
| Venmo, Pending/Completed sections (120) | Validates status-based (not just date-based) grouping as a real, used pattern elsewhere — relevant context even though VinkIn implements this split as two screens (Home/Activity), not one sectioned list | Icon-only privacy indicator |

### Organizer Vink Details

| Ref | Why included | Must not copy |
|---|---|---|
| Revolut, Party Details tab (504) | Closest available per-participant-outcome-row precedent — every participant gets their own row with a redundant verb+color signal | The "owes/is owed" verbs themselves |
| Wise, Updates timeline (327) | Strongest single non-receipt-feeling completion narrative in the pack — directly informs the outcome-statement heading and timeline tone | The "Rate the app" CTA |
| Monzo, transaction detail (115, 121) | Amount-first hero + demoted metadata + bottom-of-screen support link — matches the already-built screen's own layout order | The relationship-history rollup ("payments with this person") |
| Cash App, Pool detail resolved (184) | Shows the SAME screen at empty and resolved states — validates a single data-driven component, which is how Vink Details is already built | The "Pool" terminology |

### Participant Vink Details

| Ref | Why included | Must not copy |
|---|---|---|
| Revolut, Party settled header (497) | "You are settled up" + retained per-entry "Marked as paid" pills — models a calm, plural-viewer-safe completion header appropriate for a screen every participant (not just the organizer) can open | The settlement/debt framing |
| Splitwise, member list w/ invite distinction (110) | The avatar-vs-envelope member/invited-guest visual distinction is directly reusable for showing a mix of registered members and guests in one participant list | "Settled up" as a balance concept |
| Monzo, payment success (262) | Calm, plain-sentence completion tone appropriate regardless of which participant is viewing | The category-picker follow-up |

*(Vink Details' own data and access model are identical for organizer and participant per
Phase 4 §11's own explicit widening — the two boards above differ only in which reference
detail is emphasized, not in what the screen shows.)*

### Pending or recovery state

| Ref | Why included | Must not copy |
|---|---|---|
| Wise, unclaimed send-via-link (555) | "Expires in 5 days" countdown framing — directly maps onto a Vink's own funding deadline | — |
| Revolut, scheduled-transfer paused (400) | Three redundant signals (strikethrough + icon + headline text) for a recoverable-but-stalled state — the accessibility bar to match | — |
| Venmo, transfer-initiated (133, 134) | Calm, non-alarming pending message with realistic expectation-setting, secondary tone reference to Wise's countdown | The lack of any specific timeframe (Wise's version is stronger) |
| Cash App, sent-confirmation (187) | **Cautionary inclusion**: shows exactly the failure mode to avoid — a headline that reads as final while the real pending condition is buried in body copy | The headline/body split itself |

### Returned, cancelled, or completed outcome

| Ref | Why included | Must not copy |
|---|---|---|
| Wise, cancelled-transfer detail (310) | Best available refund/return language ("Your money will be refunded... 3-5 working days") for a cancelled-with-refund outcome | The uncolored status word (flagged as its own a11y gap) |
| Revolut, declined-transaction detail (115) | The strongest a11y-correct example in the whole pack (redundant icon+color+text) for a failed/declined outcome | — |
| Wise, transfer-complete timeline (327) | Best plain-language, non-celebratory "complete" narrative | — |
| Cash App, pool closed (184) | Quiet, system-log-style completion entry with no celebratory treatment — reinforces D31's own "never like a receipt" discipline | — |

---

## 4. VinkIn-specific recommendations

### Home

- **Hierarchy between active Vinks and "Start a Vink":** adopt Cash App's single-obvious-action
  principle for the button itself, but adapt its visual weight — when the "Needs your
  attention" section (already built) has entries, the button should read as available, not
  dominant; VinkIn should not compete a large static action card against genuinely urgent
  content the way Cash App's Money tab does.
- **Organizer vs. participant role indication:** no reference app models an organizer/
  participant role distinction directly (none of the six apps have this concept) — this
  remains VinkIn-original design, informed only by the general principle (Monzo, Wise) that a
  named-session's context (who's in it) belongs on the card, not buried in detail.
- **Compact contribution progress:** out of scope for this pass — Phase 10 §I6's own
  "Work explicitly excluded" clause reserves the compact Ink vessel for I7; no Mobbin
  reference should be used to invent one now.
- **Visible next action per row:** adopt Wise's amount-as-dominant-element + Monzo's
  icon-left/label-center/amount-right row shape; the row's own secondary action (already built
  as a `VinkSecondaryButton` label like "View & share"/"Pay now") matches how every reference
  app treats a row's own single next-step affordance.
- **Metadata allowed on the row vs. deferred to Vink Details:** adopt the universal pattern —
  purpose/title, status word, amount, and (already built) participant count belong on the row;
  everything else (individual participant outcomes, timeline, settlement detail) is
  universally deferred to the detail screen across every reference app inspected.
- **No-active-Vinks treatment:** adopt the existing `VinkEmptyState` component's shape
  (headline + message + primary CTA) — already matches the cross-app convention; no change
  recommended.

### Activity

- **Row anatomy:** adopt purpose/title + outcome label + date + amount, matching Phase 4 §10's
  own specification exactly and matching Monzo/Wise's row shape.
- **Grouping or chronology:** adopt newest-first date ordering (already how `VinkOutcomeSummary`
  is built and tested). Status-based grouping (Venmo, Wise "In progress" section) is not
  needed *within* Activity because VinkIn already achieves that split architecturally — active
  Vinks live on Home, only terminal Vinks reach Activity at all (D42's own scope).
- **Amount and outcome hierarchy:** adopt amount-forward, outcome-word-secondary — matches
  every reference app's own row-level hierarchy.
- **Organizer/participant context:** no change recommended — I2D/D42 already resolved this
  (the list itself is role-blind at the row level; only the underlying data fetch branches by
  role, invisibly to the user).
- **Partial-failure resilience:** no reference app modeled a genuine "some list items failed to
  load" state distinctly from a normal status difference — flagged as a real gap across the
  whole pack (see §6), not something this pass can resolve with a borrowed pattern.
- **Terminal-state copy placement:** adopt the outcome label living directly on the row
  (already built via `outcomeLabelCopy`), with the fuller outcome *statement* reserved for
  Vink Details — matches the universal list-vs-detail split found everywhere.
- **Safe use of D42 activity data:** every reference pattern recommended above is achievable
  from data D42/I2A already project (vinkId, purpose/category, outcome label, date, amount) —
  no recommendation in this section requires data VinkIn doesn't have.

### Vink Details

- **Top-level amount and purpose hierarchy:** adopt the universal amount-first pattern
  (Revolut, Wise, Monzo, Cash App all converge) — matches the already-built screen's own
  `_title`/`_outcomeStatement` ordering exactly.
- **Role presentation:** adopt Phase 4 §11's own already-approved widening (full detail for
  organizer and participant alike) — no reference app has an organizer/participant concept to
  compare against directly; Revolut's Party Details tab is the closest structural analog for
  showing *everyone's* outcome on one screen, which is what the widening already does.
- **Outcome presentation:** adopt Wise's checkmarked-timeline tone and Monzo's plain-sentence
  completion copy — both already match D31/D34's existing "never a receipt, never a raw state
  name" discipline; this pass found no reference that contradicts that discipline, only ones
  that reinforce it.
- **Participant-safe information:** no change — the reference apps' own participant rows
  (Revolut #504, Splitwise #110) confirm that name + amount + status is the natural row shape
  once the language is rewritten out of debt-ledger framing; VinkIn's existing
  `contributionOutcomeLabel` vocabulary already covers this.
- **Timestamps:** adopt showing a plain date/relative-time per timeline entry (every reference
  app does this); no reference app's timestamp treatment suggested anything beyond what's
  already built.
- **Contribution details:** adopt amount-per-participant as already built; do **not** adopt
  Splitwise's field-level change log (see §5 — not achievable with current data) or Wise's
  dual-currency display (not applicable, single-currency product).
- **Support or recovery affordance:** adopt the low-alarm text-link pattern, already built and
  now independently validated by three reference apps (Monzo, Revolut, Wise) converging on the
  same shape.
- **Progressive disclosure:** adopt the universal one-scroll-screen approach already built;
  Wise's two-tab split (§2, Adapt) is flagged as an optional future refinement, not a gap in
  the current build.

---

## 5. Current-data compatibility review

Every recommendation in §4 was checked against what I2/I5/D39/D41/D42's own projections
actually carry, per the R0 brief's own instruction not to invent fields. Genuine gaps found:

1. **Participant avatars/photos.** No reference recommendation requires a real photo — VinkIn
   has no avatar-upload feature and none is proposed here. Where avatar-stack visuals were
   borrowed (Wise, Monzo, Revolut), the adaptation is an **initials circle** derived from
   `displayName`, already available data, not a new field.
2. **Merchant brand icon/logo.** Wise's merchant-branded row icon (§1, #322/#323) has no VinkIn
   equivalent — `merchantSettlementDetail` is a plain string (`merchantName`), no logo/icon
   asset exists or is proposed. Flagged as unavailable, not silently substituted with a generic
   icon claiming to be brand-specific.
3. **Field-level change history.** Splitwise's audit-log pattern (#139, "Cost changed from
   $35.00 to $200.00") cannot be reproduced — VinkIn's D42 timeline carries only
   `{eventType, at}` per milestone, never a before/after diff of any field. This is a genuine,
   disclosed gap, not implementable from current data; flagged for the owner, not silently
   worked around.
4. **Multi-currency display.** Wise's dual-currency amount stack has no VinkIn analog — the
   product is single-currency (USD, mock-provider scope) end to end; not a gap, simply not
   applicable.
5. **Granular in-flight sub-status.** Wise's timeline shows finer-grained sub-steps
   (Sending → Received → Paid out) than a single named domain event — VinkIn's own timeline
   granularity (one row per named domain event: `VinkOpened`, `VinkFunded`, `VinkCompleted`,
   etc.) is coarser by design (D12's own "every transition emits its named event" rule) and is
   not a gap, just a different, already-decided level of detail.

No recommendation in §4 depends on any of the five items above being resolved first — every
Home/Activity/Vink Details recommendation is buildable from data already returned by
`listMyVinksWithRole`, `getActivity`/`getParticipantActivity`, and `getVinkDetails`.

---

## 6. Contradictions or unresolved questions

Reported explicitly, per the R0 brief's own instruction, rather than resolved unilaterally:

1. **Per-day running net total on Activity (Revolut #96).** A genuinely novel idea not present
   in any current VinkIn contract — showing "+$18" next to a date header alongside individual
   rows. Interesting, but it's a new information element Phase 4 §10 doesn't currently specify.
   **Flagged for owner consideration, not adopted.**
2. **Wise's two-tab Vink Details split (narrative vs. facts, §2 Adapt).** The already-built
   single-scroll screen satisfies Phase 4 §11's element ordering as written; the two-tab
   alternative is a genuine, defensible different interpretation of the same contract.
   **Flagged as an option for a future refinement, not a defect in the current build.**
3. **Status-based grouping *within* a single list (Venmo's Pending/Completed sections, Wise's
   "In progress" header) vs. VinkIn's architectural Home/Activity split.** These solve the same
   underlying problem two different ways. This pass concludes VinkIn's existing two-screen
   split (already decided, D42-scoped) is at least as good and doesn't need to import the
   single-list-with-sections pattern — but this is a judgment call, not a proof, and is
   recorded here as reasoning rather than asserted as fact.
4. **Partial-failure list resilience** (§4, Activity) has no reference precedent anywhere in
   the six-app pack. This remains a genuinely open implementation question for I6 (how the
   Activity list should behave if one Vink's outcome data fails to load while others succeed)
   that Mobbin simply cannot answer — flagged for engineering judgment at implementation time,
   not a design question.

No reference in this pass revealed a contradiction serious enough to imply an existing D19–D42
decision is wrong. Every tension found (framing/language differences, missing data, optional
structural alternatives) is listed above as something to be aware of, not something requiring
a decision-log change.

---

## 7. I6 implementation guardrails

Restating the R0 brief's own boundaries, made concrete for whoever implements I6 next:

- This document does not reopen D19–D42. Where a reference conflicts with an existing decision
  (debt-ledger framing vs. VinkIn's payment-completion model; social-feed patterns vs. VinkIn's
  privacy boundaries; "receipt"-adjacent language vs. D31), the existing decision wins and the
  reference is filed under Reject, not treated as a reason to revisit anything.
- No recommendation above adds a product feature (no fees, no percentage splitting, no social
  feed, no contacts sync, no budgeting/investing/rewards module) — every Adopt/Adapt item is a
  presentation-layer pattern applied to data and screens I6 already has approved contracts for.
- No recommendation above replaces or anticipates the Ink Progress System (I7's own scope) or
  decides any provider-specific payment behavior (M0's own scope) — both were deliberately kept
  out of every board and recommendation in this document.
- VinkIn's cream/cobalt/ink identity, white surfaces, restrained shadows, and typography are
  unchanged by anything in this document — every "adopt/adapt" item above is a layout, density,
  hierarchy, or copy-tone pattern, never a color, card style, or shadow recommendation borrowed
  from a reference app's own visual system.
- "Everyone In. One Purchase." remains VinkIn's external brand promise — this document does not
  place it as a persistent interface heading on Home, Activity, or Vink Details; the existing
  built screens' own headings (greeting text on Home, no heading on Activity's list, the
  outcome statement on Vink Details) are correctly scoped to current context and next action,
  not brand messaging, and nothing here suggests changing that.
