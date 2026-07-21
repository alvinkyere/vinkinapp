# Phase 0 — Product Behavior Document

_UI/UX Engineering Plan, Phase 0 output: "a single approved customer-facing behavior
document," so the redesign cannot contradict the financial/backend system._

**Status:** APPROVED — describes what is actually implemented today (PV0–PV13, D1–D18), plus
four owner-ratified decisions (D19–D22, 2026-07-20) that resolve the gaps/conflicts an earlier
draft of this document flagged. Every behavioral claim is traceable to `packages/domain`,
`packages/application`, `apps/api`, `apps/mobile`, `apps/guest-web`, or a milestone report;
every decision is traceable to `docs/spec/decision-log.md`. This document is the source of
truth for Phase 1.

---

## 1. Who can create a Vink

- Creating a Vink requires a signed-in VinkIn account (bearer access token on
  `POST /api/v1/vinks`; unauthenticated → `401`).
- Auth is in-house username + password today — no phone/OTP verification, no KYC, no
  account-age gate. (G5 — in-house OTP vs. delegated identity — is still open; G11 — KYC
  depth — is still open. Neither is built.)
- The only creation-time validation is a valid future submission deadline and a supported
  purchase category (`packages/domain/src/policy.ts`). The creator automatically becomes the
  `ORGANIZER` participant.

**Design implication:** the redesign must not imply phone verification, ID checks, or any
account tier during sign-up/creation — none of that exists.

## 2. Members versus guests

- A "member" and a "guest" are the same underlying `Participant` shape. The only difference:
  a member has a `userId` (a real VinkIn account); a guest has a `guestIdentityId` instead
  (no account, authenticated only by a `vgt_` guest token bound to one session).
- Both can do exactly the same financial thing: view the Vink, see their allocated share,
  authorize/pay their own contribution. Neither can create/open/cancel a Vink, add other
  participants, or change the split — those are organizer-only.
- A member is added by looking up an existing, active username. A guest is added either by
  the organizer naming them (`inviteGuestCommand`, produces a personal `/g/:token` link) or
  by the guest self-joining a public code (`guestJoinVinkCommand`).

**Design implication:** "member" vs. "guest" is an identity distinction, not a capability
tier. The UI should not suggest guests get a lesser payment experience — they get the
identical contribution flow, just without an account.

## 3. Organizer participation

- The organizer is a normal contributing participant, not a special role that stands outside
  the money. They can be allocated $0, a custom amount, or an equal share, exactly like
  anyone else — including a deliberate, explicit $0.
- **"Pay my $X" for the organizer goes through the exact same `POST /contributions/authorize`
  endpoint every other participant uses.** There is no organizer shortcut, no implicit
  "organizer pays whatever's left" default in the payment path itself. (There is a separate,
  pre-open convenience — `coverRemainingCommand` — that lets the organizer absorb any
  *unallocated* remainder into their own share before the Vink opens; that's an allocation
  decision, not a payment shortcut.)

**Design implication:** the Live Vink screen must show the organizer's own contribution row
using the identical "waiting → ready" treatment as every other participant. Ratified in
PV13 specifically because the prior app treated the organizer as a payer-of-last-resort
rather than a participant.

## 4. How guests are contacted

- **There is no automatic SMS or email delivery anywhere in the system.** This was checked
  directly against the codebase (no Twilio/SendGrid/nodemailer/etc. integration exists).
  G12 (push-primary/SMS-fallback notification channel) is an open question, not a built
  feature.
- Guest contact today is **manual only**: the organizer receives a raw link/token in the app
  response and shares it themselves via the OS share sheet (message, email, whatever the
  organizer picks), or via a displayed/rendered QR code.

**Decision (D19, 2026-07-20 — ACCEPTED):** automatic SMS/email guest delivery is canonical
product behavior, not optional. Existing members receive in-app invitations. Guests receive
an SMS or email invitation automatically, unless the organizer explicitly selects manual
sharing instead. Copy Link, Share, and QR remain supported in every case as fallback/manual
delivery methods — never removed, just no longer the only path. Current manual-only delivery
is recorded as an **implementation gap against this decision**, not the intended final
workflow; the redesign should design the automatic-delivery experience as primary even though
the SMS/email sending mechanism itself is not yet built (a separate, not-yet-scoped item).

## 5. Manual share and QR fallback

- Two organizer-facing endpoints: create a share link, create a QR payload. The QR payload
  is a small JSON contract (`{format, publicCode, url}`) — the client renders the actual QR
  image; there is no server-generated image.
- Public join is anonymous: viewing `GET /join/:code` shows category/amount/progress to
  anyone holding the code — the code itself *is* the invitation, by design. Joining after
  the Vink is no longer `OPEN` (closed, past deadline) returns a calm, specific message:
  "This Vink is no longer accepting new participants."

**Design implication:** per D19 (§4), Copy Link/Share/QR are the *fallback* methods, available
whenever the organizer opts out of automatic delivery — but since automatic delivery isn't
built yet, they remain the only working path in the interim. Design both: the fallback UI
needs to be well-executed on its own (it's what actually works today), and the primary
automatic-delivery flow needs to be designed so it can be built without a fallback-UI rework.

## 6. Equal and custom splitting — and a funding-progress gap

- Splitting supports **Equal, Custom Amount, and Percentage** in the domain and API
  (`packages/domain/src/split-engine.ts`), with deterministic largest-remainder rounding.
  Itemized splitting is explicitly unsupported (rejected with a domain error).
- The current mobile organizer app deliberately hides the Percentage option in its UI and
  only exposes Equal / Custom Amount — a UI scoping choice from PV13, not a backend
  limitation.
- **Decision (D22, 2026-07-20 — ACCEPTED):** Percentage splitting stays hidden from the MVP
  UI. This is confirmed as an intentional scope decision, not a gap to fix. Phase 1 exposes
  only Equal and Custom Amount. The capability remains fully implemented server-side and can
  be exposed later with zero backend change if a product need arises.
- Split cannot be changed once any participant has a contribution in flight.

**Finding, now resolved by decision — conflicted with the Ink Progress System requirement.**
`vink.fundedAmount` is **not** updated incrementally as individual people pay. It stays at
`$0` through every single contribution and is only ever set once — atomically, all at once —
by the single funding resolver (D5), at the moment the *last* required contribution clears.
In other words: **the pooled total jumps straight from $0 to 100% funded; there is no
reachable "$90 of $120, 3 of 4 paid" state today.** What *does* exist, and does update
per-person, is a separate read-only per-participant status list (added in PV13 specifically
to work around this) showing each participant as paid/processing/waiting — that's how the
current organizer lobby shows partial progress, and it is not the same signal as the pooled
`fundedAmount`.

**Decision (D20, 2026-07-20 — ACCEPTED):** the Ink Progress System represents contribution
*readiness*, not the backend `fundedAmount` field — `fundedAmount` is not redefined or
changed, and keeps its existing single-atomic-update-at-resolution behavior (D5). Phase 1
instead derives a new, incremental UI-level value — named `contributionProgress` or an
equivalent term that cannot be confused with settled/fully-funded money — from participant
assigned shares and confirmed contribution states: the same underlying data PV13's
`VinkReader.listContributionsByVink` already exposes (sum of allocated amounts for
participants whose contribution has reached a confirmed state, over the required total). No
backend/domain change is needed to compute it; it's a new derived read, not a new financial
concept.

## 7. Contribution timing and approval flow

- Exactly one code path (the D5 resolver) ever decides FUNDED vs. EXPIRED, invoked either the
  instant the last participant authorizes (fast path) or by the deadline sweep (grace-path).
  This guarantees the state is never decided twice or inconsistently.
- Each participant: authorizes → held (not yet charged) → once *everyone* required has
  authorized and the sum matches the total, all holds are captured together and the Vink
  becomes funded. A declined attempt is not silently retried — a new attempt is created.
- "Ready" in customer terms should map to the Vink reaching `CARD_READY` (card provisioned),
  not to an individual person finishing their own payment — those are different moments.
- Nobody is ever charged more than their approved maximum; this is enforced twice in code
  (at authorization and again immediately before capture), independent of UI behavior.

## 8. Vink expiry

- Expiry is decided by scheduled server-side sweeps comparing against the database's own
  clock — never client time, never "whoever's browser noticed first."
- If the deadline passes before everyone has authorized, the Vink expires. Nobody who hadn't
  yet paid is charged (their hold is simply released, no ledger entry ever existed for them).
  Anyone who *had* already been captured gets refunded (§11).
- Expiry is terminal — there is no reopen path.

## 9. What happens when everyone is ready (funded)

- The instant the last hold is captured, every participant's payment is captured together in
  one atomic step, the pooled total is set, and the Vink becomes funded — this is also the
  moment "Everyone's in" becomes true.
- Card provisioning for the organizer's temporary card begins automatically right after
  funding — the customer should not perceive a separate "now request the card" step.

## 10. How the organizer pays the merchant

- Once funded, a single-use virtual card is issued with a spending limit set to the exact
  funded amount (zero slack) and merchant-category restrictions matching the Vink's category.
  The card never has its full number/CVV stored anywhere in VinkIn's systems — only a
  display-safe last four digits.
- The card locks to whichever merchant swipes it first — a second merchant cannot use the
  same card, and a duplicate attempt from the *same* merchant replays the original decision
  rather than double-charging.
- After the merchant's settlement comes in: exact match completes the Vink; an undercharge
  completes it too (releasing the unused reserve); an overcharge triggers recovery (§11) —
  the group is never asked to cover an overage, only the organizer.
- All of this currently runs only against a mock/simulated merchant and mock provider — no
  real card network or real money is involved yet (surfaced to users today via a standing
  "Pilot simulation — no real card has been issued, no real money moves" banner).

## 11. What happens when a Vink fails, expires, or overcharges

- **Expiry with money already captured:** every captured contribution is refunded
  automatically; a failed refund attempt is an explicit, visible state that gets retried —
  never silently dropped.
- **Merchant overcharge (settlement exceeds the funded amount):** the platform fronts the
  difference immediately (so the merchant is made whole without delay), then attempts to
  recover it from the **organizer only**, off-session, with up to three retries. Participants
  are never re-charged for this under any circumstance. If recovery ultimately fails, the
  organizer's account is restricted (not the group's) — a terminal, serious outcome.

**Design implication:** copy for this path must be honest that it is specifically about the
organizer's own payment method, and never suggest other participants are at risk.

## 12. Money messages that must appear

- **A standing pilot-simulation disclosure** ("no real card, no real money moves") wherever
  simulated money/card state is visible — this exists today and must be preserved or
  deliberately and visibly superseded when the product moves off the mock provider; it should
  not just quietly disappear.
- **No fee disclosure exists anywhere** — there is no fee model in the domain at all today.
  **Decision (D21, 2026-07-20 — ACCEPTED):** no fee model is canonical. Phase 1 must not
  display, calculate, or hard-code any guest/participant fee. Payment-summary components may
  carry an optional slot for a future API-provided fee value, but it stays absent/hidden
  while no real fee exists — never populated with a placeholder or estimated number. Phase 4's
  guest-page fee-disclosure item should be designed as this optional, currently-empty slot,
  not as real copy with a number.
- **The §4.7 charging cap ("never more than your approved maximum") is enforced in code but
  never stated to the customer anywhere today.** This is a good candidate for genuinely new,
  trust-building copy in Phase 7 — it's true, tested, and currently invisible to users.
- **State names must never leak.** Every one of the 16 backend state names (`OPEN`,
  `PROCESSING_GRACE`, `CARD_READY`, etc.) has a required plain-language customer equivalent;
  this is already tested end-to-end on both existing clients and must carry into the redesign
  unchanged as a rule, even as the specific copy is rewritten in Phase 7.

---

## Decisions recorded (owner-approved, 2026-07-20)

The four items an earlier draft of this document flagged as open gaps/conflicts are now
resolved as explicit decisions in `docs/spec/decision-log.md` and closed against
`docs/spec/open-questions.md` where applicable. Phase 1 proceeds on this basis:

1. **D19 — Automatic SMS/email guest delivery is canonical**, with Copy Link/Share/QR as
   fallback (§4, §5). Closes G12. Not yet built — an implementation gap, tracked separately.
2. **D20 — The Ink Progress System is driven by a new `contributionProgress` value**, derived
   from participant shares and confirmed contribution states, never from `fundedAmount` (§6).
3. **D21 — No fee model is canonical.** Phase 1 must not display, calculate, or hard-code a
   fee; an optional future-API slot may exist but must stay empty (§12).
4. **D22 — Percentage splitting stays intentionally hidden from the MVP UI**; only Equal and
   Custom Amount are exposed in Phase 1 (§6).
