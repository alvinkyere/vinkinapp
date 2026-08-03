# VinkIn — Proposed Funds Flow

_Canonical funds-flow document (gate condition 3). Shared with providers and counsel; the
internal ledger mapping stays in sync with `docs/architecture/04-database-schema.md`. The
architecture below reflects the owner-approved Real-Money Beta design
(`docs/spec/decision-log.md` D47) — VinkIn as the legal cardholder, spending from VinkIn's own
Stripe Financial Account, a reusable card pool, and a dual-timer Vink/card lifecycle. **Real
account identifiers and measured timings are still pending**: they require VinkIn's actual
Stripe Financial Account (v2) to exist, which is an owner-side Stripe Dashboard action outside
sandbox scope (see `docs/architecture/06-milestone-0-gate.md`'s D47 exception) — this document
records the decided shape now and gets real numbers filled in as RM-track engineering work
lands against the real sandbox._

## Diagram

```text
 (1) capture (per payment,               (2) funds accumulate         (3) card reserved
     not held)                               in VinkIn's own              from the pool,
PARTICIPANT ──────► Stripe PaymentIntent ──────► VINKIN STRIPE ──────► spending controls set,
card / wallet         (captured immediately)     FINANCIAL ACCOUNT      wallet token provisioned
                                                        │
                                                        │ (4) organizer taps to pay via
                                                        │     Apple Wallet / Google Wallet
                                                        ▼
                                        MERCHANT ◄────── CARD NETWORK ◄── ASSIGNED CARD
                                            (5) settlement → card disabled, wallet token
                                                revoked, card returns to pool
```

## Hop-by-hop

| Hop | What happens | Internal ledger posting (Spec §26) | Status |
|---|---|---|---|
| 1 | Participant pays their share; Stripe **captures immediately** (D47 — not an authorization hold released on session failure, a real change from this project's original PV5/D5 model) | DR processor_clearing / CR participant_contribution_liability, immediately on capture | Decided (D47); real timing pending Financial Account v2 |
| 2 | Captured funds land in VinkIn's own Stripe Financial Account (not a generic pooled platform balance — VinkIn is the accountholder) | DR vinkin_financial_account / CR processor_clearing | Decided (D47); balance-availability timing pending real sandbox measurement |
| 3 | Vink reaches 100%; one card is reserved from the 15-card pool (never minted fresh), spending controls (amount/merchant/expiration) configured for this assignment, a wallet token provisioned to the organizer's device | DR vink_available_balance reserved / CR vinkin_financial_account (earmarked, not yet spent) | Decided (D47); card-pool schema + reservation logic is RM1 |
| 4 | Organizer taps "Pay with Apple/Google Wallet" at the register; the assigned wallet token (not the raw card) authorizes | DR vink_purchase_expense / CR vink_available_balance (+ reserve at auth) | Decided (D47, wallet-token-scoped authorization); real-time auth webhook decision logic unchanged from today's VinkIn-owns-the-merchant-decision model (§17) |
| 5 | Merchant settles through the network; VinkIn reconciles settlement vs. funded amount, disables the card, revokes the wallet token, returns the card to the pool only once the token is confirmed revoked | reconciliation entries; over-settlement → organizer receivable, unchanged from today | Decided (D47); card-return-after-token-revocation is the load-bearing security property RM1/RM5 must prove |

## The liquidity question — resolved by D47, not open

The original version of this document flagged hop 2→3 timing (provider-internal and
near-instant vs. riding bank rails, needing a pre-funded float) as the deciding architectural
question. **D47 resolves this**: VinkIn's own Stripe Financial Account is the funding source
for issuing directly — there is no separate "platform balance → issuing balance" transfer hop,
and no pre-funded float model, because captured participant money and card-spend funding are
the same account. What remains genuinely open is **measured timing** (how quickly a captured
PaymentIntent's funds are actually available in the Financial Account for issuing to draw on)
— that requires the real Financial Account to exist and be tested, not a design decision.

## Failure paths (always the mirror image)

- **Vink expires before reaching 100%** (7-minute maximum lifetime, D47): no card is ever
  assigned; every contribution already captured is refunded automatically — a real refund API
  call per contributor, not a hold release, since hop 1 already captured the money.
- **Card assigned but organizer never completes the purchase** (separate 10-minute card usage
  window, D47): the card is disabled, contributors are refunded, and the card returns to the
  pool once the refund process completes.
- **Merchant never charges the card at all**: same as above — refund + return to pool.
- **Merchant settles above the funded amount** (e.g., tip): merchant is paid in full by the
  network; the delta becomes an organizer obligation charged to their backup payment method —
  participants are never charged beyond their approved maximum (unchanged from today).
- **Participant dispute**: manual review through the Operations Console (D47) — a new,
  narrowly scoped, fully audited operator-triggered refund route (RM6), not the automatic paths
  above.

## Still pending real evidence (gate conditions this document alone does not close)

- Real measured timings for hops 1–3 (needs the real Financial Account, not sandbox-shaped
  mock data).
- Stripe's own written confirmation this funds flow is supportable at VinkIn's proposed scale
  (gate condition #1) — this document is VinkIn's own proposal, not a provider response.
- KYC/AML responsibility for a VinkIn-owned Financial Account funded by many participants'
  cards (gate condition #5) — a real open question this architecture surfaces, not answered by
  D47.
