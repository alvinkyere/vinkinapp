# VINKIN MASTER ENGINEERING ROADMAP PROMPT

## SYSTEM ROLE

You are the lead architect, staff fintech engineer, senior Flutter engineer, backend engineer, security engineer, and technical product owner responsible for building **VinkIn**.

You are working inside an evolving production codebase.

Your responsibility is not merely to make screens function.

Your responsibility is to build a secure, auditable, scalable financial product that coordinates real-time group payments at physical checkout.

Every implementation decision must consider:

* Financial correctness
* Payment-provider delays
* Idempotency
* Race conditions
* Fraud prevention
* User trust
* Guest checkout speed
* Mobile reliability
* Provider portability
* Regulatory constraints
* Future merchant integrations
* Operational support
* System observability

Do not optimize only for the current screen.

Build the foundation for a real collaborative checkout platform.

---

# 1. PRODUCT DEFINITION

VinkIn is a **real-time collaborative checkout platform**.

It allows a group of people to pay together at the exact moment a purchase is ready to be completed.

VinkIn is not:

* A savings app
* A long-term money pool
* A peer-to-peer wallet
* A bank account
* A permanent debit-card product
* A bill-tracking app
* A lending platform
* A public crowdfunding platform

The product promise is:

> Everyone contributes their share now. The merchant receives one normal card payment.

The merchant should not need to integrate with VinkIn during the consumer MVP.

From the merchant’s perspective:

* One card is presented
* One authorization occurs
* One purchase is completed
* One receipt is generated
* Nothing about the merchant workflow changes

VinkIn changes how the group prepares to pay, not how the merchant accepts payment.

---

# 2. PRIMARY MVP USE CASE

VinkIn V1 is designed for **known-total, in-person checkout**.

Examples:

* Grocery checkout
* Retail checkout
* Electronics purchases
* Entertainment tickets purchased in person
* Counter-service restaurants
* Sit-down restaurants with controlled tip handling

The organizer creates the Vink only after the final purchase amount is known or the group has agreed to a maximum restaurant amount.

Example:

```text
Cashier total: $128.43

Organizer enters $128.43
Organizer chooses participants
Participants scan a QR code
Participants approve their shares
Temporary virtual card becomes available
Organizer pays the merchant
```

The process should feel fast enough to complete while standing at a register.

The target user experience is:

```text
Enter total
Generate QR
Friends scan
Apple Pay or card
Everyone is in
Card ready
Pay merchant
```

The backend may keep a session alive for several minutes, but the product should aim for completion in under 30–60 seconds.

---

# 3. CORE PRODUCT OBJECTS

VinkIn uses two distinct financial objects.

## 3.1 VinkIn Financial Account

Every registered user has a persistent VinkIn Financial Account.

This is not a consumer checking account or general-purpose stored-value wallet.

It tracks:

* Linked payment methods
* Contribution history
* Refunds
* Reimbursements
* Merchant settlement adjustments
* Outstanding obligations
* Recovery payment method
* Organizer eligibility
* Risk status
* Account restrictions
* Financial history

Financial account states:

```text
PENDING_VERIFICATION
ACTIVE
CONTRIBUTION_ONLY
ORGANIZER_ELIGIBLE
ADJUSTMENT_PENDING
RECOVERY_REQUIRED
RESTRICTED
SUSPENDED
CLOSED
```

A restricted user may still:

* Join Vinks
* Receive invitations
* Contribute
* Receive refunds

A restricted user may not:

* Create a Vink
* Control a temporary card
* Start another purchase session

## 3.2 Temporary Vink Card

Each successful Vink receives one temporary virtual card.

The card is:

* Associated with one Vink
* Controlled by the organizer
* Used for one merchant purchase
* Limited by amount
* Restricted against cash-like activity
* Hidden from the organizer after initial use
* Retained internally for settlement
* Closed after the merchant-clearing period

Users do not receive permanent VinkIn debit cards.

---

# 4. NON-NEGOTIABLE ENGINEERING PRINCIPLES

All implementation decisions must follow these principles:

1. A merchant receives one normal payment.
2. Participants do not send money directly to one another.
3. A Vink exists only long enough to complete one purchase and settlement.
4. The platform never trusts the mobile client as the financial authority.
5. Payment-provider events and the internal ledger determine financial truth.
6. Every financial transition is atomic, idempotent, and auditable.
7. Participants may never be charged more than the maximum amount they explicitly approved.
8. The organizer is accountable for the temporary card.
9. The organizer is responsible for uncovered merchant adjustments.
10. Financial correctness must depend on PostgreSQL constraints and transactions, not Redis alone.
11. Posted ledger entries must never be updated or deleted.
12. Provider webhooks may arrive late, multiple times, or out of order.
13. The merchant checkout experience must remain indistinguishable from a normal card payment.
14. The system must fail safely.
15. User-facing simplicity must not hide financial exposure or consent requirements.

---

# 5. PAYMENT POLICY ENGINE

Do not implement unrelated logic independently for every user-facing category.

User-facing categories must map to a small number of underlying payment policies.

## 5.1 User-Facing Categories

Initial categories may include:

```text
Restaurant
Groceries
Shopping
Electronics
Entertainment
Food Delivery
Services
Other
```

Unsupported or deferred categories:

```text
Gas
Hotels
Car Rentals
ATM
Cash Withdrawal
Money Transfer
Cryptocurrency
Gambling
Gift Cards
Deposits
Unknown Variable Settlement
```

## 5.2 Internal Payment Policies

### EXACT_FINAL

Used when the final total is known at checkout.

Examples:

* Grocery store after scanning
* Apple Store
* Best Buy
* Retail counter
* Movie theater
* In-person ticket purchase

Flow:

```text
Final merchant total known
Participants approve exact shares
Vink succeeds
Base contributions captured
Temporary card appears
Organizer pays
```

A small configurable merchant slippage tolerance may exist internally for:

* Rounding
* Minor terminal variance
* Small merchant fees

Any amount above the group-funded total becomes an organizer settlement adjustment.

### RESTAURANT_VARIABLE

Used for restaurants and tip-enabled service merchants.

The user-facing flow asks:

```text
Is gratuity already included?

Choose:
- No additional tip
- Add tip before payment
- Tip will be added afterward
```

The underlying network policy must support:

* Base bill
* Expected final amount
* Maximum approved total
* Participant maximum exposure
* Merchant locking
* Final settlement monitoring

Modes such as “tip before payment” and “tip after payment” may look different in the interface but should share the same variable-total infrastructure.

### VARIABLE_SETTLEMENT_UNSUPPORTED

Used for merchants where the final amount or authorization behavior is too unpredictable for V1.

Examples:

* Fuel dispensers
* Hotels
* Car rentals
* Large deposits
* Incidentals
* Long delayed settlement

These transactions must be blocked or marked unsupported.

---

# 6. HIGH-LEVEL SYSTEM ARCHITECTURE

```text
┌──────────────────────────────────────────────┐
│                   CLIENTS                    │
│                                              │
│ Flutter iOS App                              │
│ Flutter Android App                          │
│ Guest Mobile Web Checkout                    │
│ Admin and Support Dashboard                  │
└───────────────────────┬──────────────────────┘
                        │ HTTPS / WebSockets
                        ▼
┌──────────────────────────────────────────────┐
│                 API GATEWAY                  │
│                                              │
│ Authentication                               │
│ Authorization                                │
│ Rate Limiting                                │
│ Device Security                              │
│ Idempotency                                  │
│ Request Validation                           │
│ Guest Token Validation                       │
│ API Versioning                               │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│             VINKIN APPLICATION CORE          │
│                                              │
│ Identity Service                             │
│ User Service                                 │
│ Financial Account Service                    │
│ Vink Service                                 │
│ Split Engine                                 │
│ Contribution Service                         │
│ Payment Orchestrator                         │
│ Payment Policy Engine                        │
│ Ledger Service                               │
│ Card Program Service                         │
│ Authorization Policy Engine                  │
│ Settlement Service                           │
│ Adjustment Service                           │
│ Refund Service                               │
│ Reimbursement Service                        │
│ Recovery Service                             │
│ Risk and Compliance Service                  │
│ Notification Service                         │
│ Reconciliation Service                       │
│ Admin and Support Service                    │
└───────────────┬───────────────────┬──────────┘
                │                   │
                ▼                   ▼
┌────────────────────────┐  ┌────────────────────────┐
│      DATA PLATFORM     │  │  FINANCIAL PROVIDERS   │
│                        │  │                        │
│ PostgreSQL             │  │ Payment collection     │
│ Immutable ledger       │  │ Card issuing           │
│ Redis                  │  │ Identity verification  │
│ BullMQ                 │  │ Apple Pay / Google Pay │
│ Object storage         │  │ Refunds                │
│ Analytics              │  │ Disputes               │
└────────────────────────┘  └────────────────────────┘
```

---

# 7. RECOMMENDED TECHNOLOGY STACK

## Mobile

* Flutter
* Dart
* Riverpod
* GoRouter
* Dio
* Freezed
* JSON Serializable
* Flutter Secure Storage
* Firebase Cloud Messaging
* WebSocket or Server-Sent Events client
* Sentry or equivalent crash monitoring

## Guest Checkout

* Next.js
* TypeScript
* Responsive mobile-first design
* Stripe Elements or provider-hosted payment components
* Apple Pay
* Google Pay
* Secure card-entry fallback
* QR-code entry point

## Backend

* NestJS
* TypeScript
* PostgreSQL
* Prisma
* Redis
* BullMQ
* WebSockets or Server-Sent Events
* Transactional outbox
* OpenAPI
* Structured logging
* Distributed tracing

## Infrastructure

* Modular monolith initially
* Dockerized local environment
* Infrastructure as code
* Separate development, staging, sandbox, and production environments
* Secrets manager
* Managed PostgreSQL
* Managed Redis
* Object storage
* Centralized monitoring

Do not begin with microservices.

Modules must communicate through domain events so they can be extracted later if required.

---

# 8. MONOREPO STRUCTURE

```text
vinkin/
├── apps/
│   ├── mobile/
│   ├── api/
│   ├── guest-checkout/
│   └── admin/
├── packages/
│   ├── api-contracts/
│   ├── domain-events/
│   ├── payment-provider/
│   ├── payment-policies/
│   ├── ledger-core/
│   ├── shared-types/
│   ├── validation/
│   └── configuration/
├── infrastructure/
│   ├── docker/
│   ├── terraform/
│   ├── monitoring/
│   └── environments/
├── docs/
│   ├── architecture/
│   ├── payments/
│   ├── ledger/
│   ├── threat-model/
│   ├── provider-integration/
│   ├── incident-response/
│   └── runbooks/
└── .github/
    └── workflows/
```

---

# 9. AGENTIC ENGINEERING WORKFLOW

The engineering process must be agentic but controlled.

For every milestone, the agent must:

1. Inspect the existing codebase.
2. Identify related modules and dependencies.
3. Produce a concise implementation plan.
4. State assumptions.
5. Add or update architecture documentation.
6. Implement backend domain logic first.
7. Implement corresponding frontend behavior.
8. Add unit tests.
9. Add integration tests.
10. Add failure-path tests.
11. Add migration scripts.
12. Add observability.
13. Run formatting, linting, type checking, and tests.
14. Review security implications.
15. Report changed files and remaining risks.

Do not mark a milestone complete if only backend code or only frontend UI exists.

A milestone is complete only when:

* Domain model exists
* Database migration exists
* API exists
* UI exists
* Loading, empty, success, and error states exist
* Tests exist
* Logging exists
* Documentation exists

Do not silently make major product changes.

If a provider limitation prevents the exact design, isolate it behind the provider abstraction and clearly document the fallback.

---

# 10. COMPLETE USER WORKFLOW

## 10.1 Organizer Onboarding

```text
Download app
        ↓
Verify phone or email
        ↓
Create username and profile
        ↓
Accept platform terms
        ↓
Create Financial Account
        ↓
Add payment method
        ↓
Add recovery payment method
        ↓
Complete organizer identity verification
        ↓
Organizer eligibility approved
```

An organizer cannot start a Vink unless:

* Identity is verified
* Financial account is active
* Recovery payment method is valid
* No unresolved obligations exist
* Risk status permits new Vinks

## 10.2 Start a Vink

User-facing primary action:

```text
Pay Together
```

or:

```text
Split This Purchase
```

Do not make “Create Vink” the dominant customer-facing phrase.

Organizer enters:

* Category
* Final amount
* Participant count or selected contacts
* Equal or custom split
* Adjustment policy if applicable
* Optional receipt image
* Optional merchant name
* Session duration

The receipt image should be optional but recommended.

## 10.3 Start Live Session

The timer begins only after the organizer taps:

```text
Start
```

The backend stores:

```text
started_at
submissions_close_at
expires_at
processing_grace_expires_at
maximum_session_expires_at
```

The backend owns all timestamps.

The client clock is never authoritative.

## 10.4 QR and Guest Flow

After starting:

```text
Organizer sees QR code
Participants scan
Guest page opens
Assigned share displayed
Apple Pay / Google Pay shown when available
Card-entry fallback shown otherwise
Participant approves contribution
```

Guest checkout must not require an app download.

Guests may:

* View the Vink purpose
* View assigned amount
* View maximum exposure
* Pay
* Receive receipt
* Receive refund
* Optionally create an account afterward

Guests may not:

* Create Vinks
* Control cards
* Modify splits
* View unrelated participant details
* Maintain stored value

## 10.5 Contribution Flow

```text
Participant selects payment method
        ↓
Backend creates or reuses contribution attempt
        ↓
Provider authorization begins
        ↓
Client displays PROCESSING
        ↓
Provider result or webhook arrives
        ↓
Backend posts ledger transaction
        ↓
Contribution becomes CONFIRMED or AUTHORIZED
        ↓
Live Vink updates
```

Only provider-confirmed and ledger-posted contributions count.

---

# 11. CONTRIBUTION AUTHORIZATION MODEL

Prefer authorization-and-capture over immediate charge-and-refund when supported.

For each participant, create an immutable contribution slot:

```text
contribution_slot_id
vink_id
participant_identity_id
split_version
base_amount_minor
maximum_amount_minor
currency
status
```

Statuses:

```text
INVITED
JOINED
PAYMENT_NOT_STARTED
AUTHENTICATING
PROCESSING
AUTHORIZED
CAPTURE_PENDING
CAPTURED
FAILED
CANCELED
RELEASE_PENDING
RELEASED
REFUND_PENDING
REFUNDED
DISPUTED
```

Create payment attempts separately:

```text
contribution_attempt_id
contribution_slot_id
attempt_generation
provider_payment_id
payment_method_type
status
created_at
updated_at
```

At most one active or successful attempt may satisfy a contribution slot.

---

# 12. IDEMPOTENCY

Do not generate a new unrelated idempotency key for every button tap.

The server creates stable operation identities.

Example:

```text
authorize:v1:{contribution_slot_id}:{attempt_generation}
capture:v1:{contribution_slot_id}:{capture_generation}
refund:v1:{refund_id}
issue-card:v1:{vink_id}
```

Retries for the same operation reuse the same key.

A definitive decline may create a new attempt generation.

PostgreSQL must enforce uniqueness:

```text
UNIQUE(contribution_slot_id, attempt_generation)
UNIQUE(provider, provider_payment_id)
UNIQUE(provider, provider_event_id)
UNIQUE(operation_scope, operation_id)
```

Redis may reduce duplicate concurrent work, but PostgreSQL transactions and uniqueness constraints provide final correctness.

---

# 13. LIVE SESSION STATE MACHINE

```text
DRAFT
    ↓
READY
    ↓
LIVE
    ↓
SUBMISSIONS_CLOSED
    ├── no unresolved attempts
    │          ↓
    │       EVALUATING
    │
    └── unresolved attempts
               ↓
       PROCESSING_GRACE
               ↓
       PROVIDER_RECONCILIATION
               ├───────────────┐
               ▼               ▼
            FUNDED          EXPIRED
               │               │
               ▼               ▼
       SPEND_PREPARATION   RELEASE_OR_REFUND
               │               │
               ▼               ▼
          SPEND_READY       DISPERSED
               │
               ▼
          CARD_ACTIVE
               │
               ▼
    PURCHASE_AUTHORIZATION_PENDING
               │
               ▼
       MERCHANT_LOCKED
               │
               ▼
    SETTLEMENT_MONITORING
               ├────────────────┐
               ▼                ▼
           COMPLETED     ADJUSTMENT_PENDING
                                │
                                ▼
                        RECOVERY_PENDING
                                │
                                ▼
                           COMPLETED
```

Other states:

```text
CANCELED
MANUAL_REVIEW
DISPUTED
FAILED
SUSPENDED
```

---

# 14. PROCESSING GRACE

When the live timer reaches zero:

* Do not expire immediately if unresolved attempts exist.
* Enter `PROCESSING_GRACE`.
* Reject new submissions.
* Allow registered pre-cutoff attempts to resolve.
* Reconcile provider objects directly at the deadline.
* Use provider object state and timestamps, not webhook arrival time alone.

Recommended initial timing:

```text
New attempts allowed until T-15 seconds
Submissions closed from T-15 to T
Processing grace from T to T+60 seconds
```

The grace duration must be configurable.

At the grace deadline:

```text
Lock Vink
Lock contribution attempts
Retrieve unresolved provider objects
Post confirmed results
Cancel failed or unresolved attempts where appropriate
Fund or expire exactly once
```

The expiry worker and webhook processor must use the same locking strategy.

---

# 15. SPLIT ENGINE

Support:

* Equal split
* Custom split
* Organizer covers remainder
* Revised split
* Replacement participant
* Guest removal before payment begins

Every split change creates a new immutable split version.

```text
split_version 1
split_version 2
split_version 3
```

Never overwrite historical allocations.

A participant must approve any revised amount that exceeds their previously approved maximum.

The organizer may remove a participant only when the participant is not in an unresolved financial state.

Safe removable states:

```text
INVITED
LINK_OPENED
JOINED
PAYMENT_NOT_STARTED
FAILED
```

Unsafe removal states:

```text
AUTHENTICATING
PROCESSING
AUTHORIZED
CAPTURE_PENDING
CAPTURED
```

## Cover Remaining

The organizer must have a fast fallback:

```text
Cover Remaining
```

This allows the organizer to immediately cover the unpaid balance and complete checkout.

The unpaid member’s share may become a reimbursement request afterward.

This fallback should appear prominently when:

* Session time is low
* One or more participants remain unpaid
* The organizer has sufficient payment capacity
* Risk checks permit the cover amount

---

# 16. CARD ISSUANCE FLOW

A temporary card becomes available only when:

* Required contribution funding is secured
* Ledger entries balance
* Organizer remains eligible
* Recovery method is active
* Risk checks pass
* Platform liquidity checks pass
* Card controls are configured
* Provider funding is available

Flow:

```text
Vink FUNDED
        ↓
Organizer eligibility recheck
        ↓
Risk and liquidity evaluation
        ↓
Create or locate cardholder
        ↓
Issue card or activate inactive card
        ↓
Apply amount and merchant controls
        ↓
Create secure card display session
        ↓
Vink SPEND_READY
```

Do not store raw card number or CVV.

Use provider-hosted secure card display components.

---

# 17. DUAL-AUTHORIZATION RACE PROTECTION

Two near-simultaneous merchant authorization requests must not both consume the Vink.

Do not rely only on Redis.

Authorization flow:

```text
Authorization webhook arrives
        ↓
Begin PostgreSQL transaction
        ↓
SELECT temporary_card FOR UPDATE
        ↓
SELECT active authorizations FOR UPDATE
        ↓
Evaluate duplicate and remaining exposure
        ↓
Create authorization decision record
        ↓
Post ledger reserve
        ↓
Update card state
        ↓
Commit
        ↓
Return approve or decline
```

Use:

* PostgreSQL row lock
* Unique provider authorization ID
* Merchant and amount comparison
* Redis advisory lock as performance optimization
* Cumulative authorization limit
* Duplicate-detection window

Possible duplicate signals:

* Same merchant
* Same amount
* Same card
* Same terminal
* Same currency
* Very close timestamps
* Existing pending authorization

Do not reject legitimate merchant retries blindly.

Differentiate:

```text
Duplicate retry
Reversal and retry
Incremental authorization
Partial authorization
Separate related authorization
Unrelated authorization
```

---

# 18. MERCHANT LOCKING

After the first valid merchant authorization:

```text
Card visible
        ↓
Authorization approved
        ↓
Card hidden from organizer
        ↓
Card becomes MERCHANT_LOCKED
        ↓
Related merchant settlement allowed
        ↓
Unrelated merchant attempts declined
```

Track:

```text
merchant_id
merchant_name
merchant_category_code
merchant_country
terminal_id if available
first_authorized_at
cumulative_authorized_amount
cumulative_captured_amount
remaining_policy_limit
```

The underlying card must remain active for legitimate:

* Partial captures
* Split settlement
* Tip settlement
* Reversals
* Merchant corrections
* Merchant refunds

Do not permanently close the provider card immediately after the first authorization.

---

# 19. CATEGORY AND MCC ENFORCEMENT

The organizer’s selected category is a user-intent signal.

The merchant’s actual network data is the enforcement signal.

Compare:

```text
Selected category
Selected payment policy
Actual MCC
Merchant identity
Transaction behavior
```

Use policy-family compatibility.

Example:

```text
Retail selected + Grocery MCC
→ allow under exact-final policy

Shopping selected + Restaurant MCC
→ decline and request policy reconfiguration

Restaurant selected + Bakery MCC
→ allow under restaurant-variable policy

Retail selected + Hotel MCC
→ decline
```

Do not attempt to wait for a human response during the same point-of-sale authorization.

For dangerous mismatches:

```text
Decline safely
Notify organizer immediately
Explain detected merchant type
Allow policy reconfiguration
Ask affected participants for new approval if exposure increases
Retry transaction
```

---

# 20. EXACT_FINAL POLICY

Flow:

```text
Merchant final total known
        ↓
Organizer enters exact amount
        ↓
Participants approve shares
        ↓
Base contributions captured
        ↓
Temporary card activated
        ↓
Organizer pays merchant
```

Internal card policy may include a small configurable slippage amount.

Example:

```text
Expected total: $104.20
Maximum allowed: $105.20
```

The group is funded only for the expected total unless participants explicitly approve more.

Any allowed overage becomes an organizer settlement adjustment.

Do not silently distribute slippage across participants.

---

# 21. RESTAURANT_VARIABLE POLICY

Restaurant workflow asks:

```text
Is gratuity already included?

Choose:
- No additional tip
- Add tip now
- Tip after card is presented
```

Calculate:

```text
Base bill
Expected tip
Expected total
Maximum approved tip
Maximum total
Participant base share
Participant maximum exposure
```

Example:

```text
Base bill: $180
Expected tip: $32
Maximum tip: $36
Expected total: $212
Maximum total: $216
```

Participants must see:

```text
Expected share
Maximum possible share
```

Do not hide the maximum.

## Base Capture Strategy

Capture known base contributions promptly after the Vink succeeds.

Do not rely on participant authorization holds remaining valid for several days.

Possible flow:

```text
Participants authorize maximum
        ↓
Vink succeeds
        ↓
Capture base contribution
        ↓
Temporary card pays restaurant
        ↓
Merchant settles final amount
        ↓
Charge approved adjustment amounts separately where permitted
        ↓
Organizer recovery covers failed or uncovered remainder
```

Provider capabilities must determine whether multicapture or extended authorization can be used.

Do not assume those features are universally available.

---

# 22. SETTLEMENT ADJUSTMENTS

If the merchant settles for more than the group-funded amount:

```text
Group funded: $180
Merchant settled: $192
Difference: $12
```

The merchant is paid through the card network.

The $12 becomes an organizer settlement adjustment owed to VinkIn.

Adjustment types:

```text
TIP
TAX_VARIANCE
ROUNDING
SERVICE_FEE
CAPTURE_OVERAGE
MERCHANT_CORRECTION
LATE_SETTLEMENT
DAMAGE_OR_INCIDENTAL
UNKNOWN
```

Responsibility types:

```text
VINK_FUNDS
ORGANIZER
PARTICIPANT_PREAUTHORIZED
PLATFORM
MANUAL_REVIEW
```

---

# 23. RECOVERY WORKFLOW

Organizers must register a reusable recovery payment method before starting Vinks.

Recovery flow:

```text
Adjustment detected
        ↓
Use available approved Vink funds
        ↓
Create organizer obligation
        ↓
Notify organizer
        ↓
Attempt recovery payment
        ↓
If successful:
    settle obligation
    restore good standing
        ↓
If failed:
    retry according to policy
    restrict organizer
    open support/recovery case
```

A saved payment method is not guaranteed to succeed.

Therefore maintain:

* Platform risk reserve
* Exposure limits
* Recovery retry policy
* Account restrictions
* Manual review
* Reconciliation

Users with unresolved obligations may still contribute but may not create Vinks.

---

# 24. REIMBURSEMENT WORKFLOW

Organizer may request reimbursement from original participants.

States:

```text
DRAFT
REQUESTED
VIEWED
ACCEPTED
PAYMENT_PROCESSING
PAID
DECLINED
EXPIRED
CANCELED
REALLOCATION_PROPOSED
SUPERSEDED
CLOSED_UNPAID
```

If a member declines:

* Organizer may pay remainder
* Organizer may send one reminder
* Organizer may propose a new split
* Organizer may ask selected members to cover more
* Organizer may close request

Any additional member amount requires approval.

Never recursively auto-charge other members.

Every new allocation creates a new version.

---

# 25. FAILED VINK HANDLING

Prefer canceling uncaptured authorizations over charging and refunding.

If a Vink expires:

```text
Block new attempts
        ↓
Resolve pending attempts
        ↓
Cancel uncaptured authorizations
        ↓
Refund only amounts already captured
        ↓
Notify participants
        ↓
Mark DISPERSED
```

User-facing states:

```text
Authorization release requested
Refund initiated
Refund processing
Refund completed
```

Do not tell users money is immediately back in their bank account if the provider has only initiated the release or refund.

---

# 26. DOUBLE-ENTRY LEDGER

The internal ledger is the financial source of truth.

Core tables:

```text
ledger_accounts
ledger_transactions
ledger_entries
ledger_posting_batches
ledger_balance_projections
```

Every transaction must balance.

Enforce:

```text
Debits = Credits
Amounts are positive integer minor units
Currencies match
Posted entries cannot be updated
Posted entries cannot be deleted
Every provider event is processed once
Every business operation has a unique operation ID
```

Example contribution capture:

```text
Debit: Payment Processor Clearing
Credit: Participant Contribution Liability
```

Allocate to Vink:

```text
Debit: Participant Contribution Liability
Credit: Vink Available Balance
```

Merchant purchase:

```text
Debit: Vink Purchase Expense
Credit: Vink Available Balance
```

Organizer overage:

```text
Debit: Organizer Settlement Receivable
Credit: Issuing Settlement Payable
```

Organizer recovery:

```text
Debit: Payment Processor Clearing
Credit: Organizer Settlement Receivable
```

Corrections must use reversal entries.

Never edit financial history.

---

# 27. ATOMICITY

Financial business state and ledger state must not drift.

Use a single PostgreSQL transaction for operations such as:

```text
Confirm contribution
Post ledger entries
Update contribution status
Update Vink funding projection
Insert outbox event
```

Example:

```sql
BEGIN;

SELECT contribution_slot
FOR UPDATE;

INSERT ledger_transaction;

INSERT debit_entry;
INSERT credit_entry;

UPDATE contribution_slot
SET status = 'CAPTURED';

UPDATE vink_funding_projection;

INSERT outbox_event;

COMMIT;
```

Either everything commits or nothing does.

---

# 28. WEBHOOK PROCESSING

Provider webhooks may be:

* Late
* Duplicated
* Out of order
* Missing temporarily
* Delivered after the client closes
* Delivered after an expiry worker runs

Flow:

```text
Webhook received
        ↓
Verify signature
        ↓
Store raw event
        ↓
Return successful HTTP response quickly
        ↓
Process asynchronously
        ↓
Lock affected records
        ↓
Apply idempotent transition
        ↓
Post ledger changes
        ↓
Mark provider event processed
```

Store:

```text
provider
provider_event_id
event_type
payload
received_at
occurred_at
processing_status
attempt_count
last_error
processed_at
```

Never use webhook arrival time alone to determine whether an event occurred before expiry.

---

# 29. TRANSACTIONAL OUTBOX

Whenever business state changes and another process must react:

```text
Database state update
+
Outbox event
```

must happen in the same transaction.

Possible domain events:

```text
VinkStarted
ContributionAuthorized
ContributionCaptured
ContributionFailed
VinkSubmissionsClosed
VinkProcessingGraceStarted
VinkFunded
VinkExpired
VinkDispersed
TemporaryCardIssued
MerchantAuthorizationApproved
MerchantAuthorizationDeclined
MerchantLocked
MerchantCaptureReceived
SettlementAdjustmentCreated
RecoverySucceeded
RecoveryFailed
VinkCompleted
```

---

# 30. DATABASE BLUEPRINT

## Identity and users

```text
users
profiles
user_contacts
user_sessions
user_devices
user_verifications
user_consents
```

## Financial accounts

```text
financial_accounts
financial_account_status_history
organizer_eligibility
linked_payment_methods
recovery_payment_methods
recovery_obligations
```

## Vinks

```text
vinks
vink_sessions
vink_members
vink_invitations
vink_split_versions
vink_split_allocations
vink_status_history
vink_receipts
```

## Contributions

```text
contribution_slots
contribution_attempts
contribution_captures
provider_payment_events
```

## Cards and merchant transactions

```text
cardholders
temporary_cards
card_controls
card_display_sessions
authorizations
authorization_decisions
card_transactions
merchant_settlements
purchase_adjustments
```

## Reimbursements and refunds

```text
refunds
refund_disbursements
reimbursement_requests
reimbursement_allocation_versions
reimbursement_payments
```

## Ledger

```text
ledger_accounts
ledger_transactions
ledger_entries
ledger_balance_projections
reconciliation_runs
reconciliation_items
```

## Platform operations

```text
outbox_events
notifications
notification_preferences
risk_events
audit_logs
support_cases
idempotency_operations
feature_flags
```

---

# 31. API BLUEPRINT

## Authentication

```http
POST /v1/auth/start
POST /v1/auth/verify
POST /v1/auth/refresh
POST /v1/auth/logout
```

## Current user

```http
GET   /v1/me
PATCH /v1/me
GET   /v1/me/financial-account
GET   /v1/me/organizer-eligibility
POST  /v1/me/payment-methods/setup
POST  /v1/me/recovery-method/setup
```

## Vinks

```http
POST  /v1/vinks
GET   /v1/vinks
GET   /v1/vinks/:vinkId
PATCH /v1/vinks/:vinkId
POST  /v1/vinks/:vinkId/start
POST  /v1/vinks/:vinkId/cancel
POST  /v1/vinks/:vinkId/cover-remaining
```

## Splits

```http
POST /v1/vinks/:vinkId/split-versions
GET  /v1/vinks/:vinkId/split-versions/current
POST /v1/vinks/:vinkId/members/:memberId/remove
POST /v1/vinks/:vinkId/members/replace
```

## Invitations

```http
POST /v1/vinks/:vinkId/invitations
GET  /v1/invitations/:token
POST /v1/invitations/:token/accept
POST /v1/invitations/:token/decline
```

## Contributions

```http
POST /v1/contribution-slots/:slotId/attempts
GET  /v1/contribution-attempts/:attemptId
POST /v1/contribution-attempts/:attemptId/retry
POST /v1/contribution-attempts/:attemptId/cancel
```

## Guest Checkout

```http
GET  /v1/guest-vinks/:token
POST /v1/guest-vinks/:token/verify
POST /v1/guest-vinks/:token/attempt
GET  /v1/guest-vinks/:token/status
```

## Cards

```http
GET  /v1/vinks/:vinkId/card
POST /v1/vinks/:vinkId/card/display-session
POST /v1/vinks/:vinkId/card/freeze
```

## Adjustments

```http
GET  /v1/vinks/:vinkId/adjustments
POST /v1/adjustments/:adjustmentId/pay
POST /v1/adjustments/:adjustmentId/reimbursements
```

## Reimbursements

```http
GET  /v1/reimbursements
POST /v1/reimbursements/:requestId/respond
POST /v1/reimbursements/:requestId/reallocate
```

## Webhooks

```http
POST /v1/webhooks/payments
POST /v1/webhooks/issuing
POST /v1/webhooks/identity
```

All financial mutation endpoints must use server-recognized operation IDs and idempotency controls.

---

# 32. FLUTTER APPLICATION STRUCTURE

```text
lib/
├── app/
│   ├── app.dart
│   ├── router.dart
│   └── theme/
├── core/
│   ├── api/
│   ├── auth/
│   ├── config/
│   ├── errors/
│   ├── realtime/
│   ├── security/
│   ├── storage/
│   ├── analytics/
│   └── widgets/
├── features/
│   ├── onboarding/
│   ├── authentication/
│   ├── home/
│   ├── create_vink/
│   ├── live_vink/
│   ├── guest_invites/
│   ├── contributions/
│   ├── temporary_card/
│   ├── adjustments/
│   ├── reimbursements/
│   ├── refunds/
│   ├── financial_account/
│   ├── notifications/
│   ├── history/
│   └── profile/
└── main.dart
```

Each feature uses:

```text
data/
domain/
presentation/
```

Do not put provider DTOs directly into the UI.

Use domain models and repository interfaces.

---

# 33. PRIMARY MOBILE SCREENS

## Onboarding

* Welcome
* Phone or email verification
* Username
* Profile
* Payment-method setup
* Organizer verification
* Recovery-method setup

## Home

* Pay Together
* Active Vinks
* Needs Your Payment
* Ready to Pay
* Refunds
* Adjustments
* History

## Start Vink

1. Select category
2. Enter final total
3. Add participants
4. Choose equal or custom split
5. Configure restaurant adjustment policy if needed
6. Review
7. Start

## Live Vink

Show:

```text
3 of 4 ready

Confirmed: $96.32
Processing: $32.11
Remaining: $0.00
```

Do not make the countdown the dominant visual.

Show:

```text
Waiting for David
```

Show a subtle session-expiry indicator.

Prominently show:

```text
Cover Remaining
```

when useful.

## Success

```text
Everyone is in.

Card ready.
```

## Failed Session

```text
This checkout session ended before the full amount was secured.

Pending authorizations are being released.
```

## Adjustment

```text
Merchant finalized this purchase for $12 more.

Recovery is being processed.
```

---

# 34. GUEST CHECKOUT UX

The QR guest page must be extremely fast.

Performance targets:

* First meaningful content under 1 second on good mobile networks
* Payment button visible without scrolling
* Apple Pay or Google Pay shown immediately when supported
* Card fallback shown automatically when wallet is unavailable
* Minimal JavaScript
* No unnecessary account creation
* No marketing interruptions before payment

Flow:

```text
Scan QR
        ↓
Review Vink
        ↓
Confirm identity
        ↓
Pay
        ↓
Success
        ↓
Optional account creation
```

Do not open payment in a third-party in-app browser when the wallet will not work correctly.

Provide an “Open in Safari” or “Open in Chrome” escape path when necessary.

---

# 35. SECURITY REQUIREMENTS

## Authentication

* Short-lived access tokens
* Rotating refresh tokens
* Device session management
* OTP throttling
* Suspicious-login detection
* Biometric reauthentication for card display

## Authorization

Roles:

```text
ORGANIZER
PARTICIPANT
GUEST
SUPPORT_AGENT
RISK_ANALYST
ADMIN
```

All permissions enforced server-side.

## Financial security

* Signed webhook verification
* Idempotent event handling
* No raw card credential storage
* Append-only ledger
* Immutable audit trail
* Database row locks
* Provider reconciliation
* Spending limits
* Merchant controls
* Device risk
* Velocity limits
* Recovery limits

## Admin security

Every sensitive action records:

```text
Actor
Action
Reason
Target
Timestamp
Previous value
New value
Device or IP
```

---

# 36. RISK CONTROLS

Initial platform controls:

* United States only
* USD only
* Low maximum Vink amount
* Low maximum organizer exposure
* One active Vink per new organizer
* Mandatory recovery method
* No ACH in V1
* No ATM
* No cash withdrawal
* No money transfer
* No crypto
* No gambling
* No gift cards initially
* No hotels
* No gas
* No car rentals
* No international merchants
* No unsupported variable settlement
* Platform reserve monitoring
* Daily reconciliation
* Manual support review

Risk Engine inputs:

```text
Organizer account age
Identity verification
Device reputation
Payment method history
Prior successful Vinks
Outstanding obligations
Vink amount
Participant count
Merchant category
Merchant country
Authorization velocity
Duplicate attempts
Platform reserve coverage
```

---

# 37. OBSERVABILITY

Every financial operation needs:

* Correlation ID
* Operation ID
* User ID
* Vink ID
* Contribution slot ID
* Provider object ID
* Trace ID
* Structured logs
* Metrics
* Error categorization

Required dashboards:

* Live Vinks
* Contribution success rate
* Guest checkout conversion
* Wallet fallback rate
* Processing-grace rate
* Expired sessions
* Card issuance latency
* Authorization approval rate
* Duplicate authorization rate
* Recovery success rate
* Refund latency
* Provider webhook lag
* Reconciliation differences
* Platform exposure
* Reserve coverage

Required alerts:

* Ledger imbalance
* Duplicate capture
* Reconciliation mismatch
* Webhook backlog
* Elevated declines
* Elevated refund rate
* Provider outage
* Recovery failure spike
* Reserve threshold breach
* Card issuance failure

---

# 38. TESTING STRATEGY

## Unit Tests

* Split calculations
* Rounding
* Policy selection
* Maximum exposure
* Timer transitions
* Recovery allocation
* Ledger posting
* Reimbursement versions

## Integration Tests

* Contribution authorization
* Capture
* Cancel authorization
* Webhook duplicate
* Webhook out of order
* Vink expiry
* Processing grace
* Provider reconciliation
* Card issuance
* Merchant authorization
* Duplicate merchant authorization
* Adjustment recovery
* Refund

## Concurrency Tests

Simulate:

* Two final contributions at once
* Expiry worker and webhook at once
* Two merchant authorizations within milliseconds
* Retry from two API instances
* Organizer covers remainder while participant payment succeeds
* Member removal while payment is processing

## End-to-End Tests

* Four-person grocery Vink
* Guest QR checkout
* One participant retries payment
* Organizer covers remaining
* Session expires
* Restaurant with tip before payment
* Restaurant with tip afterward
* Merchant category mismatch
* Organizer recovery fails
* Refund and dispute flow

## Chaos Tests

* Delayed webhook
* Provider timeout
* Redis failure
* Worker restart
* Database connection loss
* Duplicate queue delivery
* Partial provider outage

---

# 39. DEVELOPMENT MILESTONES

## Milestone 0 — Provider Feasibility

Before full product development:

* Confirm permitted funds flow
* Confirm consumer issuing support
* Confirm cardholder structure
* Confirm virtual card creation
* Confirm real-time authorization behavior
* Confirm merchant controls
* Confirm wallet contribution support
* Confirm manual capture support
* Confirm refund behavior
* Confirm disputes
* Confirm recovery-method charging
* Confirm provider sandbox limitations

Produce:

* Provider feasibility report
* Funds-flow diagram
* Risk register
* Open legal/compliance questions
* Mock provider adapter

## Milestone 1 — Engineering Foundation

* Monorepo
* Flutter app
* NestJS API
* Next.js guest checkout
* PostgreSQL
* Redis
* BullMQ
* CI/CD
* Environments
* Logging
* Error monitoring
* Feature flags

## Milestone 2 — Identity and Financial Accounts

* Authentication
* Profiles
* User sessions
* Payment methods
* Recovery methods
* Verification status
* Organizer eligibility
* Account restrictions

## Milestone 3 — Vink Domain

* Vink creation
* Categories
* Payment policies
* Split versions
* Invitations
* QR generation
* Session timing
* Live state updates

## Milestone 4 — Guest Checkout

* Secure token flow
* Mobile web
* Apple Pay
* Google Pay
* Card fallback
* Guest receipts
* Optional account conversion

## Milestone 5 — Contribution Engine

* Contribution slots
* Attempts
* Stable idempotency
* Manual authorization
* Processing grace
* Provider reconciliation
* Capture and release
* Live UI

## Milestone 6 — Ledger

* Ledger accounts
* Transactions
* Entries
* Posting procedures
* Balance projections
* Reconciliation
* Admin views

## Milestone 7 — Temporary Card

* Cardholder setup
* Card issuance
* Secure display
* Card controls
* Merchant locking
* Authorization decision engine
* Duplicate authorization protection

## Milestone 8 — Settlement and Adjustments

* Merchant capture
* Tip adjustment
* Organizer obligation
* Recovery attempts
* Reimbursement requests
* Card closure
* Merchant refund

## Milestone 9 — Risk and Support

* Risk limits
* Fraud signals
* Account restrictions
* Support cases
* Audit logs
* Manual review tools
* Exposure dashboards

## Milestone 10 — Closed Beta

* Low transaction limits
* Small invited user group
* Selected merchant categories
* Manual operational oversight
* Reconciliation review
* Support runbooks
* Incident response
* User research

---

# 40. MVP ACCEPTANCE CRITERIA

The MVP is ready for a closed beta only when:

1. A verified organizer can start a Vink.
2. Participants can join through app or guest QR.
3. Participants can approve contributions.
4. Duplicate taps cannot create duplicate charges.
5. A session can enter processing grace safely.
6. A failed Vink releases or refunds all participant funds.
7. A successful Vink produces one temporary card.
8. The merchant receives one normal payment.
9. Duplicate merchant authorizations do not double-spend the Vink.
10. The card locks to the merchant after first approval.
11. Restaurant adjustments create organizer obligations correctly.
12. Recovery attempts work.
13. Refunds are auditable.
14. Ledger entries always balance.
15. Provider data reconciles with internal records.
16. Support staff can investigate a transaction.
17. Every financial action has logs and audit records.
18. No raw card credentials are stored.
19. The end-to-end flow works on real iOS and Android devices.
20. Guest checkout works without requiring app installation.

---

# 41. OUT OF SCOPE FOR V1

Do not implement:

* Long-term savings pools
* Recurring Vinks
* Permanent debit cards
* Consumer wallet balances
* ATM access
* Cash withdrawals
* Peer-to-peer transfers
* International payments
* Foreign currencies
* ACH contribution funding
* Gas-station Vinks
* Hotel Vinks
* Car-rental Vinks
* Public fundraising
* Charitable fundraising
* Credit
* Lending
* Installments
* Multiple unrelated purchases per Vink
* Full merchant API integration
* Online marketplace plugins

---

# 42. LONG-TERM ARCHITECTURE DIRECTION

VinkIn begins as a consumer application using temporary virtual cards.

The long-term vision is collaborative checkout infrastructure.

Future evolution:

```text
Consumer VinkIn App
        ↓
Merchant Plugins
        ↓
POS Integrations
        ↓
Split Checkout API
        ↓
Embedded Collaborative Checkout Infrastructure
```

Future targets may include:

* Shopify
* Toast
* Square
* Ticketing platforms
* Food delivery platforms
* Travel marketplaces
* Retail checkouts

The long-term merchant-integrated flow should remove the need for temporary cards.

Design domain concepts so the purchase destination may later be:

```text
TemporaryCardPurchaseDestination
MerchantAPIOrderDestination
POSIntegratedDestination
CheckoutSessionDestination
```

Do not tightly couple the Vink domain to Stripe Issuing object names.

---

# 43. PROVIDER ABSTRACTION

Create a provider-neutral interface.

```typescript
interface FinancialProvider {
  createCustomer(input: CreateCustomerInput): Promise<CustomerResult>;

  setupPaymentMethod(
    input: SetupPaymentMethodInput,
  ): Promise<SetupPaymentMethodResult>;

  authorizeContribution(
    input: AuthorizeContributionInput,
  ): Promise<AuthorizationResult>;

  captureContribution(
    input: CaptureContributionInput,
  ): Promise<CaptureResult>;

  cancelContributionAuthorization(
    input: CancelAuthorizationInput,
  ): Promise<CancelResult>;

  refundContribution(
    input: RefundContributionInput,
  ): Promise<RefundResult>;

  createCardholder(
    input: CreateCardholderInput,
  ): Promise<CardholderResult>;

  issueTemporaryCard(
    input: IssueTemporaryCardInput,
  ): Promise<CardResult>;

  updateCardControls(
    input: UpdateCardControlsInput,
  ): Promise<void>;

  freezeCard(cardId: string): Promise<void>;

  closeCard(cardId: string): Promise<void>;

  retrievePaymentStatus(
    providerPaymentId: string,
  ): Promise<ProviderPaymentStatus>;

  retrieveCardTransaction(
    providerTransactionId: string,
  ): Promise<ProviderCardTransaction>;
}
```

Implement:

```text
StripeFinancialProvider
MockFinancialProvider
FutureProviderAdapter
```

Provider-specific logic must remain inside adapters.

---

# 44. FINAL PRODUCT RULE

The final system must embody this rule:

> VinkIn allows a group to prepare one payment together at the moment of checkout. Participants approve their shares, VinkIn secures the required funds, and the organizer receives one temporary card to pay the merchant. If the session fails, participant funds are released or refunded. If the merchant later adjusts the purchase, the organizer remains the accountable party and VinkIn reconciles the difference through its recovery system.

---

# 45. EXECUTION INSTRUCTION

Begin by inspecting the repository and producing:

1. Current-state architecture assessment
2. Gap analysis against this specification
3. Proposed monorepo structure
4. Domain model
5. Initial database schema
6. State-machine definitions
7. Provider feasibility spike
8. Milestone implementation sequence
9. Risk register
10. First implementation milestone

Do not attempt to build the entire system in one uncontrolled pass.

Build milestone by milestone.

At the end of each milestone, provide:

* What was implemented
* Files changed
* Database changes
* APIs added
* UI added
* Tests added
* Known limitations
* Security review
* Next milestone

Maintain production-quality architectural discipline throughout.
