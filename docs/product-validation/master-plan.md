# VinkIn Provider-Neutral Product Validation Build

> **Provenance:** received verbatim from the owner on 2026-07-17. This document is the source
> of truth for the product-validation (PV) track. Repository-specific interpretation lives in
> `docs/product-validation/00-governance.md`; adoption and divergences are recorded in
> `docs/spec/decision-log.md` (D10, D11). The Spec (`docs/spec/master-roadmap-prompt.md`)
> remains the authority for the production track; where the two conflict for the validation
> build, this plan governs (owner-directed).

## 1. Mission

Build a complete, production-shaped VinkIn experience using `MockFinancialProvider`.

The build must prove that users can:

1. Create accounts.
2. Create a Vink at checkout.
3. Invite participants through a QR code or link.
4. Join without installing the application.
5. View and approve their contribution.
6. Simulate payment authorization.
7. See funding progress update in real time.
8. Enter processing grace after submissions close.
9. Receive a mock temporary card after successful funding.
10. Simulate the merchant purchase.
11. Complete, expire, cancel, refund, or recover the session correctly.

The product must be structurally ready for a future financial provider without depending on one.

---

# 2. Non-Negotiable Boundary

## Green-light work

The team may build:

* Authentication
* User profiles
* Organizer onboarding
* Guest participation
* Vink creation
* Split calculations
* QR codes and invitation links
* Session timers
* Real-time session updates
* Mock contribution authorization
* Mock capture
* Mock card issuance
* Mock merchant authorization
* Mock settlement
* Mock refunds
* Mock recovery obligations
* Internal ledger
* Notification infrastructure
* Activity history
* Analytics instrumentation
* Admin and operational tools
* Provider-neutral interfaces
* Contract tests
* Mobile and web interfaces
* Accessibility
* Security controls unrelated to real card processing

## Red-light work

The team must not build:

* Stripe SDK integrations
* Stripe Treasury integration
* Stripe Issuing integration
* Stripe Connect integration
* Real PaymentIntents
* Real card collection
* Real Apple Pay or Google Pay processing
* Real payment-method storage
* Real card issuance
* Real card provisioning
* Real provider webhooks
* Real settlement reconciliation
* Real off-session recovery charging
* Real KYC integration
* Real bank accounts or stored balances
* Production claims that VinkIn can hold consumer money
* Any financial flow not approved by the M0 gate

The repository must fail CI if a prohibited provider dependency is imported outside an explicitly approved adapter directory.

---

# 3. Architectural Principle

The application must communicate only with VinkIn domain services.

The application must never communicate directly with Stripe, Lithic, Treasury, Issuing, or another provider.

```text
Flutter Application
        │
        ▼
VinkIn API
        │
        ▼
Application Services
        │
        ▼
Domain Model
        │
        ├── Session Engine
        ├── Split Engine
        ├── Contribution Engine
        ├── Card Lifecycle Engine
        ├── Settlement Engine
        ├── Recovery Engine
        ├── Ledger
        └── Notification Engine
        │
        ▼
FinancialProvider Interface
        │
        ▼
MockFinancialProvider
```

Future architecture:

```text
FinancialProvider
    ├── MockFinancialProvider
    ├── StripeTreasuryProvider
    ├── LithicProvider
    └── FutureProvider
```

Only the provider adapter changes after provider selection.

---

# 4. Recommended Technology Stack

## Client applications

### Organizer application

```text
Flutter
Dart
Riverpod
GoRouter
Dio
Freezed / json_serializable
WebSocket client
Secure storage for authentication tokens
```

Targets:

* iOS first
* Android supported
* Web only where Flutter web is genuinely useful

### Guest checkout

Use a lightweight responsive web application rather than forcing Flutter web.

Recommended:

```text
Next.js
TypeScript
Tailwind CSS
TanStack Query
WebSocket or Server-Sent Events
```

The guest interface must require no application installation and no account creation.

## Backend

```text
Node.js
TypeScript
Fastify
PostgreSQL
Drizzle ORM or Prisma
Redis
BullMQ
WebSockets
Zod
OpenTelemetry
Pino
```

## Repository

```text
pnpm
Turborepo
GitHub Actions
Docker Compose
```

---

# 5. Monorepo Structure

```text
vinkin/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   ├── middleware/
│   │   │   ├── jobs/
│   │   │   ├── realtime/
│   │   │   └── server.ts
│   │   └── tests/
│   │
│   ├── mobile/
│   │   ├── lib/
│   │   │   ├── app/
│   │   │   ├── core/
│   │   │   ├── features/
│   │   │   ├── data/
│   │   │   └── design_system/
│   │   └── test/
│   │
│   ├── guest-web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   └── tests/
│   │
│   └── operations-console/
│       ├── app/
│       ├── sessions/
│       ├── users/
│       └── simulator/
│
├── packages/
│   ├── domain/
│   ├── application/
│   ├── database/
│   ├── contracts/
│   ├── events/
│   ├── ledger/
│   ├── policy-engine/
│   ├── payment-provider/
│   ├── payment-provider-contract-tests/
│   ├── mock-financial-provider/
│   ├── notifications/
│   ├── observability/
│   ├── test-factories/
│   └── config/
│
├── docs/
│   ├── spec/
│   ├── architecture/
│   ├── feasibility/
│   ├── milestones/
│   ├── product-validation/
│   └── runbooks/
│
├── tooling/
│   ├── eslint/
│   ├── typescript/
│   └── scripts/
│
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── CLAUDE.md
└── README.md
```

---

# 6. Domain Boundaries

## 6.1 Identity

Owns:

* User
* Organizer profile
* Guest identity
* Authentication session
* Device
* Contact method
* Consent version

It does not own financial accounts.

## 6.2 Vink Session

Owns:

* Vink
* Organizer
* Purchase total
* Currency
* Category policy
* Expiration
* Current state
* Processing-grace deadline
* Sharing token
* QR payload

## 6.3 Participation

Owns:

* Participant
* Guest participant
* Invitation
* Join status
* Contribution allocation
* Participant maximum authorization

## 6.4 Contribution

Owns:

* Contribution request
* Contribution attempt
* Authorization result
* Capture result
* Cancellation
* Refund
* Idempotency keys

## 6.5 Purchase Destination

Owns:

* Temporary card request
* Mock temporary card
* Spending limit
* Merchant lock
* Authorization
* Capture
* Settlement
* Card closure

This boundary is explicitly replaceable.

## 6.6 Ledger

Owns immutable financial representations:

* Contribution liability
* Processor clearing
* Session funding balance
* Purchase authorization reserve
* Purchase expense
* Participant refund liability
* Organizer recovery receivable

The ledger represents mock money during this phase but must follow production-grade double-entry rules.

## 6.7 Recovery

Owns:

* Settlement variance
* Organizer obligation
* Recovery attempt
* Repayment status
* Restriction status

## 6.8 Notifications

Owns:

* Notification preferences
* Templates
* In-app notifications
* Push-intent records
* Email-intent records
* Delivery attempts

No real SMS provider is required initially.

---

# 7. Core Domain Entities

## User

```text
id
username
display_name
email
phone
status
created_at
updated_at
```

## OrganizerProfile

```text
user_id
eligibility_status
identity_status
backup_payment_status
risk_status
created_at
updated_at
```

During the mock build, these fields are simulated.

## Vink

```text
id
organizer_user_id
public_code
currency
purchase_category
payment_policy
subtotal_amount
tip_amount
maximum_amount
required_amount
funded_amount
state
submission_deadline
processing_grace_deadline
merchant_lock_status
version
created_at
updated_at
```

## Participant

```text
id
vink_id
user_id nullable
guest_identity_id nullable
display_name
role
status
allocated_amount
maximum_approved_amount
joined_at
updated_at
```

Exactly one of `user_id` or `guest_identity_id` must be present.

## Contribution

```text
id
vink_id
participant_id
requested_amount
authorized_amount
captured_amount
refunded_amount
status
provider_reference
idempotency_key
created_at
updated_at
```

## TemporaryCard

```text
id
vink_id
provider_card_id
display_last_four
status
spending_limit
merchant_lock_key nullable
expires_at
issued_at
closed_at nullable
```

Never store real PAN or CVV, even in mock records.

## PurchaseAuthorization

```text
id
vink_id
temporary_card_id
provider_authorization_id
merchant_name
merchant_identifier
mcc
requested_amount
approved_amount
status
created_at
updated_at
```

## Settlement

```text
id
vink_id
authorization_id
settled_amount
variance_amount
status
settled_at
created_at
```

## RecoveryObligation

```text
id
vink_id
organizer_user_id
amount
reason
status
due_at
resolved_at nullable
created_at
```

## LedgerEntry

```text
id
transaction_id
account_id
direction
amount
currency
entry_type
reference_type
reference_id
created_at
```

No update or delete operation is permitted on ledger entries.

---

# 8. Vink State Machine

```text
DRAFT
  │
  ▼
OPEN
  │
  ├── organizer cancels ─────────────► CANCELLED
  │
  ├── deadline arrives ──────────────► SUBMISSIONS_CLOSED
  │
  └── all contributions authorized ─► SUBMISSIONS_CLOSED
                                          │
                                          ▼
                                  PROCESSING_GRACE
                                     │          │
                         funding confirmed     funding failed
                                     │          │
                                     ▼          ▼
                                  FUNDED      EXPIRED
                                     │
                                     ▼
                              CARD_PROVISIONING
                                │            │
                           success          failure
                                │            │
                                ▼            ▼
                            CARD_READY    FUNDING_REVERSAL
                                │
                      merchant authorization
                                │
                                ▼
                       PURCHASE_AUTHORIZED
                         │              │
                      capture        auth reversed
                         │              │
                         ▼              ▼
                      SETTLING      CARD_READY
                         │
              ┌──────────┴───────────┐
              ▼                      ▼
       COMPLETED               RECOVERY_REQUIRED
                                      │
                                      ▼
                               RECOVERY_PENDING
                                │             │
                             resolved       defaulted
                                │             │
                                ▼             ▼
                            COMPLETED     RESTRICTED
```

Terminal states:

```text
COMPLETED
CANCELLED
EXPIRED
RESTRICTED
```

State transitions must occur only through domain commands.

No API handler, background job, or provider adapter may directly update `vink.state`.

---

# 9. Contribution State Machine

```text
CREATED
   │
   ▼
AUTHORIZATION_PENDING
   │
   ├── approved ─────────► AUTHORIZED
   ├── declined ─────────► DECLINED
   ├── provider unknown ─► RESOLUTION_PENDING
   └── timed out ────────► RESOLUTION_PENDING

AUTHORIZED
   │
   ├── session succeeds ─► CAPTURE_PENDING
   ├── participant exits ► CANCELLATION_PENDING
   └── session expires ──► CANCELLATION_PENDING

CAPTURE_PENDING
   ├── success ──────────► CAPTURED
   └── unknown ──────────► RESOLUTION_PENDING

CAPTURED
   ├── purchase succeeds ► SETTLED
   └── refund required ──► REFUND_PENDING

REFUND_PENDING
   ├── success ──────────► REFUNDED
   └── failure ──────────► REFUND_FAILED
```

---

# 10. Timer Architecture

Redis may schedule jobs, but PostgreSQL owns deadline truth.

## Rule

Every timer job must perform a database comparison before acting.

Example:

```text
BullMQ says session expired
        │
        ▼
Load Vink with row lock
        │
        ▼
Compare database deadline with current time
        │
        ├── deadline not reached → no action
        └── deadline reached → execute transition
```

Required jobs:

```text
close-submissions
resolve-processing-grace
expire-unused-card
resolve-pending-contribution
close-settlement-window
retry-refund
retry-recovery
send-reminder-notification
```

Jobs must be idempotent.

---

# 11. Concurrency and Correctness

## Database locking

Use PostgreSQL row-level locks for:

* Final contribution acceptance
* Session funding determination
* Card issuance initiation
* First merchant authorization
* Settlement creation
* Recovery obligation creation
* Refund initiation

Example funding transaction:

```text
BEGIN

SELECT Vink
FOR UPDATE

Verify Vink accepts contributions

Lock relevant contribution rows

Calculate authoritative authorized total

If authorized total >= required amount:
    transition to SUBMISSIONS_CLOSED
    create outbox event

COMMIT
```

Redis may reduce duplicate work but must never determine financial correctness.

## Optimistic concurrency

`Vink.version` increments on every mutation.

Commands may include:

```text
expected_version
```

Reject stale user actions with:

```text
409 VINK_VERSION_CONFLICT
```

## Idempotency

Every financial command requires an idempotency key.

Format:

```text
vink:{vinkId}:participant:{participantId}:authorize:{attemptNumber}
vink:{vinkId}:contribution:{contributionId}:capture
vink:{vinkId}:issue-card
vink:{vinkId}:authorization:{authorizationId}:capture
vink:{vinkId}:contribution:{contributionId}:refund
```

Store operation requests and results in PostgreSQL.

---

# 12. Event Architecture

Use a transactional outbox.

## Core events

```text
VinkCreated
VinkOpened
ParticipantJoined
ParticipantAllocationChanged
ContributionRequested
ContributionAuthorizationStarted
ContributionAuthorized
ContributionDeclined
ContributionResolutionRequired
SubmissionsClosed
ProcessingGraceStarted
VinkFunded
VinkExpired
TemporaryCardRequested
TemporaryCardIssued
TemporaryCardFailed
MerchantAuthorizationReceived
MerchantAuthorizationApproved
MerchantAuthorizationDeclined
MerchantLocked
PurchaseCaptured
SettlementVarianceDetected
RecoveryObligationCreated
RefundRequested
RefundCompleted
VinkCompleted
VinkCancelled
OrganizerRestricted
```

## Transactional rule

State change and outbox event must be committed in the same transaction.

```text
BEGIN
update domain state
insert outbox event
COMMIT
```

An outbox worker publishes the event after commit.

At-least-once delivery is expected.

Every event consumer must be idempotent.

---

# 13. API Surface

Base path:

```text
/api/v1
```

## Identity

```text
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /me
PATCH  /me
```

## Vinks

```text
POST   /vinks
GET    /vinks/:vinkId
PATCH  /vinks/:vinkId
POST   /vinks/:vinkId/open
POST   /vinks/:vinkId/cancel
POST   /vinks/:vinkId/cover-remaining
GET    /vinks/:vinkId/activity
```

## Sharing

```text
POST   /vinks/:vinkId/share-links
POST   /vinks/:vinkId/qr
GET    /join/:publicCode
```

## Participants

```text
POST   /public/vinks/:publicCode/participants
GET    /vinks/:vinkId/participants
PATCH  /vinks/:vinkId/participants/:participantId
DELETE /vinks/:vinkId/participants/:participantId
```

## Contributions

```text
POST   /vinks/:vinkId/contributions
POST   /contributions/:contributionId/authorize
POST   /contributions/:contributionId/cancel
POST   /contributions/:contributionId/retry
```

These invoke the mock provider.

## Mock purchase simulator

Restricted to development, test, and controlled demos:

```text
POST /internal/simulator/vinks/:vinkId/merchant-authorizations
POST /internal/simulator/authorizations/:authorizationId/capture
POST /internal/simulator/authorizations/:authorizationId/reverse
POST /internal/simulator/vinks/:vinkId/settlement-variance
POST /internal/simulator/contributions/:contributionId/refund
```

These endpoints must never be enabled in production without an explicit environment guard.

## Operations console

```text
GET  /operations/vinks
GET  /operations/vinks/:vinkId
GET  /operations/vinks/:vinkId/ledger
GET  /operations/vinks/:vinkId/events
POST /operations/vinks/:vinkId/replay-event
POST /operations/vinks/:vinkId/reconcile
```

---

# 14. Real-Time Architecture

Each active Vink has a real-time channel:

```text
vink:{vinkId}
```

Messages:

```text
snapshot
participant_joined
participant_updated
contribution_pending
contribution_authorized
contribution_declined
funding_progress_updated
submissions_closed
processing_grace_started
vink_funded
card_ready
purchase_authorized
purchase_completed
vink_expired
vink_cancelled
```

Clients must not trust individual socket messages as complete truth.

On reconnection:

1. Fetch current session snapshot.
2. Replace local server state.
3. Resume real-time updates.

The server remains authoritative.

---

# 15. Split Engine

Supported MVP split types:

```text
EQUAL
CUSTOM_AMOUNT
PERCENTAGE
ITEMIZED_LATER
```

Build only the first three during the validation phase.

## Invariants

```text
Sum of allocations = required amount
No allocation is negative
No participant receives more than the allowed session maximum
Percentage totals equal 100%
Rounding remainder is assigned deterministically
Currency uses integer minor units
```

Example:

```text
$100.00 / 3

Participant A: $33.34
Participant B: $33.33
Participant C: $33.33
```

Never use floating-point arithmetic for money.

---

# 16. Policy Engine

```typescript
interface PurchasePolicy {
  policyType:
    | "EXACT_FINAL"
    | "RESTAURANT_VARIABLE"
    | "VARIABLE_SETTLEMENT_UNSUPPORTED";

  supported: boolean;
  maximumTipBasisPoints?: number;
  merchantCategoryRules: MerchantCategoryRule[];
  authorizationVarianceLimit?: Money;
  settlementVarianceRule: SettlementVarianceRule;
}
```

## EXACT_FINAL

Used for:

* Grocery
* Retail
* Electronics
* Known final totals

Rules:

* Required amount equals exact checkout total.
* Card spending limit equals funded amount.
* Merchant capture over the amount generates recovery or manual review.

## RESTAURANT_VARIABLE

Used only after provider and counsel validation.

During the mock phase, it can be simulated behind a feature flag.

Rules:

* Organizer enters expected subtotal.
* Organizer enters intended tip or maximum tip.
* Participants approve maximum exposure.
* Card limit equals approved maximum.
* Unused amount follows mock refund behavior.

## VARIABLE_SETTLEMENT_UNSUPPORTED

Used for:

* Hotels
* Fuel pumps
* Car rentals
* Other high-variance merchants

The API must reject these categories during MVP.

---

# 17. MockFinancialProvider Requirements

The mock must behave like an unreliable external system, not a simple success stub.

## Configurable outcomes

```text
Immediate success
Immediate decline
Delayed success
Delayed decline
Timeout with later success
Timeout with later decline
Lost response
Duplicate webhook
Out-of-order webhook
Temporary outage
Authorization expiry
Capture failure
Refund failure
Card issuance failure
Duplicate merchant authorization
Settlement overage
```

## Scenario controls

Each simulated operation may accept a test-only instruction:

```typescript
{
  scenario:
    | "SUCCESS"
    | "DECLINE"
    | "DELAYED_SUCCESS"
    | "LOST_RESPONSE"
    | "DUPLICATE_EVENT"
    | "OUT_OF_ORDER_EVENTS"
    | "TIMEOUT_THEN_SUCCESS"
}
```

The main application must not expose these controls to ordinary users.

The operations console may expose them for demos and testing.

---

# 18. Internal Ledger Design

## Accounts

```text
processor_clearing
participant_contribution_liability
session_funding_balance
issuing_funding_balance
purchase_authorization_reserve
vink_purchase_expense
participant_refund_liability
organizer_recovery_receivable
provider_fee_expense
platform_cash
```

## Example: contribution capture

```text
DR processor_clearing
CR participant_contribution_liability
```

## Move funds into session funding representation

```text
DR participant_contribution_liability
CR session_funding_balance
```

## Merchant authorization reserve

```text
DR purchase_authorization_reserve
CR session_funding_balance
```

## Merchant settlement

```text
DR vink_purchase_expense
CR purchase_authorization_reserve
```

## Settlement overage

```text
DR organizer_recovery_receivable
CR vink_purchase_expense_adjustment
```

All ledger transactions must balance:

```text
Total debits = total credits
```

Database constraints and tests must enforce this.

---

# 19. Flutter Application Architecture

```text
lib/
├── app/
│   ├── app.dart
│   ├── router.dart
│   └── bootstrap.dart
│
├── core/
│   ├── auth/
│   ├── networking/
│   ├── realtime/
│   ├── storage/
│   ├── errors/
│   └── analytics/
│
├── design_system/
│   ├── colors/
│   ├── typography/
│   ├── components/
│   └── motion/
│
└── features/
    ├── onboarding/
    ├── home/
    ├── create_vink/
    ├── vink_lobby/
    ├── participant_management/
    ├── funding_progress/
    ├── card_ready/
    ├── purchase_status/
    ├── activity/
    ├── profile/
    └── settings/
```

Each feature should contain:

```text
presentation/
application/
domain/
data/
```

The Flutter client must not duplicate backend state-machine logic.

It may display permitted actions returned by the server:

```json
{
  "allowedActions": [
    "CANCEL_VINK",
    "EDIT_ALLOCATION",
    "COVER_REMAINING"
  ]
}
```

---

# 20. Required Product Screens

## Organizer application

1. Welcome
2. Registration
3. Login
4. Home
5. Create Vink
6. Choose purchase category
7. Enter total
8. Select split method
9. Add known participants
10. Vink lobby
11. QR sharing
12. Participant status
13. Funding progress
14. Processing grace
15. Mock card ready
16. Mock purchase authorization
17. Purchase completed
18. Recovery required
19. Vink history
20. Vink detail
21. Profile
22. Settings

## Guest web

1. Join confirmation
2. Enter display name
3. View contribution
4. Approve mock payment
5. Payment processing
6. Contribution successful
7. Contribution failed
8. Session expired
9. Purchase completed
10. Optional account creation

## Operations console

1. Active sessions
2. Session detail
3. State timeline
4. Participant table
5. Contribution table
6. Mock provider controls
7. Card status
8. Merchant authorization simulator
9. Ledger entries
10. Event stream
11. Recovery obligations
12. Refund simulator

---

# 21. Security Requirements

Even without real money:

* Use signed authentication tokens.
* Rotate refresh tokens.
* Hash guest access tokens.
* Rate-limit public join endpoints.
* Rate-limit contribution attempts.
* Validate every request with Zod.
* Enforce ownership and participant authorization.
* Use cryptographically random public codes.
* Do not expose sequential IDs.
* Redact sensitive values from logs.
* Store no mock PAN or CVV.
* Use environment-based internal endpoint guards.
* Record operations-console actions in an audit log.
* Prevent organizers from approving contributions on behalf of participants.
* Prevent clients from directly setting states or funded totals.

---

# 22. Observability

Every request should include:

```text
request_id
trace_id
user_id when available
vink_id when available
operation_id
```

Metrics:

```text
vinks_created_total
vinks_opened_total
participants_joined_total
contributions_authorized_total
contributions_declined_total
vinks_funded_total
vinks_expired_total
processing_grace_duration
time_to_full_funding
time_to_card_ready
purchase_completion_rate
refund_attempts_total
recovery_obligations_total
websocket_reconnections_total
```

Structured logs only.

Do not use arbitrary `console.log` calls in application code.

---

# 23. Testing Strategy

## Unit tests

Cover:

* Split calculations
* Rounding
* State transitions
* Policy evaluation
* Allowed actions
* Deadline calculations
* Ledger balancing
* Idempotency keys
* Recovery calculations

## Integration tests

Cover:

* API plus PostgreSQL
* API plus Redis/BullMQ
* Transactional outbox
* Concurrent contributions
* Expiration jobs
* Duplicate events
* Out-of-order events
* Failed refunds
* Card issuance retries

## Contract tests

Continue the existing 20-test provider conformance suite.

Every provider adapter must pass the same suite.

## End-to-end tests

Required journeys:

### E1 — Successful exact-total Vink

```text
Organizer creates $120 Vink
Three participants join
Each approves $40
Session closes
Processing grace resolves
Mock card appears
Merchant authorizes $120
Merchant captures $120
Vink completes
Ledger balances
```

### E2 — Failed funding

```text
Two of three participants authorize
Deadline passes
Submissions close
Processing grace resolves
Authorizations cancel
Vink expires
```

### E3 — Organizer covers remaining

```text
Participants fund $80 of $100
Organizer covers $20
Session funds
Purchase completes
```

### E4 — Duplicate authorization

```text
Merchant sends two authorization requests
Only one is approved
No overspend occurs
```

### E5 — Lost contribution response

```text
Authorization succeeds
Provider response is lost
Retry uses same idempotency key
One contribution exists
```

### E6 — Delayed event after expiry

```text
Session expires
Late authorization-success event arrives
System reverses or flags it
Session does not reopen
```

### E7 — Settlement overage

```text
Card authorizes $100
Merchant settles $115
Merchant settlement succeeds
$15 organizer recovery obligation is created
Participants are not recharged
```

### E8 — Refund failure

```text
Session fails
Refund attempt fails
Retry job executes
Operations console shows unresolved refund
```

### E9 — Guest checkout

```text
Guest scans QR
Provides name
Approves contribution
Receives success state
No account is required
```

### E10 — Reconnection

```text
Mobile client disconnects
Session changes
Client reconnects
Snapshot replaces stale local state
```

---

# 24. Execution Milestones

## PV0 — Build Governance

Deliver:

* Product-validation architecture document
* Allowed and forbidden work lists
* Architecture decision records
* Feature flags
* Environment definitions
* Provider-import CI guard
* Definition of done

Exit gate:

```text
No provider-specific production work can enter the repository accidentally.
```

## PV1 — Local Platform Foundation

Deliver:

* Monorepo wiring
* API application
* PostgreSQL
* Redis
* BullMQ
* Docker Compose
* Authentication
* Logging
* Health endpoints
* CI
* Local seed script

Exit gate:

```text
One command starts the complete local backend.
CI runs typecheck, lint, format and tests.
```

## PV2 — Core Vink Domain

Deliver:

* Vink entity
* Participant entity
* Split engine
* Policy engine
* Vink state machine
* Contribution state machine
* Domain events
* Database migrations
* Unit tests

Exit gate:

```text
All domain workflows run without HTTP, UI or provider dependencies.
```

## PV3 — Organizer API

Deliver:

* Create Vink
* Configure total
* Select split
* Add participants
* Open Vink
* Cancel Vink
* Get snapshot
* Get activity
* Cover remaining

Exit gate:

```text
A complete Vink can be managed through API tests.
```

## PV4 — Guest Join and Sharing

Deliver:

* Secure public code
* QR generation
* Share link
* Guest join
* Guest contribution view
* Expiration handling
* Rate limiting

Exit gate:

```text
A guest can join a Vink without authentication or an installed application.
```

## PV5 — Mock Contribution Flow

Deliver:

* Contribution creation
* Mock authorization
* Declines
* Timeouts
* Resolution jobs
* Cancellation
* Processing grace
* Funding determination
* Ledger postings

Exit gate:

```text
Concurrent mock contributions cannot overfund or double-count a Vink.
```

## PV6 — Mock Card and Purchase Flow

Deliver:

* Mock temporary card
* Card lifecycle
* Spending limit
* First-merchant lock
* Merchant authorization simulator
* Capture
* Reversal
* Settlement
* Card closure

Exit gate:

```text
A fully funded Vink can complete exactly one simulated merchant purchase.
```

## PV7 — Recovery and Refunds

Deliver:

* Settlement variance
* Organizer recovery obligation
* Organizer restrictions
* Failed-session refunds
* Retry jobs
* Manual-review states

Exit gate:

```text
Every failed or adjusted financial path reaches an explicit, observable state.
```

## PV8 — Real-Time Experience

Deliver:

* WebSocket channels
* Snapshot reconciliation
* Funding progress
* Participant updates
* Timer updates
* Reconnection logic

Exit gate:

```text
Multiple clients observe the same authoritative Vink state without manual refresh.
```

## PV9 — Organizer Mobile Application

Deliver:

* Full organizer journey
* Design system
* State handling
* Error handling
* Accessibility
* Analytics
* Mock card display clearly labeled as simulation

Exit gate:

```text
An organizer can complete E1 entirely from the Flutter application.
```

## PV10 — Guest Web Application

Deliver:

* Join flow
* Contribution flow
* Responsive interface
* Accessibility
* Session completion status
* Optional signup conversion

Exit gate:

```text
A guest completes E9 on a mobile browser without installing the app.
```

## PV11 — Operations Console

Deliver:

* Session inspection
* Event stream
* Ledger view
* Scenario simulator
* Refund state
* Recovery state
* Audit logs

Exit gate:

```text
Every mock financial event can be inspected and explained by an operator.
```

## PV12 — Validation Pilot

Deliver:

* Closed campus test
* No real money
* Clearly disclosed simulation
* Observed user sessions
* Funnel analytics
* Survey after each session
* UX findings
* Product changes

Exit gate:

```text
At least 25 complete simulated Vinks
At least 75 participant joins
At least 80% organizer task completion
Median join-to-contribution time measured
Top five failure points documented
No unresolved critical correctness defects
```

---

# 25. Development Order

Work in this exact order:

```text
1. Governance and safety boundaries
2. Domain models and state machines
3. Database schema
4. Ledger
5. Application commands
6. API routes
7. Timer jobs
8. Mock provider integration
9. Real-time delivery
10. Organizer mobile interface
11. Guest web interface
12. Operations console
13. End-to-end tests
14. Closed product-validation pilot
```

Do not begin with UI mockups and attempt to invent backend behavior later.

Correctness must lead the interface.

---

# 26. First Two-Week Sprint

## Week 1

### Day 1

* Create `docs/product-validation/master-plan.md`.
* Record this plan as the source of truth.
* Add PV0–PV12 to the milestone sequence.
* Add the green, yellow and red work classifications.
* Add a CI scan for prohibited provider imports.

### Day 2

* Finalize Vink, Participant and Contribution models.
* Define all enums.
* Define money type.
* Define identifiers.
* Add domain invariants.

### Day 3

* Implement Vink state machine.
* Implement Contribution state machine.
* Add transition tests.
* Reject impossible transitions.

### Day 4

* Implement split engine.
* Implement exact-total policy.
* Add rounding tests.
* Add allocation-invariant tests.

### Day 5

* Create database migrations.
* Create repositories.
* Add integration-test database.
* Add seed factories.

## Week 2

### Day 6

* Implement create, open, cancel and retrieve Vink commands.
* Add idempotent command handling.
* Add outbox events.

### Day 7

* Implement participant join.
* Implement secure public codes.
* Add QR payload contract.
* Add rate limiting.

### Day 8

* Integrate MockFinancialProvider for contribution authorization.
* Add timeout, decline and lost-response scenarios.
* Store provider-operation records.

### Day 9

* Implement funding determination transaction.
* Implement submissions closing.
* Implement processing-grace job.
* Add concurrent contribution tests.

### Day 10

* Build a minimal internal simulator page.
* Run the successful Vink flow.
* Run the failed-funding flow.
* Verify ledger balance and event history.

Two-week outcome:

```text
A Vink can be created, joined, mock-funded, completed or expired through backend APIs and a minimal simulator.
```

---

# 27. Definition of Done for the Validation Build

The provider-neutral build is complete only when:

```text
Organizer mobile flow works
Guest mobile-web flow works
QR sharing works
Real-time funding updates work
All timers are backend-owned
Processing grace works
Mock provider passes contract suite
Temporary mock card lifecycle works
First-merchant locking works
Settlement and overage simulation work
Refund and recovery paths work
Ledger balances for every scenario
Duplicate events are harmless
Lost responses are recoverable
Operations console explains every state
No prohibited provider SDK exists in production code
All critical end-to-end journeys pass
Closed user validation has been completed
```

---

# 28. Provider Approval Handoff

When a provider is selected, do not rewrite the application.

Create one adapter:

```text
packages/providers/<provider-name>/
```

The adapter must:

1. Implement `FinancialProvider`.
2. Declare `ProviderCapabilities`.
3. Pass the shared provider contract tests.
4. Translate provider events into internal events.
5. Use provider idempotency keys.
6. Store raw provider payloads securely.
7. Never expose provider objects to application services.
8. Be enabled only by configuration.

Then execute the previously defined S1–S12 sandbox plan.

Provider integration begins only after the M0 gate permits it.

---

# 29. Immediate Owner Command

Give the implementation agent this instruction:

Implement only PV0 through PV2 first.

Do not build UI, HTTP endpoints, provider adapters, or financial SDK integrations during this pass.

The required output is:

1. Product-validation plan saved under `docs/product-validation/`.
2. Updated milestone sequence.
3. Explicit permitted and forbidden work lists.
4. Provider-import CI guard.
5. Complete Vink, Participant, Contribution and TemporaryCard domain types.
6. Money value object using integer minor units.
7. Vink and Contribution state machines.
8. Exact-total split engine.
9. Purchase-policy types.
10. Domain invariants and typed errors.
11. Unit tests for all valid and invalid transitions.
12. Database schema proposal synchronized with the domain.
13. Final report with changed files, tests and unresolved decisions.

Stop after PV2 and report before beginning PV3.
