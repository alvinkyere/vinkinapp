# 00 — Provider Feasibility (Milestone 0)

Milestone 0 (§39) exists because **the entire product stands on capabilities no code can
guarantee**: whether a provider will let VinkIn collect participant money, pool it, and spend it
through a platform-issued virtual card presented by a consumer. This document frames what must
be confirmed, with whom, and how. Provider capability statements below are engineering
knowledge as of early 2026 — every one marked ⚠ must be re-verified against current provider
docs and, where flagged, with provider/partner-bank sign-off in writing.

## 1. Funds flow to validate

Canonical funds-flow document (diagram, hop-by-hop ledger mapping, the liquidity question,
failure paths): **`docs/feasibility/funds-flow.md`** — shared with providers and counsel, and
updated with measured timings from S1. One caution retained here for stack A: Stripe
balance→Issuing balance transfers are believed near-instant within one platform account (⚠
verify current behavior and limits in S1); if funding instead rides bank rails, a pre-funded
float and larger reserves (§36) become part of the architecture.

## 2. Candidate provider stacks

### A. Stripe-only: Payments + Issuing (+ Connect/Treasury as program dictates)
- Pros: one API/webhook surface, Elements + Apple/Google Pay mature, Issuing has real-time
  auth webhooks with sub-2s approve/decline authority, hosted card-display components
  (PCI scope stays SAQ-A-ish), Stripe Identity for KYC, Radar for fraud.
- ⚠ **The existential question: program design.** US Stripe Issuing is historically a
  **commercial** card program (platform is the accountholder; cards issued to the business or
  its users for business spend). VinkIn's card is spent by a *consumer organizer* for
  *personal* purchases from a pooled balance. Whether Stripe (and its BIN sponsor) permits
  this consumer-facing use, and under what KYC/cardholder-agreement structure, **requires
  written confirmation from Stripe partnerships — not a sandbox test.** (§39 "confirm
  consumer issuing support", gap G3.)
- ⚠ Spending controls: per-card amount limits + MCC allow/block lists exist; **exact-merchant
  locking (§18) is not a native control** — enforced by our real-time auth webhook instead.
  Confirm we can be the decisioning authority on every auth (Issuing supports synchronous
  auth-request webhooks; confirm timeout and default-decline behavior).

### B. Stripe Payments (collection) + dedicated issuer (Lithic or Marqeta)
- Pros: Lithic/Marqeta run **consumer** card programs with program-manager arrangements;
  auth-stream access (ASA / JIT funding) gives per-auth approve/decline; virtual cards are
  first-class.
- Cons: two providers = two webhook surfaces, two reconciliations, and a **bank-rail funding
  gap** between the Stripe balance and the issuer's funding account (float required, likely
  days of buffer); more contracts; program approval still required (consumer program ≈ more
  compliance, but at least it's their standard shape).

### C. BaaS with FBO accounts (Unit, Increase, Treasury Prime, Column direct)
- Pros: FBO ledgered sub-accounts map cleanly to "participant funds held for a purchase";
  bank partner is explicit in the structure (helps the money-transmission analysis).
- Cons: card-acquiring for *collection* (Apple Pay from participants) usually still needs a
  Stripe-like acquirer on top; more assembly; some BaaS platforms have retrenched — partner
  durability is itself a risk (see risk register R2).

**Recommendation:** run M0 against **A and B in parallel** — A is the fastest build if Stripe
approves the program shape; B is the fallback whose feasibility mostly rides on the funding
gap. Do not write adapter code for either until the mock adapter has validated the interface
(done) and each provider's sandbox confirms behaviors in §4.

## 3. Open legal/compliance questions (for counsel — engineering frames, does not decide)

1. **Money transmission:** VinkIn takes possession (via provider accounts) of participant
   funds and directs them to a merchant. Does operating under the provider's/bank's program
   (agent-of-payee or similar exemptions, FBO structure) cover this, state by state, or does
   VinkIn need MTL licensure/sponsorship? This killed or reshaped comparable products; treat
   as launch-blocking. Cautionary precedent: Braid (group-wallet startup) shut down in 2023
   largely over banking-partner/program issues.
2. **Card network rules on the spend side:** the organizer presents a platform-funded card
   in-store. Confirm the BIN sponsor allows person-present usage of this program type and what
   cardholder agreement the organizer must accept (§10.1 terms flow).
3. **Regulation E / dispute allocation:** if the merchant purchase goes wrong, who disputes —
   organizer (card user), VinkIn (accountholder)? Participant-side disputes ("I paid my share
   but got nothing") are card-network disputes against VinkIn as merchant of record for
   contributions — confirm MOR designation and descriptor requirements.
4. **KYC scope:** does the program require full KYC on the organizer only (our assumption,
   §10.1) or on all participants above thresholds? Guests paying ≤ small amounts should stay
   friction-free (§34) — confirm thresholds.
5. **Receipt/consent language** for participant maximum-exposure approval (§21 "do not hide
   the maximum") — what disclosure format satisfies the program and UDAAP expectations.
6. **State escheatment** for unclaimed refunds of expired Vinks.

## 4. Sandbox spike checklist

Canonical home of the S1–S12 tests, pass criteria, and results table:
**`docs/feasibility/sandbox-test-plan.md`**. Scripts land in
`packages/payment-provider/spike/` and drive providers only through the neutral
`FinancialProvider` interface. Baseline requirement before any S-test: the candidate's
adapter passes the shared conformance suite (`packages/payment-provider-contract-tests`).

## 5. Exit criteria for Milestone 0

Superseded by the formal ten-condition gate:
**`docs/architecture/06-milestone-0-gate.md`** is the sole authority on M0 closure. The
outreach artifacts to send are in `docs/feasibility/` (provider overview, funds flow,
provider questionnaire, counsel questionnaire); written responses are filed under
`docs/feasibility/responses/` as gate evidence.

## 6. What engineering can do before sandbox keys exist

Exactly what has been done in this pass: freeze the provider-neutral interface (§43 + webhook
parsing extension), build the mock adapter implementing the full contribution lifecycle
(authorize → capture/cancel → refund; duplicate-webhook simulation), and write the sandbox
scripts against the interface so they run against any adapter. The moment keys exist, S1–S12
are executable work, not design work.
