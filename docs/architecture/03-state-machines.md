# 03 — State-Machine Definitions (canonical vocabulary, D11 as amended)

**The state names below are the canonical, system-wide vocabulary** — the same names as
`packages/domain` (which is the source of truth; this document adapts to the code, never the
reverse). The pre-PV vocabulary that earlier revisions of this document used (`READY`/`LIVE`,
`EVALUATING`/`PROVIDER_RECONCILIATION`, `SPEND_PREPARATION`/`SPEND_READY`/`CARD_ACTIVE`,
`SETTLEMENT_MONITORING`, …) is **retired**; a mapping appendix is kept at the bottom for
reading older documents. Ratified by the owner 2026-07-17 (D11 amendment).

Conventions (binding, unchanged):

- **Guard** must hold inside the same PostgreSQL transaction that performs the transition,
  with the aggregate row locked `FOR UPDATE` (Spec §17/§27; Plan §11).
- **D12:** every transition atomically emits the domain event named in its table row — the
  state write and the outbox insert commit in one transaction (Plan §12). No silent
  transitions; the code makes them unrepresentable (`transitionVink` returns `{to, emits}`).
- **D13:** transitions execute only inside application commands (validate → load aggregate →
  transition → emit → return). No transport touches state directly.
- Every transition writes a `*_state_history` row (actor, reason, correlation id).
- Illegal transitions are errors, never no-ops — a rejected transition is evidence of a race
  or a bug and must be visible (Spec §37).

## 1. Vink session (Plan §8; `packages/domain/src/vink-state-machine.ts`)

Persisted on `vinks.state`. Timer boundaries are DB timestamps; workers act on
`now() >= boundary`, never on client input (Plan §10).

| From | Event | To | Emits |
|---|---|---|---|
| DRAFT | VINK_OPENED | OPEN | VinkOpened |
| OPEN | ORGANIZER_CANCELLED | CANCELLED | VinkCancelled |
| OPEN | SUBMISSION_DEADLINE_REACHED | SUBMISSIONS_CLOSED | SubmissionsClosed |
| OPEN | ALL_CONTRIBUTIONS_AUTHORIZED | SUBMISSIONS_CLOSED | SubmissionsClosed |
| SUBMISSIONS_CLOSED | PROCESSING_GRACE_STARTED | PROCESSING_GRACE | ProcessingGraceStarted |
| PROCESSING_GRACE | FUNDING_CONFIRMED | FUNDED | VinkFunded |
| PROCESSING_GRACE | FUNDING_FAILED | EXPIRED | VinkExpired |
| FUNDED | CARD_PROVISIONING_STARTED | CARD_PROVISIONING | TemporaryCardRequested |
| CARD_PROVISIONING | CARD_ISSUED | CARD_READY | TemporaryCardIssued |
| CARD_PROVISIONING | CARD_PROVISIONING_FAILED | FUNDING_REVERSAL | TemporaryCardFailed |
| FUNDING_REVERSAL | FUNDING_REVERSAL_COMPLETED | EXPIRED | VinkExpired |
| CARD_READY | MERCHANT_AUTHORIZATION_APPROVED | PURCHASE_AUTHORIZED | MerchantAuthorizationApproved |
| PURCHASE_AUTHORIZED | PURCHASE_CAPTURED | SETTLING | PurchaseCaptured |
| PURCHASE_AUTHORIZED | AUTHORIZATION_REVERSED | CARD_READY | MerchantAuthorizationReversed |
| SETTLING | SETTLEMENT_MATCHED | COMPLETED | VinkCompleted |
| SETTLING | SETTLEMENT_OVERAGE_DETECTED | RECOVERY_REQUIRED | SettlementVarianceDetected |
| RECOVERY_REQUIRED | RECOVERY_STARTED | RECOVERY_PENDING | RecoveryObligationCreated |
| RECOVERY_PENDING | RECOVERY_RESOLVED | COMPLETED | VinkCompleted |
| RECOVERY_PENDING | RECOVERY_DEFAULTED | RESTRICTED | OrganizerRestricted |

Terminal: **COMPLETED, CANCELLED, EXPIRED, RESTRICTED** (no outgoing transitions; a session
that expired cannot reopen — journey E6).

**The single-resolver rule (D5, unchanged):** exactly one code path (the session resolver)
may fire FUNDING_CONFIRMED / FUNDING_FAILED. Expiry worker and provider-event processor both
invoke it; it takes `SELECT … FOR UPDATE` on the vink row, re-reads the funding projection,
and decides FUNDED/EXPIRED exactly once. Anything arriving after the decision affects only
contribution-level cleanup, never the decision.

## 2. Contribution (Plan §9; `packages/domain/src/contribution-state-machine.ts`)

| From | Event | To | Emits |
|---|---|---|---|
| CREATED | AUTHORIZATION_STARTED | AUTHORIZATION_PENDING | ContributionAuthorizationStarted |
| AUTHORIZATION_PENDING | AUTHORIZATION_APPROVED | AUTHORIZED | ContributionAuthorized |
| AUTHORIZATION_PENDING | AUTHORIZATION_DECLINED | DECLINED | ContributionDeclined |
| AUTHORIZATION_PENDING | PROVIDER_RESULT_UNKNOWN / AUTHORIZATION_TIMED_OUT | RESOLUTION_PENDING | ContributionResolutionRequired |
| AUTHORIZED | SESSION_FUNDED | CAPTURE_PENDING | ContributionCaptureStarted |
| AUTHORIZED | PARTICIPANT_EXITED / SESSION_EXPIRED | CANCELLATION_PENDING | ContributionCancellationStarted |
| CAPTURE_PENDING | CAPTURE_SUCCEEDED | CAPTURED | ContributionCaptured |
| CAPTURE_PENDING | CAPTURE_RESULT_UNKNOWN | RESOLUTION_PENDING | ContributionResolutionRequired |
| CANCELLATION_PENDING | CANCELLATION_SUCCEEDED | CANCELLED | ContributionCancelled |
| CANCELLATION_PENDING | CANCELLATION_RESULT_UNKNOWN | RESOLUTION_PENDING | ContributionResolutionRequired |
| RESOLUTION_PENDING | RESOLVED_AUTHORIZED / _DECLINED / _CAPTURED / _CANCELLED | AUTHORIZED / DECLINED / CAPTURED / CANCELLED | ContributionAuthorized / ContributionDeclined / ContributionCaptured / ContributionCancelled |
| CAPTURED | PURCHASE_SETTLED | SETTLED | ContributionSettled |
| CAPTURED | REFUND_REQUIRED | REFUND_PENDING | RefundRequested |
| REFUND_PENDING | REFUND_SUCCEEDED | REFUNDED | RefundCompleted |
| REFUND_PENDING | REFUND_FAILED | REFUND_FAILED | RefundFailed |
| REFUND_FAILED | REFUND_RETRIED | REFUND_PENDING | RefundRequested |

Terminal: **DECLINED, CANCELLED, SETTLED, REFUNDED**. DECLINED is terminal per contribution —
a retry is a NEW contribution with the next attempt number in its idempotency key (Plan §11).
`RESOLUTION_PENDING` exits only via the resolve-pending-contribution job (Plan §10), which
decides from the provider's true recorded outcome — never from event arrival order (Spec §28).

Ledger postings: AUTHORIZED posts nothing (no money moved — exposure only); CAPTURED posts
the Plan §18 capture pair; CANCELLED posts nothing; REFUNDED posts the reversal pair.
Invariant: `captured ≤ maximum_approved_amount` (Spec §4.7; `assertWithinApprovedMaximum`).

## 3. TemporaryCard (Plan §7; `entities.ts` `TemporaryCardStatus`)

```text
REQUESTED → ACTIVE → CLOSED
     └────→ FAILED   (issuance failure → vink takes CARD_PROVISIONING_FAILED)
```

Merchant locking lives on the vink (`merchant_lock_status`) and the card
(`merchant_lock_key`), set in the same transaction as the first approved merchant
authorization (Plan §11 row-lock list). Guards: a card is issued only from a FUNDED vink
inside the card-issuance transaction; `spending_limit = funded amount` under EXACT_FINAL
(Plan §16); CLOSED only after the settlement window closes (close-settlement-window job,
Plan §10) — never immediately after the first authorization. Display carries
`display_last_four` only; no PAN/CVV column exists (schema proposal §5).

## 4. Merchant authorization decision (evaluated inside one DB transaction)

A decision procedure recorded as an immutable `purchase_authorizations` row, not a persistent
machine:

```text
lock card FOR UPDATE → load prior authorizations FOR UPDATE
→ dedupe on provider_authorization_id (duplicate request → same recorded decision, E4)
→ checks, in order: vink.state = CARD_READY (first auth) or PURCHASE_AUTHORIZED re-presentment rules
                    merchant lock: unlocked, or same merchant_lock_key
                    amount ≤ spending_limit and policy variance rules (Plan §16)
→ APPROVE: insert row, vink → PURCHASE_AUTHORIZED (MerchantAuthorizationApproved), set lock
→ DECLINE: insert row with reason (MerchantAuthorizationDeclined) — never block on a human
```

## 5. Production-track machines (unchanged; outside the PV vocabulary's scope)

FinancialAccount (§3.1), RecoveryObligation retry ladder (§23), and ReimbursementRequest
(§24) keep their Spec-derived definitions from the previous revision of this document; they
concern M2/M8+ aggregates the PV build does not yet model. When the PV track reaches them
(PV7), their vocabularies are normalized the same way and this section is replaced.
Interim summaries:

- **FinancialAccount:** PENDING_VERIFICATION → ACTIVE → ORGANIZER_ELIGIBLE ↔
  ADJUSTMENT_PENDING → RECOVERY_REQUIRED → RESTRICTED; RESTRICTED retains §3.1 allowed
  actions (join/contribute/refunds) and blocks create/control/start.
- **RecoveryObligation:** CREATED → PENDING (funds applied, charging, retries with backoff)
  → RESOLVED | DEFAULTED (restrict account, support case) — domain enum
  `RecoveryObligationStatus`; the §23 retry ladder details land in PV7.
- **ReimbursementRequest:** states verbatim from §24 (M8+; not in the PV build).

## 6. Idempotent transition rule (applies to all machines, unchanged)

Worker/event handlers must be written as `UPDATE … SET state = :to WHERE id = :id AND
state = :from` (or the equivalent optimistic check under the row lock). Zero rows updated ⇒
the transition already happened or a race was lost ⇒ log + re-read + decide; never
blind-write. Provider events are marked processed in the same transaction (Spec §28).

## Appendix — retired vocabulary mapping (for reading pre-2026-07-17 documents)

| Retired (old doc 03) | Canonical (D11) |
|---|---|
| READY, LIVE | OPEN (post-open lifecycle collapses into OPEN until submissions close) |
| SUBMISSIONS_CLOSED → EVALUATING / PROVIDER_RECONCILIATION | SUBMISSIONS_CLOSED → PROCESSING_GRACE (single resolver decides out of PROCESSING_GRACE) |
| SPEND_PREPARATION, SPEND_READY | CARD_PROVISIONING |
| CARD_ACTIVE, DISPLAYABLE | CARD_READY |
| PURCHASE_AUTHORIZATION_PENDING, MERCHANT_LOCKED | PURCHASE_AUTHORIZED (+ `merchant_lock_status`) |
| SETTLEMENT_MONITORING | SETTLING |
| ADJUSTMENT_PENDING (vink-level) | RECOVERY_REQUIRED |
| RELEASE_OR_REFUND, DISPERSED | EXPIRED (+ contribution-level CANCELLATION/REFUND machines) |
| CANCELED (spelling) | CANCELLED |
