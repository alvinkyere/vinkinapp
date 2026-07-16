# 00 — Provider Feasibility (Milestone 0)

Milestone 0 (§39) exists because **the entire product stands on capabilities no code can
guarantee**: whether a provider will let VinkIn collect participant money, pool it, and spend it
through a platform-issued virtual card presented by a consumer. This document frames what must
be confirmed, with whom, and how. Provider capability statements below are engineering
knowledge as of early 2026 — every one marked ⚠ must be re-verified against current provider
docs and, where flagged, with provider/partner-bank sign-off in writing.

## 1. Funds flow to validate (with ledger mapping)

```text
 (1) charge                    (2) platform funds            (3) issuing funds
PARTICIPANT ──────► ACQUIRING/PAYMENTS ──────► PLATFORM ACCOUNT ──────► ISSUING BALANCE
card / wallet        (e.g. Stripe Payments)    (FBO-style pooled)        (funds card spend)
                                                                              │
                                                                              │ (4) temp virtual card auth
                                                                              ▼
                                        MERCHANT ◄────── CARD NETWORK ◄── TEMPORARY CARD
                                            (5) normal settlement — one payment (§1)
```

| Hop | Ledger posting (§26) | Must confirm |
|---|---|---|
| 1 | DR processor_clearing / CR participant_contribution_liability | manual capture support, wallet support, auth-hold duration |
| 2 | DR platform_fbo_cash / CR processor_clearing (net of fees: fee expense entry) | payout timing — **is money available for issuing before T+1/T+2?** This is the liquidity crux. |
| 3 | DR issuing_balance / CR platform_fbo_cash | top-up latency and minimums; auto-funding options |
| 4 | DR vink_purchase_expense / CR vink_available_balance (+ reserve entries at auth) | real-time auth webhook + our approve/decline authority + latency budget |
| 5 | reconciliation against issuing settlement reports | capture vs. auth variance visibility (tips! §21) |

**Liquidity finding to validate first:** captured participant funds typically land in the
platform's provider balance before payout but issuing spend may draw from a separate balance.
If provider-internal transfer (2)→(3) is instant (⚠ Stripe: balance→Issuing balance transfers
are generally same-day/instant within the platform account — verify current behavior and
limits), the "seconds at the register" promise holds. If it requires bank-rail timing, VinkIn
must **pre-fund a platform float** and treat participant captures as replenishment — that
changes reserve requirements (§36) and must be in the feasibility report.

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

## 4. Sandbox spike checklist (maps §39 M0 bullets → concrete tests)

Each test gets a numbered script under `packages/payment-provider/spike/` when sandbox keys
exist; results go in the feasibility report table (pass/fail/latency/notes).

| # | §39 item | Concrete sandbox test |
|---|---|---|
| S1 | funds flow | capture test charge → observe balance availability timing → transfer to issuing balance → measure end-to-end latency |
| S2 | consumer issuing / cardholder structure | create cardholder for a test consumer identity; document required fields + agreements (this is also a partnerships question, §2A⚠) |
| S3 | virtual card creation | issue virtual card with amount limit; measure issue latency (§37 "card issuance latency") |
| S4 | real-time auth | simulate merchant auth; verify our webhook receives it, we decline/approve, and our decision sticks; measure deadline + default behavior on timeout |
| S5 | merchant controls | test MCC allow/block behavior; verify what merchant identity data the auth payload carries (merchant_id? terminal_id? — §18 lock keys) |
| S6 | wallet contributions | Apple Pay & Google Pay test charges via Elements on a test page (domain-verified) |
| S7 | manual capture | authorize-only → capture less than auth → cancel remainder; confirm partial capture + auth-hold TTL (§11 model) |
| S8 | refunds | refund captured charge; observe timing + webhook sequence (§25 user-messaging depends on it) |
| S9 | disputes | trigger sandbox dispute; map to `DISPUTED` slot state |
| S10 | recovery charging | charge saved payment method off-session (§23); confirm mandate/SCA-exemption requirements |
| S11 | multicapture / incremental auth | §21: is multicapture or auth-extension available on issuing side (merchant side) and acquiring side? Document per provider. |
| S12 | webhook behavior | duplicate delivery, out-of-order delivery, replay; signature verification; document event id semantics for `provider_events` (§28) |

## 5. Exit criteria for Milestone 0 (definition of done)

1. Feasibility report: S1–S12 results per candidate stack, with latency numbers.
2. Written provider answer on the program-design question (§2A) — or a documented "no",
   which pivots us to stack B/C.
3. Counsel memo (or at minimum documented outside-counsel questions sent) on §3.1–§3.3.
4. Funds-flow diagram updated with the chosen stack's real account names + timing.
5. Risk register updated (R1–R4 statuses).
6. Mock provider adapter merged and green (**done** — `packages/payment-provider`, exercised
   by `node --test`; it encodes the §43 interface + the §11/§12 semantics the real adapters
   must satisfy, and is the test double for §38 integration/chaos suites).
7. Go/no-go recommendation with the chosen stack for Milestone 1.

## 6. What engineering can do before sandbox keys exist

Exactly what has been done in this pass: freeze the provider-neutral interface (§43 + webhook
parsing extension), build the mock adapter implementing the full contribution lifecycle
(authorize → capture/cancel → refund; duplicate-webhook simulation), and write the sandbox
scripts against the interface so they run against any adapter. The moment keys exist, S1–S12
are executable work, not design work.
