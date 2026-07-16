# 03 — State-Machine Definitions

Transition tables for every stateful aggregate. Conventions:

- **Guard** must hold inside the same PostgreSQL transaction that performs the transition,
  with the aggregate row locked `FOR UPDATE` (§17, §27).
- **Effects** = ledger postings + outbox events, same transaction (§27, §29).
- Every transition writes a `*_status_history` row (actor, reason, correlation id).
- Illegal transitions are errors, never no-ops — a rejected transition is evidence of a race
  or a bug and must be visible (§37).

## 1. Vink session (§13, §14)

Persisted on `vinks.status`. Timer boundaries are DB timestamps; workers act on
`now() >= boundary`, never on client input (§10.3).

| From | Event / trigger | Guard | To | Effects |
|---|---|---|---|---|
| DRAFT | organizer completes config | validation passes | READY | — |
| READY | organizer taps Start | organizer still eligible; risk pass (§36) | LIVE | write §10.3 timestamps; VinkStarted; invitations active |
| LIVE | now ≥ submissions_close_at − 15s | — | SUBMISSIONS_CLOSED | reject **new** attempts (in-flight continue); VinkSubmissionsClosed |
| SUBMISSIONS_CLOSED | resolver runs at close | **no unresolved attempts** | EVALUATING | — (fast path; same resolver code as grace path) |
| SUBMISSIONS_CLOSED | resolver runs at close | unresolved attempts exist | PROCESSING_GRACE | VinkProcessingGraceStarted |
| PROCESSING_GRACE | now ≥ processing_grace_expires_at | — | PROVIDER_RECONCILIATION | resolver fetches unresolved provider objects **directly** (§14) — decides by provider object state/timestamps, not webhook arrival |
| EVALUATING / PROVIDER_RECONCILIATION | funding decision | secured funding == required funding (ledger projection, not client) | FUNDED | VinkFunded |
| EVALUATING / PROVIDER_RECONCILIATION | funding decision | funding short at deadline | EXPIRED | VinkExpired; cancel unresolved attempts |
| FUNDED | card pipeline (§16 checklist) | eligibility+risk+liquidity recheck pass | SPEND_PREPARATION → SPEND_READY → CARD_ACTIVE | issue/activate card; controls; TemporaryCardIssued |
| CARD_ACTIVE | first merchant auth webhook | §17 decision approves | PURCHASE_AUTHORIZATION_PENDING → MERCHANT_LOCKED | ledger reserve; hide card; MerchantAuthorizationApproved, MerchantLocked |
| MERCHANT_LOCKED | capture/settlement events | — | SETTLEMENT_MONITORING | MerchantCaptureReceived |
| SETTLEMENT_MONITORING | clearing window ends | settled ≤ funded (+approved slippage per §20) | COMPLETED | close provider card; VinkCompleted |
| SETTLEMENT_MONITORING | settled > funded | — | ADJUSTMENT_PENDING | SettlementAdjustmentCreated (§22) |
| ADJUSTMENT_PENDING | recovery flow (§23) | — | RECOVERY_PENDING → COMPLETED | RecoverySucceeded/Failed |
| EXPIRED | disperse worker | all releases/refunds resolved | RELEASE_OR_REFUND → DISPERSED | cancel auths first, refund captures only (§25); VinkDispersed |
| DRAFT/READY/LIVE | organizer cancels | no unresolved-unsafe member states | CANCELED | release/refund as needed |
| any | risk/support intervention | authority check | MANUAL_REVIEW / SUSPENDED / DISPUTED / FAILED | audit log |

**The single-resolver rule (§14):** exactly one code path ("session resolver") may move a Vink
out of {SUBMISSIONS_CLOSED, PROCESSING_GRACE, EVALUATING, PROVIDER_RECONCILIATION}. Both the
expiry worker and the webhook processor invoke it; it takes `SELECT … FOR UPDATE` on the vink
row, re-reads the funding projection, and makes the FUNDED/EXPIRED decision exactly once.
A webhook that lands after the decision affects only attempt-level cleanup (late capture →
refund path), never the decision.

## 2. ContributionSlot (§11)

Membership states (INVITED/JOINED and guest link tracking) live on `vink_members`; slots are
purely financial and start at PAYMENT_NOT_STARTED (gap note §2.3.2 in doc 00).

| From | Trigger | Guard | To |
|---|---|---|---|
| PAYMENT_NOT_STARTED | attempt created | vink LIVE (or ≥T−15s in-flight rule); amount matches current split version | AUTHENTICATING |
| AUTHENTICATING | wallet/3DS handoff begins | — | PROCESSING |
| PROCESSING | provider result/webhook: authorized | provider object confirms; §12 idempotent | AUTHORIZED |
| PROCESSING | definitive decline | — | FAILED (new attempt allowed while LIVE → back to PROCESSING with gen+1) |
| AUTHORIZED | vink FUNDED → capture command | capture ≤ authorized max; §12 capture key | CAPTURE_PENDING → CAPTURED |
| AUTHORIZED | vink EXPIRED/CANCELED | — | RELEASE_PENDING → RELEASED |
| CAPTURED | vink fails post-capture / dispersal | — | REFUND_PENDING → REFUNDED |
| CAPTURED | provider dispute webhook | — | DISPUTED |
| PAYMENT_NOT_STARTED / FAILED | member removed (§15 safe list) | not in unsafe states | CANCELED |

Ledger postings: AUTHORIZED posts nothing (no money moved) — tracked as exposure only;
CAPTURED posts §26 "contribution capture" + allocation; RELEASED posts nothing; REFUNDED posts
reversal pair. Slot invariant: `captured_total ≤ maximum_amount_minor` (Principle §4.7).

## 3. TemporaryCard

```text
REQUESTED → ISSUED → CONTROLS_APPLIED → DISPLAYABLE → MERCHANT_LOCKED
   → SETTLEMENT_HOLD (remains authorizable for same-merchant captures/reversals/refunds, §18)
   → CLOSED
plus: FROZEN (organizer/support, from DISPLAYABLE or MERCHANT_LOCKED, reversible)
      CANCELED (vink failed before first auth)
```

Guards: DISPLAYABLE requires §16 checklist and a provider-hosted display session with biometric
re-auth (§35); MERCHANT_LOCKED set in the same transaction as the first approved
`authorization_decision` (§17/§18); CLOSED only after `settlement_monitoring` window
(config, default 7 days after last capture activity) — never immediately after first auth (§18).

## 4. Authorization decision (per §17, evaluated inside one DB txn)

Not a persistent state machine — a decision procedure recorded as an immutable row:

```text
lock card FOR UPDATE → load active auths FOR UPDATE
→ classify: duplicate-retry | reversal-retry | incremental | partial | related | unrelated (§17)
→ checks, in order: card state ∈ {DISPLAYABLE, MERCHANT_LOCKED(same merchant)}
                    MCC policy-family compatible (§19)
                    cumulative_authorized + amount ≤ policy limit (incl. slippage/tip max §20/§21)
                    velocity/risk (§36)
→ APPROVE: insert decision, post ledger reserve, update cumulative, maybe set MERCHANT_LOCKED
→ DECLINE: insert decision with reason code, notify organizer (§19) — never block awaiting human
```

## 5. FinancialAccount (§3.1)

| From | Trigger | To |
|---|---|---|
| PENDING_VERIFICATION | contact verified + terms | ACTIVE (CONTRIBUTION_ONLY capability) |
| ACTIVE | KYC passed + recovery method valid | ORGANIZER_ELIGIBLE |
| ORGANIZER_ELIGIBLE | settlement adjustment created | ADJUSTMENT_PENDING |
| ADJUSTMENT_PENDING | recovery success | ORGANIZER_ELIGIBLE |
| ADJUSTMENT_PENDING | recovery retries exhausted | RECOVERY_REQUIRED → RESTRICTED |
| RESTRICTED | obligations settled | ORGANIZER_ELIGIBLE (via risk review) |
| any | risk/compliance action | SUSPENDED / CLOSED |

RESTRICTED retains §3.1 allowed actions (join/contribute/refunds); blocks create/control/start.

## 6. RecoveryObligation (§23)

```text
CREATED → FUNDS_APPLIED (vink residual funds first) → CHARGING → SETTLED
                                        │                  │
                                        ▼                  ▼ (retry policy: e.g. 3 attempts, backoff 1d/3d/7d)
                                   NOTIFIED           RETRY_SCHEDULED → CHARGING
                                                           │ exhausted
                                                           ▼
                                                   DEFAULTED → (restrict account, support case, reserve absorbs)
```

## 7. ReimbursementRequest (§24)

States verbatim from §24. Key guards: `ACCEPTED → PAYMENT_PROCESSING` uses the payer's own
idempotent operation id; `REALLOCATION_PROPOSED` creates a new allocation version and
supersedes the old request (`SUPERSEDED`); any increased member amount requires that member's
explicit `ACCEPTED` on the new version; exactly one reminder allowed; terminal states:
PAID, DECLINED+CLOSED_UNPAID, EXPIRED, CANCELED.

## 8. Idempotent transition rule (applies to all machines)

Webhook/worker handlers must be written as: `UPDATE … SET status = :to WHERE id = :id AND
status = :from` (or equivalent optimistic check under the row lock). Zero rows updated ⇒ the
transition already happened or a race was lost ⇒ log + re-read + decide; never blind-write.
Provider events are marked processed in the same transaction (§28).
