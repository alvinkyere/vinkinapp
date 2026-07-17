# VinkIn — Proposed Funds Flow

_Canonical funds-flow document (gate condition 3). Shared with providers and counsel; the
internal ledger mapping stays in sync with `docs/architecture/04-database-schema.md`.
Update this file with real account names and measured timings once a stack is chosen._

## Diagram

```text
 (1) charge                    (2) platform funds            (3) issuing funds
PARTICIPANT ──────► ACQUIRING/PAYMENTS ──────► PLATFORM ACCOUNT ──────► ISSUING BALANCE
card / wallet        (collection provider)     (FBO-style pooled)        (funds card spend)
                                                                              │
                                                                              │ (4) temp virtual card auth
                                                                              ▼
                                        MERCHANT ◄────── CARD NETWORK ◄── TEMPORARY CARD
                                            (5) normal settlement — one payment
```

## Hop-by-hop

| Hop | What happens | Internal ledger posting (Spec §26) | Must be confirmed |
|---|---|---|---|
| 1 | Participant authorizes their share; VinkIn captures the base amount when the session succeeds (auth is released if it fails) | DR processor_clearing / CR participant_contribution_liability | manual capture, wallet support, auth-hold duration, partial capture |
| 2 | Captured funds become platform balance | DR platform_fbo_cash / CR processor_clearing (fees expensed separately) | **balance availability timing — before standard payout schedules?** |
| 3 | Balance funds the issuing program | DR issuing_balance / CR platform_fbo_cash | transfer latency and minimums; auto-funding |
| 4 | Temporary card authorized at the merchant; VinkIn approves/declines in real time | DR vink_purchase_expense / CR vink_available_balance (+ reserve at auth) | real-time auth webhook, decision deadline, default behavior on timeout |
| 5 | Merchant captures through the network; VinkIn reconciles settlement vs. funded amount | reconciliation entries; over-settlement → organizer receivable | capture-vs-auth variance visibility (tips), settlement reporting |

## The liquidity question (decides architecture)

If hop 2→3 is provider-internal and near-instant, participant money can fund the card within
the at-register session. If it rides bank rails (multi-provider stacks), VinkIn must
**pre-fund a float** in the issuing account and treat participant captures as replenishment —
which changes reserve sizing, risk limits, and the provider questionnaire's prefunding
questions. Sandbox test S1 measures this; the answer gets recorded here.

## Failure paths (always the mirror image)

- Session fails before funding: authorizations canceled (released), captures refunded — hops
  1–2 reverse, nothing reaches hop 3.
- Merchant never charges the card: card expires/closes, pooled funds refunded to participants.
- Merchant settles above the funded amount (e.g., tip): merchant is paid in full by the
  network; the delta becomes an organizer obligation charged to their backup payment method —
  participants are never charged beyond their approved maximum.
