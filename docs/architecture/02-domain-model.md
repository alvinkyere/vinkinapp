# 02 — Domain Model

Bounded contexts, aggregates, and invariants for the modular monolith (§6, §7). Each context is
one NestJS module and owns its tables (§30 grouping). Cross-context reactions are outbox events
(§29) — never direct table writes.

## 1. Context map

```text
Identity ──► Accounts ──► Vinks ──► Contributions ──► Payments(orchestrator)
                              │            │                │
                              ▼            ▼                ▼
                            Cards ◄── Ledger (posts for everyone; owns truth)
                              │
                              ▼
                         Settlement ──► Recovery ──► Reimbursements
                                             │
Risk (reads everything, gates commands)      ▼
Reconciliation (provider ⇄ ledger diff)   Refunds
```

## 2. Aggregates and their invariants

### Identity
- **User** (users, sessions, devices, verifications, consents).
- Invariants: verified contact before any financial action; consent versions recorded.

### Accounts
- **FinancialAccount** — 1:1 with User; §3.1 states; owns linked/recovery payment methods and
  organizer eligibility.
- Invariants: state transitions per `03-state-machines.md` §5; organizer-gated commands check
  `ORGANIZER_ELIGIBLE` + no unresolved `recovery_obligations` (§10.1, §23); a `RESTRICTED`
  account can contribute/receive refunds but never create Vinks or control cards (§3.1).

### Vinks
- **Vink** — root for session, members, invitations, split versions, receipts.
- Invariants:
  - Session timestamps (§10.3) are server-written only; client time never authoritative.
  - Split versions are immutable and append-only; allocations of version N never mutate (§15).
  - `sum(allocations of current version) == vink total` (largest-remainder rounding, organizer
    absorbs residual — flagged G7).
  - Member removal only from safe states (§15 list).
  - Exactly-once FUNDED/EXPIRED decision under row lock (§14).

### Contributions
- **ContributionSlot** — per member per Vink; carries `base_amount_minor`,
  `maximum_amount_minor`, `split_version` (§11).
- **ContributionAttempt** — child; `attempt_generation` monotonic.
- Invariants:
  - At most one active-or-successful attempt per slot (partial unique index).
  - A participant's captured total can never exceed the maximum they approved (§4.7) —
    enforced at capture-command level *and* by ledger check.
  - Slot amounts change only by re-approval against a new split version (§15).

### Payments (orchestrator + policy engine)
- No aggregate of its own; coordinates provider calls with stable operation identities (§12)
  and interprets `payment-policies` (§5): category → policy family → card controls + exposure
  math. Owns `idempotency_operations`.

### Ledger
- **LedgerTransaction** (+entries) — append-only, balanced, integer minor units (§26).
- Invariants: debits == credits per transaction (deferred DB trigger); posted rows immutable
  (DB trigger + no UPDATE grants); corrections are reversals; every posting carries
  `operation_id` unique per scope; provider events post at most once.

### Cards
- **TemporaryCard** — 1:1 with a funded Vink (§3.2); owns controls, display sessions,
  authorizations, decisions.
- **AuthorizationDecision** — one row per provider auth webhook, approve/decline + reason.
- Invariants: issue only when §16 checklist passes; decisions made inside a DB transaction
  holding `SELECT … FOR UPDATE` on the card (§17); cumulative authorized ≤ policy limit;
  merchant lock after first approval (§18); MCC policy-family compatibility (§19); card never
  closed before merchant-clearing window ends (§18).

### Settlement
- **MerchantSettlement** / **PurchaseAdjustment** — captures vs. funded amount; classifies §22
  adjustment + responsibility types.
- Invariant: over-funded settlement always produces an adjustment record — never silently
  spread across participants (§20).

### Recovery
- **RecoveryObligation** — organizer debt; retry policy; restrictions on failure (§23).

### Reimbursements
- **ReimbursementRequest** + allocation versions (§24). Invariants: every reallocation is a new
  version; added member exposure requires that member's explicit approval; no recursive
  auto-charging.

### Refunds
- **Refund** / disbursements (§25). Invariant: prefer auth-release over charge-then-refund;
  user-facing status never claims money moved before the provider confirms (§25).

### Risk
- **RiskEvent**s + limit evaluation (§36 inputs). Pure command-gate: other contexts ask
  `risk.evaluate(command)` synchronously; risk never mutates their state.

### Reconciliation
- **ReconciliationRun/Item** — daily provider-object sweep vs. ledger (§28, §37).

## 3. Domain events (§29 list, owned by `packages/domain-events`)

Producer → event → typical consumers:

| Producer | Events | Consumers |
|---|---|---|
| Vinks | VinkStarted, VinkSubmissionsClosed, VinkProcessingGraceStarted, VinkFunded, VinkExpired, VinkDispersed, VinkCompleted | Notifications, Cards (issue on Funded), Refunds (on Expired), Analytics |
| Contributions | ContributionAuthorized/Captured/Failed | Vinks (funding projection), Notifications, Risk |
| Cards | TemporaryCardIssued, MerchantAuthorizationApproved/Declined, MerchantLocked, MerchantCaptureReceived | Settlement, Notifications, Risk |
| Settlement | SettlementAdjustmentCreated | Recovery, Notifications |
| Recovery | RecoverySucceeded/Failed | Accounts (restrictions), Notifications, Risk |

Event payloads are versioned zod schemas; events are facts (past tense), carry ids + minor-unit
amounts, never derived UI strings.

## 4. Shared kernel (`packages/shared-types`)

- `Money`: `{ amountMinor: bigint-safe integer, currency: 'USD' }` — no floats anywhere (§26).
- Branded ids: `VinkId`, `ContributionSlotId`, `OperationId`, …
- `OperationIdentity` builders implementing §12 formats
  (`authorize:v1:{slotId}:{gen}`, `capture:v1:{slotId}:{gen}`, `refund:v1:{refundId}`,
  `issue-card:v1:{vinkId}`).

## 5. Purchase-destination seam (§42)

`Vink` references a `PurchaseDestination` interface with today's single implementation
`TemporaryCardPurchaseDestination`. Settlement/adjustment logic keys off destination-neutral
events (`PurchaseAuthorized`, `PurchaseSettled`) so `MerchantAPIOrderDestination` etc. can be
added without touching the Vink state machine.
