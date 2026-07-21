# Phase 6 — Product Copy and State Language

_UI/UX Engineering Plan, Phase 6 output: the canonical language system for VinkIn across
organizer/member mobile, automatic invitation delivery, and Guest Web. Source of truth:
`docs/design/phase-0-product-behavior.md` through `docs/design/phase-5-button-interaction-contracts.md`,
`docs/spec/decision-log.md` (D1–D35), `docs/spec/open-questions.md`, and verified domain/
application source._

**Status:** DRAFT. **Documentation only — no Flutter, Next.js, backend, API, authentication,
invitation delivery, database, or infrastructure code was modified.** This phase writes
words, not behavior — no product semantics changed while writing it; every copy decision maps
onto a state, action, or outcome already established in Phases 0–5.

**Explicitly not invented anywhere in this document:** fees, percentage splitting, provider
capabilities, wallet availability, merchant receipts, legal agreements, return timelines,
support response times, guarantees about notification delivery, or any new financial state.

---

## 1. Voice and tone guide

VinkIn speaks like a **direct, calm, financially precise friend who happens to be organizing
the money**, not a fintech app, a bank, or a party host. Every line in this document is
checked against seven traits and seven anti-patterns:

**Is:** direct · human · calm · brief · helpful · socially aware · financially precise.

**Is not:** fintech jargon · backend terminology · legal-sounding language where not
required · childish celebration · artificial urgency · blame · ambiguous money outcomes ·
repeated explanation · marketing copy inside an active financial task.

**How this resolves in practice:**
- Say what happened to the money in the same breath as the state, never as a separate lookup
  the customer has to make.
- One sentence beats two. A heading plus one supporting line beats a heading, a subheading,
  and a paragraph.
- Never blame a participant for being slow ("Maya hasn't paid yet" — no; "Waiting for Maya" —
  yes: describes the state, not the person).
- Never manufacture urgency the underlying deadline doesn't already create. The countdown
  itself is the urgency; copy doesn't add exclamation points on top of it.
- Celebration is proportionate: a completed group payment earns a calm, warm confirmation,
  not confetti-language. "Everyone's in" is already the celebration.
- Money-outcome language is never soft where the answer is a hard fact. "Nothing was
  charged" is a fact stated plainly, not hedged into "don't worry about it."

---

## 2. Canonical product glossary

| Term | Meaning | Customer-facing? |
|---|---|---|
| Vink | The named group-payment session itself — always capitalized, used like a proper noun ("this Vink," "your Vink," "Dinner Vink"). | Yes — the core brand vocabulary. |
| VinkIn | The product/company name. | Yes. |
| Group payment | Used sparingly, to *explain* what a Vink is to someone new (Welcome, guest first-touch) — not used once someone is already inside one, where "this Vink" carries the meaning. | Yes, first-touch only. |
| Your part | The individual's own share of a Vink's total — the canonical replacement for "allocated amount"/"contribution amount." | Yes — always. |
| Group total | The whole amount a Vink needs — replaces "required amount." | Yes — always. |
| Organizer | The role. Used as a description word (Profile, help copy, generic reference), never as a substitute for a real name when a name is known — "Maya started this Vink," not "The organizer started this Vink," once Maya's name is available. | Yes, as a role word only. |
| Participant / person / people | Neutral, plain-English reference to someone in a Vink — acceptable, not jargon. A real name is preferred whenever known. | Yes. |
| Guest | Someone in a Vink without a VinkIn account. Already correctly understood by users today (Phase 0 §2) — kept as-is. | Yes. |
| Member | A participant with a VinkIn account — mostly an internal/organizer-side distinction; customers don't need to be told which category they are, so this word rarely appears in direct address. | Rarely — mostly internal. |

**Do not use anywhere in customer-facing copy:** pool · contribution record · funding object ·
payment intent · participant state · guest token · merchant authorization · ledger ·
provisioning. (Each is a real internal/domain term — `packages/domain`'s own vocabulary for
its own purposes — that must never leak into a screen, message, or notification.)

---

## 3. Approved and prohibited terminology table

| Situation | Approved | Prohibited | Why |
|---|---|---|---|
| Card being issued | "Getting your card ready" | provisioning, issuing, card-provisioning | Backend process name (`CARD_PROVISIONING`) |
| Merchant swipe approved | (no customer copy needed — organizer isn't shown this internal moment; see §10) | authorization, merchant authorization | Domain term (`MerchantAuthorizationApproved`) |
| Funds moving between accounts | "your part," "the group total," "paid" | ledger, posting, entry | `packages/ledger` internals |
| Contribution reaching a confirmed state | "is in," "paid," "confirmed" (context-dependent, §7/§9) | authorized, captured | Domain state names |
| A hold being released without a charge | "you weren't charged" (individual, D34) / "no one was charged" (group-level only) | reversed, cancelled (as a verb applied to money), "nothing was taken" | Domain term; "cancelled" is reserved for the Vink-level outcome, not a money verb; "nothing was taken" was an earlier guest-specific variant, removed by D34 |
| Money coming back | "returned," "being returned" | refunded, refund | Explicit instruction: never say "refunded" in customer copy |
| Settlement matching the funded amount | "payment complete" | settled | "Settled" reserved only if a specific regulated meaning is later required and approved — not the case today |
| Overage recovery | "resolving a payment detail," organizer-specific | recovered, recovery | Domain term (`RECOVERY_REQUIRED`) |
| Pooled progress total | "$X of $Y ready" | funded, funding | Explicit instruction: never say "funded" for incremental progress |
| Guest access credential | (never named to the customer — it's just "your link") | guest token | Domain term (`vgt_` token) |
| Deadline mechanics | "closes in," "closes at" | processing grace, authorization window, payment lock, deadline sweep | Internal job/window names |

---

## 4. Naming and capitalization rules

- **Vink** is always capitalized, mid-sentence or not — treated as a proper noun ("Open a
  Vink," "This Vink is complete"), matching the product's own existing convention.
- **VinkIn** is always the two-capital brand spelling, never "Vinkin" or "VINKIN" in body
  copy (all-caps is a visual/logo treatment, not a copy rule).
- Headings and button labels are written in **sentence case** ("Open Vink," "You're in,"
  "Everyone's in") — capitalize only the first word and proper nouns (Vink, VinkIn, a
  person's name), never Title Case. The existing visual system renders button
  labels in uppercase as a *typographic* treatment (`vink_typography.dart`'s `buttonLabel`
  style) — that's Phase 8's visual concern; the copy itself is authored in sentence case
  regardless of how it's rendered.
- Dollar amounts always use the shared currency formatter (Phase 0 §12) — `$24.50`, never
  `24.50 USD` or `$24.5`.
- Names are used exactly as the person entered their display name — no truncation, no
  possessive-apostrophe edge cases silently mishandled (see §25 for truncation rules).

---

## 5. Heading and supporting-copy patterns

- **Heading** states the one fact that matters most on this screen, in as few words as
  possible — usually the dominant object from that screen's Phase 4 contract (an amount, a
  status, an outcome).
- **Supporting copy** (one line, sometimes zero) adds exactly one piece of context the
  heading didn't already carry — never restates the heading in different words.
- A screen either has a heading + optional one-line support, or it doesn't need copy at all
  (e.g. a pure list). No screen gets a heading, a subheading, *and* a paragraph.
- Pattern: **[Heading — the fact] / [Supporting — the one relevant detail]**. Example:
  "Your part — $24.50" / "Group total $98.00 · Closes in 12 minutes."

---

## 6. Button-label system

Verb + object, or verb + amount — never a vague label where a specific one is possible:

| Prefer | Avoid | Why |
|---|---|---|
| Start a Vink | Continue | Names the actual next action |
| Add person | Submit | Names the object |
| Open Vink | Confirm | "Confirm" alone has no object |
| Pay $24.50 | Proceed | Amount-bearing actions always show the amount |
| Share another way | Okay | Names the actual action |
| Send again | Done (where a clearer destination exists) | "Done" is fine only where nothing more specific applies (e.g. dismissing a truly terminal, actionless screen) |
| View Vink details | — | — |
| Sign in | — | — |
| Try again | — | — |

"Pay now" is the one approved exception to "always show the amount" — it's the transition
*into* the focused payment surface (D32), not the amount-confirming action itself (that's
"Pay $X" inside the Lobby's own contribution flow, C23/C24, or whatever the eventual
payment-surface's own action turns out to be — **not specified here, pending the M0 provider
gate**, per D32).

---

## 7. Participant-status copy system

Two registers for the same underlying states — a compact **row/badge word** and a
**narrative sentence** used in transitions/banners. They must never contradict each other for
the same state.

| State (Phase 5 §7 vocabulary) | Row/badge word | Narrative sentence | Notes |
|---|---|---|---|
| Just added (Create flow) | "Added" | — (no sentence form; adding someone is not an "in" moment, §8) | Never "is in" here (Phase 1 §C.5 fix) |
| Automatic delivery sending | "Sending…" | — | System-status only |
| Delivery sent | "Sent" | — | Delivery status, not payment status — never "is in" |
| Delivery failed | "Couldn't send" | — | Pairs with the "Share another way" action (Phase 5 C17) |
| Not yet contributed | "Waiting" | — | Neutral, not "hasn't paid" (no blame) |
| Contribution processing | "Processing" | — | Between tap and server confirmation |
| Contribution confirmed | "Paid" | "**{Name} is in**" | Only state where "is in" applies (§8) |
| Contribution declined | "Needs another try" | — | Never "failed" (too final-sounding for a retryable state) |
| Removed | (row disappears) | — | No lingering "removed" label |

---

## 8. Meaning of "in"

**"In" means the participant's required contribution is confirmed. Nothing else.**

Approved: "You're in" (the viewer's own confirmation) · "Maya is in" (someone else's,
narrative sentence only, never the row/badge word) · "Everyone's in" (the whole Vink,
100% confirmed).

**Prohibited, explicitly, in every context:**
- Immediately after a participant is added (Phase 1 §C.5's exact bug — the fix this rule
  exists for).
- After an invitation is merely sent — "Sent" is a delivery fact, not a money fact.
- While a contribution is processing — "Processing" is the correct word until the server
  confirms.
- When the contribution requires recovery — a guest/member whose money is fully settled but
  whose Vink is in `RECOVERY_REQUIRED`/`RECOVERY_PENDING` is *already* "in" from their own
  confirmation moment; recovery doesn't retroactively make that untrue, but the **transition
  into** a recovery state never *newly announces* "is in" as if something just happened — the
  correct copy there is calm continuity (§16), not a fresh "in" announcement.

---

## 9. Invitation-delivery vocabulary and templates

**Vocabulary** (system-status words used on the organizer side, Phase 5 C16–C18):
"Sending…" → "Sent" or "Couldn't send." "Send again" (never "Resend" — same meaning, but
"Send again" reads less like an admission something broke). Never "Delivery failed" as
customer-facing copy (too alarming for what's usually a routine bounce) — "Couldn't send" is
the calm equivalent.

**Templates.** All variables: `{organizerName}`, `{purpose}`, `{yourShare}`, `{deadline}`,
`{link}`. Every template: (a) identifies VinkIn, (b) makes the sender recognizable by name,
(c) states no account is needed (guest only), (d) never implies payment has already happened,
(e) never mentions a fee, (f) never promises delivery succeeded ("we sent" not "you'll
receive"), (g) shows only the recipient's own share, never the group's full participant list
or other people's amounts.

**SMS to guest:**
> VinkIn: {organizerName} added you to a group payment for {purpose} — your part is
> {yourShare}. No account needed. {link}

**Email to guest** — Subject: `{organizerName} added you to a Vink for {purpose}`
> {organizerName} started a group payment for {purpose} on VinkIn.
>
> Your part: {yourShare}
>
> You don't need an account — just open the link to see the details and pay your part.
>
> [View and pay your part] → {link}
>
> This link is just for you. It closes {deadline}.

**SMS to existing member:**
> VinkIn: {organizerName} added you to {purpose} — your part is {yourShare}. Open the VinkIn
> app to see it.

**Email to existing member** — Subject: `{organizerName} added you to a Vink for {purpose}`
> {organizerName} started a group payment for {purpose} on VinkIn.
>
> Your part: {yourShare}
>
> Open the VinkIn app to see the details and pay your part. It closes {deadline}.

**Resend:** identical content to the original send — no "reminder" framing, no added urgency,
no implication the recipient did anything wrong by not having acted yet.

**Delivery failure (organizer-facing UI, not sent to the recipient):** row status "Couldn't
send" + compact action "Share another way" (Phase 5 C17).

**Invalid contact information (organizer-facing, at entry time):** "That doesn't look like a
valid phone number" / "That doesn't look like a valid email" — field-level, inline, specific
to which format failed.

**Manual sharing (prefilled text for Copy Link / System Share):**
> {organizerName} added you to a group payment for {purpose} — your part is {yourShare}.
> {link}

**External dependencies, not written here:** carrier-specific SMS compliance language,
consent/opt-out language, or any regulatory disclosure — these require actual approved legal
requirements this document has no authority to invent (ties to D28's deferred-legal
boundary and G2's still-open MTL question). Marked as a **provider/legal-dependent** item in
§27.

---

## 10. Contribution-status vocabulary

| Underlying state | Customer word (compact) | Customer sentence (where used) |
|---|---|---|
| `not_started` | "Waiting" | "Your part is {amount}." |
| `AUTHORIZATION_PENDING`/`RESOLUTION_PENDING` | "Processing" | "We're confirming your payment." |
| `DECLINED` | "Needs another try" | "That didn't go through. Nothing was charged." |
| `AUTHORIZED`/`CAPTURE_PENDING`/`CAPTURED`/`SETTLED` (confirmed) | "Paid" | "You're in." |
| `CANCELLATION_PENDING`/`CANCELLED` | "Not charged" | "Nothing was charged." |
| `REFUND_PENDING`/`REFUND_FAILED` (guest: `return_pending`) | "Being returned" | "Your payment is being returned." |
| `REFUNDED` (guest: `returned`) | "Returned" | "Your payment was returned." |

---

## 11. Vink lifecycle vocabulary (customer-facing, all 16 canonical states)

Extends and refines the existing badge table (`vink_status_badge.dart`/`StatusBadge.tsx`,
Phase 1) — same 16 states, some labels refined for this phase's stricter no-jargon rules.
Tone column marks the **target** tone (a correction from Phase 1 §C.9/§E.6 is folded in here
directly: `EXPIRED` moves off the alarming "attention" tone).

| State | Label | Tone | One-line customer explanation |
|---|---|---|---|
| `DRAFT` | "Draft" (organizer-only — never guest-visible, D23) | neutral | "Still being set up." |
| `OPEN` | "Waiting for everyone" | neutral | "Waiting on a few people to pay their part." |
| `SUBMISSIONS_CLOSED` | "Wrapping up" | active | "Everyone's had their turn — finishing up." |
| `PROCESSING_GRACE` | "Confirming payments" | active | "Double-checking everyone's payment went through." |
| `FUNDED` | "Everyone's in" | positive | "Everyone's part is confirmed." |
| `CARD_PROVISIONING` | "Getting your card ready" | active | (organizer-only) |
| `CARD_READY` | "Ready to pay" | positive | "Time to pay the merchant." |
| `PURCHASE_AUTHORIZED` | "Paying now" | active | (organizer-only, brief) |
| `SETTLING` | "Finishing up" | active | (organizer-only, brief) |
| `COMPLETED` | "Payment complete" | positive | "The merchant was paid. This Vink is done." |
| `FUNDING_REVERSAL` | "Returning your payment" | **neutral (was attention)** | "We couldn't finish setting up the card. Any payment made is being returned." |
| `RECOVERY_REQUIRED` / `RECOVERY_PENDING` | "Resolving a payment detail" | attention **(organizer-only — never shown to participants/guests as their own concern, §16)** | Organizer: **"We're resolving your payment. You don't need to pay again."** (canonical, D34). Participant/guest: not surfaced as a distinct state at all (their own status is already "Paid," §8's continuity rule). |
| `CANCELLED` | "Cancelled" | neutral | "The organizer cancelled. No one was charged." |
| `RESTRICTED` | "Needs your attention" | attention (organizer-only) | "We need you to resolve a payment issue before starting a new Vink." (never exposed to participants/guests) |
| `EXPIRED` | "Expired" | **neutral (corrected — was attention)** | "This Vink closed before everyone joined in. [money-outcome line per §16]" |

---

## 12. Progress and countdown language

**Exact patterns** (vessel headline + waiting clause, never more than these two lines at
once — never simultaneously showing amount, percentage, count, *and* a repetitive sentence):

| Confirmed | Headline | Waiting clause |
|---|---|---|
| $0 of $80 | "$0 of $80 ready" | "Waiting for everyone" (no names yet — matches the `OPEN` state label, avoids listing everyone by name at 0%) |
| $40 of $80, one person left | "$40 of $80 ready" | "Waiting for Maya" |
| $40 of $80, two people left | "$40 of $80 ready" | "Waiting for Maya and Jordan" |
| $40 of $80, three+ people left | "$40 of $80 ready" | "Waiting for 3 people" (count only — switches from names to a count at three or more, refining Phase 4 §0's rougher "and N others" approximation) |
| $80 of $80 | "$80 of $80 ready" | "Everyone's ready" (transitions into "Everyone's in," §8, as the vessel completes) |

The organizer's own unpaid share uses the exact same waiting-clause name logic — **no special
exemption**: if the organizer hasn't paid, their own name appears in the waiting clause like
anyone else's ("Waiting for Alvin" is correct even when Alvin is the organizer viewing their
own Lobby) — this reinforces D19/Phase 2 §3's "organizer is a normal participant" principle
in copy, not just in payment mechanics.

**Percentage and count are never separately spoken** — the amount pair ("$X of $Y") already
implies both; a redundant "50%" or "2 of 4 people" line is not added alongside it.

**Screen-reader announcement pattern** (restated precisely from Phase 4 §0/Phase 5 §16,
canonical wording fixed here): *"$X of $Y ready. Waiting for {clause}."* or, at completion,
*"Everyone's ready."* — announced only on a meaningful change (a new confirmation lands),
**never on a countdown tick**, never per animation frame.

---

## 13. Countdown language

| Situation | Display |
|---|---|
| More than 1 minute remaining | "Closes in {N} minutes" (rounded down to the minute — no ticking seconds narrated to screen readers; a visual mm:ss timer may still tick for sighted users, that's a Phase 8/9 visual concern, not a copy or announcement one) |
| Under 1 minute | "Closes in under a minute" |
| At the moment of closing (client-optimistic, server not yet confirmed) | "Finishing up" (reuses `PROCESSING_GRACE`'s existing calm label — never a stuck "0:00," never a premature guess at the outcome) |
| After server confirms | Replaced entirely by the real outcome (`OPEN`'s countdown never coexists with a terminal state's copy) |

**Never:** "processing grace," "authorization window," "payment lock," "deadline sweep" — all
explicitly prohibited internal terms. The countdown always answers **"can I still act?"** in
plain terms — "Closes in 4 minutes" tells the reader they can still pay; the absence of a
countdown (replaced by a terminal state) tells them they can't, without needing to infer it.

---

## 14. Loading and preparation language

| Context | Copy |
|---|---|
| First paint, cached data | (no loading copy shown at all — cached content renders instantly, Phase 4/5's cached-first-paint principle) |
| Genuine first fetch (no cache yet) | "Loading your Vink…" |
| Card being prepared | "Getting your card ready" (already correct, kept) |
| Contribution processing | "Confirming your payment…" |
| Guest "not open yet" | not a loading state at all — a defined static state (§17 of Phase 5), copy: "This Vink isn't open yet." |

---

## 15. Success language / success-message matrix

| Event | Copy | Notes |
|---|---|---|
| Vink opened | (no separate success screen — transitions straight to the Lobby, Phase 5 C15) | The Lobby's own "Waiting for everyone" state *is* the success confirmation |
| Own contribution confirmed | "You're in." | §8 |
| Everyone confirmed | "Everyone's in." | Brief transition, not a screen (Phase 5 C29) |
| Payment complete | "Payment complete. {organizerName if guest} paid {merchant-agnostic: "the merchant"} $X." — see §22 for exact per-audience wording | One confirmation only — never doubled with a push notification saying the same thing in different words at the same moment |
| Guest joined | (no separate "You joined!" banner — the Session View's own content, showing their part and the group's progress, is the confirmation) | Avoids a redundant celebratory interstitial |

**Never two success confirmations for the same event** (Phase 5's locked rule, restated) —
e.g. a Lobby banner *and* a push notification *and* a badge color change all narrating
"Everyone's in" simultaneously is exactly the pattern this rule forbids.

---

## 16. Failure and retry language / error-language mapping

For every row: Customer heading — Customer explanation — Money-outcome statement — Primary
action — Secondary action — Retry allowed? — Support availability — Internal terms banned.

| Internal condition | Customer heading | Explanation | Money outcome | Primary action | Secondary | Retry? | Support? | Banned internal terms |
|---|---|---|---|---|---|---|---|---|
| Invalid credentials | "That didn't match" | "Check your username and password." | n/a | "Try again" | — | Yes, unlimited | No | invalid credentials, 401 |
| Expired session | (handled by D26's reauth sheet, not a standalone error screen) | "Sign in again to continue." | n/a (context preserved) | "Sign in" | "Cancel" | Yes | No | token expired, refresh token, 401 |
| Invalid invite | "This link doesn't work" | "Double-check the link, or ask for a new one." | n/a | — | "Contact support" | No | Yes | invalid token, guest token |
| Vink not open (pre-`VINK_OPENED`, D23) | "Not open yet" | "Check back soon." | n/a | — | — | No — self-resolves | No | DRAFT |
| Vink expired | "Expired" | "This Vink closed before everyone joined in." | Per §23's exact phrase, based on the viewer's own status | — | "Contact support" (if own status unclear) | No | Conditional | EXPIRED, funding failed |
| Vink cancelled | "Cancelled" | "The organizer cancelled this Vink." | "Nothing was charged." / "No one was charged." | — | "Contact support" (if own status unclear) | No | Conditional | CANCELLED, ORGANIZER_CANCELLED |
| Duplicate contribution (double-tap caught server-side) | (no error shown — resolves to the same success the first tap would have) | — | Payment confirmed (once) | — | — | n/a | No | idempotency key, duplicate request |
| Contribution already confirmed (stale UI re-offers the action) | (no error — screen self-heals to the confirmed state, §8/D25) | — | "You're in." | — | — | n/a | No | AUTHORIZED, already captured |
| Contribution processing | "Confirming your payment" | "This usually takes a moment." | Not yet determined — shown as processing, not as a money-outcome claim | — | — | n/a (not failed) | No | AUTHORIZATION_PENDING |
| Payment method rejected | "That didn't go through" | "Your payment method was declined." | "Nothing was charged." | "Try again" | "Contact support" | Yes — a **new** attempt | Conditional | DECLINED, authorization declined |
| Contribution not accepted (window closed) | "Too late to pay your part" | "This Vink stopped accepting payments." | "Nothing was charged." | — | "Contact support" | No | Conditional | SUBMISSIONS_CLOSED, deadline reached |
| Invitation delivery failed | "Couldn't send" | (organizer-facing only, §9) | n/a | "Share another way" | — | Yes | No | delivery failure, SMS/email provider error |
| Realtime disconnected | (silent — no error shown for a brief drop, Phase 4/5's reconnect contract) | — | n/a | — | — | n/a (auto) | No | WebSocket disconnected |
| Preparation delayed | "Still getting your card ready" (shown only if genuinely slow, not routine) | "This is taking a little longer than usual." | n/a | — | "Contact support" (if very delayed) | No manual retry (§ Phase 5 locked rule) | Conditional | card provisioning, provider timeout |
| Merchant payment failed | (routes to the recovery or reversal contract, never a standalone "payment failed" screen) | — | Per state (§16 below) | — | — | — | — | authorization declined, capture failed |
| Return pending | "Your payment is being returned" | "This usually takes a few days." | "Being returned." | — | "Contact support" (if it's taking a while) | No | Conditional | REFUND_PENDING |
| Return completed | "Your payment was returned" | — | "Returned." | — | — | No | No | REFUNDED, RefundCompleted |
| Recovery required | (organizer-only, §11; never shown as a participant/guest error) | "We're resolving your payment. You don't need to pay again." | Organizer's own card may be charged; **never the group's** | — | "Contact support" | No manual retry (automatic ladder) | Yes | RECOVERY_REQUIRED, recovery obligation |
| Unknown server error | "Something went wrong" | "Nothing was changed — try again." | Explicitly reassures only when true: **this generic message is only shown for errors caught before any state change**, never papering over an unclear outcome | "Try again" | "Contact support" | Yes | Conditional | stack trace, internal error code |
| Offline | "You're offline" | "Reconnect to continue." | n/a | — | — | Auto on reconnect | No | network error, ECONNREFUSED |

---

## 17. Expiry and cancellation language

**Expiry (Vink-level):** "This Vink closed before everyone joined in." Never "expired" used
as a verb describing a person ("you expired" — never written; "expired" only describes the
Vink itself as a status word).

**Cancellation (Vink-level):** "The organizer cancelled this Vink." Never framed as a failure
or a fault — cancellation is a legitimate organizer choice, stated as a fact.

Both pair immediately with the viewer's own money-outcome line (§23) — never left to a
separate screen or a "tap for details" interaction.

---

## 18. Return and recovery language / guest money-outcome matrix

**Amended per D34: money-outcome language follows the financial state, not who's viewing
it.** The individual no-charge phrase is identical for guest, member, and organizer —
**"You weren't charged."** — never softened for guests. The group-level phrase ("No one was
charged") is a genuinely different statement (about everyone, not one person) and stays
available only where a Vink-level summary is actually what's being said (typically the
organizer's own Lobby, describing the whole group at once).

| D25 category | Customer sentence (individual — guest, member, or organizer alike) | Group-level statement, where applicable (organizer's Lobby only) |
|---|---|---|
| `completed` | "Payment complete. Your part helped pay {purpose}." | "Payment complete. The merchant was paid {groupTotal}." |
| `expired` | "You weren't charged." | "No one was charged." |
| `cancelled` | "The organizer cancelled. You weren't charged." | "No one was charged." |
| `return_pending` | "Your payment is being returned." | — |
| `returned` | "Your payment was returned." | — |
| `recovery-required` | "We're resolving your payment. You don't need to pay again." — shown **only to the organizer** (whose own card is involved); a participant/guest's own status is already `confirmed` and stays "Payment is confirmed" (§7/§10), never re-described as a distinct state at all, per §8's continuity rule | "We're resolving your payment. You don't need to pay again." (organizer's own dedicated line, §11) |

This table is exhaustive per D25 — no seventh category, no blended/ambiguous variant. No
phrase in this table is ever made warmer, softer, or less precise because the viewer is a
guest (D34).

---

## 19. Offline and reconnect language

| State | Copy |
|---|---|
| Offline | "You're offline" (persistent, quiet indicator — never a blocking modal) |
| Reconnecting | (no copy shown for a brief reconnect — silent, per the locked rule against narrating routine connectivity blips) |
| Reconnected after a visible offline period | (no special "back online" banner needed — content simply updates; if any indicator was shown while offline, it simply disappears) |

---

## 20. Authentication and reauthentication language

**Login:** heading "Sign in," failure "That didn't match. Check your username and password."

**Registration:** heading "Create your account," no jargon around the new contact-info field
— "Where should we send your invitations?" as the supporting line for that field (frames it
by its purpose, not as a generic "contact info" form field).

**In-place reauth (D26):** heading "Sign in to continue" — supporting line: "Your {screen
context, e.g. 'Vink'} is right where you left it." — never a generic "session expired" wording
that sounds like a fault; framed as a brief, expected interruption, not an error.

---

## 21. Support-entry language

- Label: "Contact support" (Phase 5 C37).
- No response-time promise anywhere ("we'll get back to you" — no timeframe attached).
- No support email address is invented here — the actual monitored channel is a **deployment
  dependency** (§27), configured at deploy time, not authored as copy.
- Context-aware placement: from Vink details/a Lobby with an unclear money outcome, the
  support entry point may carry that Vink's reference silently (not shown as raw text to the
  user, just passed along) so the organizer doesn't have to re-explain which Vink they mean.

---

## 22. Empty-state language

| Screen | Empty state |
|---|---|
| Home, no Vinks yet | Heading: "Start your first Vink." Supporting: "Split a bill, pool a gift, cover something together." Primary: "Start a Vink." |
| Activity, nothing yet | Heading: "Nothing here yet." Supporting: "Completed and past Vinks will show up here." |
| Home, all Vinks resolved (no active ones) | Heading: "You're all caught up." Supporting: "Nothing needs your attention right now." |

---

## 23. Accessibility announcement library

| Event | Announcement |
|---|---|
| Vessel progress change | "$X of $Y ready. Waiting for {clause}." (§12) |
| Everyone confirmed | "Everyone's ready." |
| Own contribution confirmed | "Payment confirmed." |
| Participant removed (Create) | "{Name} removed. Split updated." |
| Destructive action requiring confirmation | Sheet announces itself as a confirmation, e.g. "Cancel this Vink? This can't be undone." |
| Card ready | "Ready to pay — $X available." |
| Reauth sheet presented | "Sign in to continue. Your {context} is saved." |
| Guest terminal state reached | The exact §18 sentence for that category, as the primary announced content on arrival — never buried after layout-order content (Phase 4 §9). |
| Connectivity change | "You're offline" / (nothing on reconnect — no repeated announcements, §19). |

---

## 24. Screen-by-screen copy deck

Template per entry: Eyebrow — Heading — Supporting — Primary — Secondary — Inline status —
Loading — Error — Accessibility — Prohibited — Variables — Pluralization — Replaces —
Dependency. Fields omitted where genuinely n/a for that screen.

**Welcome**
Heading: "Split it. Pool it. Pay it together." — Supporting: "VinkIn is how a group pays as
one." — Primary: "Create account" — Secondary: "Log in" — Replaces: current copy unverified,
treat as current-capability baseline, not confirmed misaligned.

**Login**
Heading: "Sign in" — Primary: "Log in" — Error: "That didn't match. Check your username and
password." — Accessibility: error announced via live region — Prohibited: "invalid
credentials," "authentication failed."

**Register**
Heading: "Create your account" — Supporting (contact field): "Where should we send your
invitations?" — Primary: "Create account" — Dependency: contact-info field is
**New — designed, not built** (D19/D27).

**Home — empty state** — see §22.

**Home — active organizer Vink (card)**
Heading: `{purpose}` — Supporting: compact vessel ("$X of $Y ready") — Inline status:
`vinkStatusLabel`-equivalent from §11 — Variables: `{purpose}`, `{confirmedAmount}`,
`{totalAmount}` — Pluralization: n/a (amounts only, no counts on this compact card) —
Dependency: `contributionProgress` (D24), participant-inclusive Home query (Phase 3 §1).

**Home — active participant Vink (card)**
Same shape as above, plus: Supporting line may instead read "Waiting on your part" if the
viewer's own status is `not_started` — takes priority over the generic vessel line when it's
this viewer's own turn to act. — Dependency: same as above, plus Home listing participant
(not just organizer) Vinks at all (Phase 3 §1, currently entirely absent).

**Purpose and total** (Create screen 1, D30)
Heading: "What's this for?" — Fields: purpose (labeled "Purpose"), total (labeled "Total
amount") — Primary: "Next" — Prohibited: "category" as a customer-facing label (use
"Purpose" throughout; category is an internal policy concept, Phase 0 §1, that happens to be
selected via the same control but isn't named to the customer as "category").

**People and split** (Create screen 2, D30)
Heading: "Who's splitting this?" — Supporting: running total ("Assigned $X of $Y") shown
only once Custom is selected (§ Phase 5 C14) — Primary: "Continue" — Secondary: "Add person"
— Prohibited: "Percentage" anywhere (D22 — the control simply doesn't exist, not merely
hidden with a label).

**Add participant**
Sheet heading: "Add person" — Fields: name, then either username lookup or "Add as guest" —
Delivery choice: "Send automatically" (default, once built) / "Share manually instead" —
Primary: "Add" — Error (lookup failed): "We couldn't find that username." Secondary offer
inline: "Add {typed name} as a guest instead?" (Phase 2 §1's fix) — Dependency: automatic
delivery choice is **New — designed, not built** until D19/D27's mechanism exists; until
then this sheet only offers "Share manually instead."

**Edit participant**
Sheet heading: "Edit {name}" — same fields as Add, pre-filled — Primary: "Save" —
Dependency: **New — designed, not built** (Phase 5 C9).

**Open Vink confirmation**
Heading: "Ready to open?" — Supporting: full allocation summary (purpose, total, every
share, delivery method per person) — Primary: "Open Vink" — Secondary: (dismiss — no labeled
button needed, a close affordance suffices) — Loading: button-local "Opening…" — Prohibited:
any fee line (D21). — Replaces: the current standalone "Review" screen's content, now shown
here instead (D30).

**Successful Vink opening**
(No separate screen — the Lobby's own "Waiting for everyone" state, freshly entered, *is*
the success moment, per §15's "no doubled success" rule.) Accessibility: on arrival,
announces "Your Vink is open. Waiting for everyone."

**Automatic invitation success**
Inline row status: "Sent" (§9/§10 vocabulary) — Accessibility: "{Name}: invitation sent." —
Dependency: **New — designed, not built** (D19/D27).

**Invitation delivery failure**
Inline row status: "Couldn't send" — Compact action: "Share another way" — Accessibility:
"{Name}: couldn't send automatically. Share another way available." — Dependency: **New —
designed, not built.**

**Invitation fallback sheet**
Heading: "Share another way" — Actions: "Copy link," "Share," "Show QR code" — Inline
confirmation on copy: "Copied" (briefly, then reverts) — Prohibited: no "delivery guaranteed"
implication anywhere in this sheet's copy.

**Live Vink just opened**
Covered under "Successful Vink opening" above — same moment, same copy.

**Organizer needs to contribute**
Heading (their own row/prompt): "Your part — $X" — Primary: "Pay $X" — Prohibited: any
special organizer framing implying they're exempt or last-resort (Phase 0 §3) — this is
worded identically in kind to a member's own prompt, just personalized with their own amount.

**Some participants confirmed**
Vessel state per §12's exact patterns — no separate screen, a live state of the Lobby/Guest
Session.

**One person remaining**
Vessel headline unchanged pattern; waiting clause: "Waiting for {single name}" (§12).

**Everyone's-in transition**
Heading (brief, transient): "Everyone's in" — No supporting line needed — Auto-continues
into Preparing Payment with no additional tap (Phase 5 C29) — Accessibility: "Everyone's
ready" announced once.

**Preparing payment**
Heading: "Getting your card ready" — No provider/issuing language (already correct,
kept) — No retry control shown under normal conditions (§16's "preparation delayed" row
covers the rare exception).

**Ready-to-pay entry**
Heading: "Ready to pay" (canonical, D35) — Supporting: "$X available" — Primary: "Pay now"
(canonical, D35) — this is the **deliberate transition** into the focused payment surface
(D32) — Accessibility: "Ready to pay — $X available" — Dependency: **New — designed, not
built** (D32's shell).

**Provider-dependent payment surface placeholders — amended per D35**
**No customer-facing heading is written for this module.** "Pay at the register" is removed
— it silently assumed an in-person transaction, which D32 explicitly declined to lock in. In
every internal specification (this document and downstream visual/implementation docs), the
module's unresolved content is represented with the non-customer-facing marker
**`[provider-supported payment method]`** — never rendered to a real user, never shipped as
placeholder copy. Last-four + spending limit may still appear as safe summary information
around the module ("Card ending {last4} · Up to $X" — unchanged from D32), but no heading,
instruction, or method-specific copy is written for the module itself. **Dependency:
provider-dependent, unresolved pending the M0 gate (G1) — genuinely no copy exists here, not
a placeholder standing in for it.**

**Merchant payment completed**
Heading: "Payment complete" — Supporting (organizer/member): "The merchant was paid $X." —
Supporting (guest): "Payment complete. Your part helped pay {purpose}." — Accessibility:
outcome sentence is the primary announced content on arrival (Phase 4 §11).

**Cancel-Vink confirmation**
Sheet heading: "Cancel this Vink?" — Supporting: "No one will be charged." — Primary
(destructive): "Cancel Vink" — Secondary: "Never mind" — Accessibility: "Cancel this Vink?
This can't be undone. No one will be charged."

**Activity**
Heading: none needed (a list screen) — Empty state: see §22 — Row content: purpose, outcome
label (§11's vocabulary), date, amount.

**Vink Details** (D31 — never "Receipt")
Heading: the outcome sentence itself (§16/§18/§23's exact per-state line) — Supporting:
amount/participant breakdown, timeline — Prohibited: "receipt," "View receipt," any language
implying merchant-issued documentation (D31) — Secondary: "Contact support," shown only where
the individual money outcome is unclear or recovery is required (Phase 5 locked rule).

**Profile**
Heading: display name — Rows: "Contact info," "Change password," "Contact support," "Sign
out" — no payment-methods/security-beyond-password/legal rows exist (Phase 3 §5, still
deferred).

**Contact information**
Heading: "Contact info" — Supporting: "Where should we send your invitations?" — Fields:
name (read-only here — editing the display name, if ever supported, is a separate concern
not specified in this document) and contact destination — Primary: "Save" — Dependency:
**New — designed, not built** (D19/D27).

**Change Password**
Heading: "Change password" — Fields: current password, new password — Primary: "Save" —
Error: "Current password doesn't match." — Dependency: **New — designed, not built.**

**Help & Support**
Heading: "Contact support" — Supporting: **no response-time promise** — a plain, single
sentence stating how to reach a human (exact channel is a deployment dependency, §27, not
authored here) — Dependency: monitored channel is external (§27); D28's legal-content
deferral means no "Terms"/"Privacy" rows appear on this screen either.

**In-place reauthentication** — see §20.

**Guest SMS invitation / Guest email invitation / Member SMS invitation / Member email
invitation** — see §9's exact templates.

**Guest "not open yet"** (D23)
Heading: "Not open yet" — Supporting: "Check back soon." — No action — Accessibility:
`role="status"`, calm tone — Prohibited: "Draft," any synonym of the raw state name.

**Guest active invitation** (Join Form, Vink `OPEN`)
Heading: "Your part — $X" — Supporting: "{organizerName} invited you to {purpose} · Group
total {groupTotal} · Closes in {countdown}" — Field: display name — Primary: "Join" —
Prohibited: no fee line (D21).

**Guest contribution form**
(Same screen as above, post-name-entry — the amount and consequence are already visible
before the action per D33) Primary: "Approve $X."

**Guest processing**
Inline status replacing the action: "Confirming your payment…" — No optimistic "You're in"
shown yet (D33/Phase 5's locked rule).

**Guest confirmed**
Heading: "You're in." — Supporting: current group vessel state — Primary action: **none,
ever again, regardless of reload** (D25).

**Guest completed / expired before contributing / cancelled before contributing / return
pending / returned / recovery-required** — exact sentences: §18's guest column, verbatim.
Each is its own distinct heading state, never collapsed into the others (D25).

**Offline**
Inline persistent indicator: "You're offline." No blocking modal.

**Reconnecting**
No copy shown (§19 — silent, routine).

**Unexpected error**
Heading: "Something went wrong" — Supporting: "Nothing was changed — try again." (only shown
when true — this generic message is reserved for errors caught before any state change) —
Primary: "Try again" — Secondary: "Contact support."

---

## 25. Money-outcome standard

Every consequential failure or terminal state answers three questions in its very first
sentence, never requiring a second screen or a tap-to-expand:

1. **Did money move?**
2. **What is happening to it?**
3. **Does the customer need to act?**

The five canonical outcome phrases, never collapsed into one generic message, and — per D34 —
**chosen by financial state alone, identical across organizer, member, and guest**:

| Phrase | Means | Audience | Never used when |
|---|---|---|---|
| "You weren't charged." | No money moved at all for this person, ever, for this attempt/Vink | Individual — guest, member, or organizer alike (identical wording, D34) | An actual capture occurred |
| "No one was charged." | The group-level equivalent — nobody in the whole Vink was charged | Organizer's Lobby, Vink-level summary only | Used to describe one specific person's own outcome |
| "Your payment is confirmed." ("You're in") | Money moved and is confirmed as this person's part | Individual, any audience | The contribution is only pending/processing |
| "Your payment is being returned." | Money was taken and is actively coming back | Individual, any audience | It has already fully returned |
| "Your payment was returned." | The return is complete | Individual, any audience | It's still in progress |
| "We're resolving your payment. You don't need to pay again." | The organizer's own payment method is being charged to cover a shortfall — never the group's, never a participant's/guest's | Organizer only | Shown to any participant/guest as their own concern |

A reassuring phrase is **never** used unless the underlying state genuinely supports it —
"You're in" is never shown before server confirmation (D33); "You weren't charged" is never
shown for a contribution that actually captured. **No phrase in this table is ever
substituted with a warmer or vaguer variant because the viewer is a guest (D34).**

---

## 26. Organizer/member/guest terminology differences

| Concept | Organizer sees | Member sees | Guest sees |
|---|---|---|---|
| Their own share | "Your part — $X" (identical framing to everyone, Phase 0 §3) | Same | Same |
| Other people's status | Full participant list, per-row status | Same as organizer (Phase 0 §2) | **Aggregate only** — never another individual's status (Phase 0 §2/D24 privacy boundary) |
| Recovery | Full detail, own-card framing (§16) | Not shown at all (organizer-only obligation) | Not shown at all — own status stays "Paid" |
| Restricted | Full detail, actionable | Not shown | Not shown |
| Card details | Full (within the focused payment surface, D32) | Not shown (only the organizer transacts) | Not shown at all (Phase 3 §3/§6, unresolved scope question, not decided by this phase) |
| Vink details/history | Full, own Vinks + participations | Full, own participations | No account, no history screen — guest-web has no equivalent surface |

---

## 27. Dynamic-variable, pluralization, and truncation rules

- **Names in the waiting clause:** 1 → full name; 2 → "{A} and {B}"; 3+ → "{N} people"
  (§12 — refines Phase 4 §0's earlier approximation, this table is now the canonical
  version).
- **Amounts:** always via the shared currency formatter — `$0.00` minimum precision, never a
  bare integer for a dollar amount.
- **Countdown minutes:** always plural-aware — "Closes in 1 minute" (singular), "Closes in 4
  minutes" (plural) — never "Closes in 1 minutes."
- **Participant counts elsewhere** (e.g. "3 people" in the waiting clause, or a future count
  displayed anywhere else): same singular/plural handling — "1 person," never "1 people."
- **Name truncation:** a display name is never mid-word truncated with an ellipsis inside a
  sentence (e.g. never "Wait­ing for Christo…") — if a name is too long for a given layout,
  the *layout* wraps or the row's own truncation (an implementation/Phase 8 concern) applies
  to the row display, not to sentence-form copy, which always uses the full name.
- **Purpose field:** free text, no length rule imposed by this document — any truncation
  needed for layout is a Phase 8 concern, not a copy-system rule.

---

## 28. Current-copy-versus-canonical-copy matrix

| Area | Current copy | Canonical copy (this document) | Status |
|---|---|---|---|
| Guest-added moment | "{name} is in" (`add_person_sheet.dart:211`) | "Added" (no "is in") | **Fix required** — Phase 1 §C.5's exact bug |
| `EXPIRED` badge tone | Red/attention (`vink_status_badge.dart:33`, `StatusBadge.tsx:20`) | Neutral tone, same label | **Fix required** — §11 |
| `DRAFT` guest exposure | "Draft" shown to guests (`StatusBadge.tsx:5`) | Never guest-visible at all (D23) | **Fix required, backend-gated** |
| Progress bar | "$X of $Y funded" language, `fundedAmountMinor`-driven | "$X of $Y ready," `contributionProgress`-driven | **Fix required** — D20/D24 |
| Guest terminal state | One flat "no longer accepting contributions" | Six distinct D25 sentences (§18) | **Fix required** — D24/D25 |
| Guest error messages | Raw backend strings (`error.message` rendered directly) | The full §16 mapping | **Fix required** — Phase 1 §D.1 |
| "No longer accepting new participants" (pre-open) | Misfires for a not-yet-opened Vink | "Not open yet" (§24) | **Fix required** — D23, Phase 1 §D.2 |
| RECOVERY_REQUIRED/PENDING copy (organizer) | "Resolving a shortfall" (vague on money) | "We're resolving your payment. You don't need to pay again." (canonical, D34) | **Refine** — Phase 1 §C.11 |
| COMPLETED copy | "This Vink is complete. Thanks for organizing." | "Payment complete. The merchant was paid $X." | **Refine** — Phase 1 §C.11 |
| Activity detail naming | Doesn't exist yet | "Vink details," never "Receipt" | **New** — D29/D31 |
| Invitation framing | Manual-only, no automatic-delivery copy exists | §9's templates | **New** — D19/D27, unbuilt |

---

## 29. Provider/legal/support-dependent copy inventory

Items in this document that are **intentionally incomplete**, pending something outside this
phase's authority:

1. **Provider-dependent payment surface content** (§16/§24, marked `[provider-supported
   payment method]`) — actual presentment copy depends on the M0 provider gate (G1), per
   D32/D35. Not written here at all — the marker stands in for the slot in internal specs
   only, never shipped as customer-facing placeholder text.
2. **SMS carrier/consent/opt-out language** (§9) — requires actual approved legal/regulatory
   requirements this document has no authority to invent. External dependency.
3. **Support channel destination** (§21/§24's Help & Support) — a deployment configuration
   value, not copy; no email address is invented.
4. **Terms, Privacy, cardholder terms, refund policies, consent clauses** — none written;
   remain deferred under D28 until legal counsel is engaged (ties to G2).
5. **Support response-time commitments** — never written anywhere in this document, by
   explicit instruction.
6. **Notification-delivery guarantees** ("we'll make sure it arrives") — never written;
   every invitation template states what VinkIn *did* (sent), never a guarantee of receipt.

---

## 30. Dependencies Phase 8 (Visual System) must not contradict

1. Button labels are sentence case in copy, regardless of any uppercase *typographic*
   treatment Phase 8 applies visually (§4) — Phase 8 must not reinterpret this as a copy
   change.
2. The vessel's exact headline/waiting-clause pattern (§12) is fixed content — Phase 8 may
   style it, not reword it.
3. `EXPIRED`'s tone correction (neutral, not attention/red, §11) is a copy-and-tone decision
   already made here — Phase 8's color system must accommodate it, not re-litigate it.
4. The six-way guest terminal vocabulary (§18) and the five-phrase money-outcome standard
   (§25) are exhaustive and fixed — Phase 8 styles them, does not add variants.
5. No screen in the §24 deck gets a fee line, a percentage-split label, a receipt label, a
   support response-time, or provider-specific payment copy — these exclusions carry forward
   unchanged into visual design.

## 31. Acceptance criteria for moving into visual refinement

- [x] Owner confirms the voice/tone guide (§1) and the seven-trait/seven-anti-pattern frame
      as binding for all future copy, including anything Phase 8–13 need to add later.
- [x] Owner confirms the `EXPIRED` tone correction (neutral, §11) — a visual change riding
      along with this copy phase's own finding from Phase 1.
- [x] Owner corrected the money-outcome audience split: "You weren't charged." is now the one
      canonical individual no-charge phrase for guest, member, and organizer alike — never
      softened for guests (D34, §18/§25 amended).
- [x] Owner corrected the provider-dependent payment-surface entry: "Pay at the register" is
      removed; the module is represented only by the internal, non-customer-facing marker
      `[provider-supported payment method]` until the M0 gate resolves (D35, §16/§24/§29
      amended).
- [ ] No item in this document contradicts D1–D35 or Phases 0–5.

**Stopping here per instruction — no visual refinement or application implementation
follows this document.**
