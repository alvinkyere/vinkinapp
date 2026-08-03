# ENG0–ENG15 Engineering Roadmap

Owner-supplied, resent in full 2026-07-27 after an earlier session had narrowed to a single
slice. This is the authoritative sequence for the engineering track (distinct from the UX/
product track, and distinct from the Spec's own M0–M10 sequence in
`docs/architecture/05-milestone-sequence.md`, which the PV track superseded — see CLAUDE.md's
own "Track note" reconciling this roadmap's ENG-numbering against what was actually already
built under other names). Record reconciliation notes and status against this document in
CLAUDE.md's running log, not by editing this file — this file is the owner's own verbatim
plan, kept as the source of truth for what was asked for.

---

You are right to stop me. I had narrowed the conversation to Slice 4 when you asked for the
**entire roadmap**.

Here is the full engineering plan from the current point onward.

# Current state

## Completed foundation

### Product-validation and architecture work

Already established:

* Node.js/TypeScript monorepo
* Flutter organizer application
* Next.js guest web application
* PostgreSQL
* Redis and BullMQ
* internal ledger and state machines
* payment-provider abstraction
* mock provider and conformance tests
* policy engine
* integer-minor-unit money model
* idempotency foundations
* CI and architecture guards
* financial-provider and legal feasibility documentation

### ENG0 — Baseline certification ✅

Completed:

* known-green baseline certified
* integration tests restored to the real test command
* formatting exclusions corrected
* architecture and run instructions documented
* verification suite certified

Baseline:

```text
fe876d7
```

### ENG1 Slice 1 — "Connecting…" hang ✅

Completed:

* bounded WebSocket connection
* connection errors propagated
* HTTP snapshot used for initial lobby state
* realtime no longer required for first paint
* shared HTTP receive timeout
* real iOS integration flow verified

### ENG1 Slice 2 — Idempotent Vink creation ✅

Completed:

* stable client-generated idempotency key
* server replay semantics
* PostgreSQL uniqueness constraint
* genuine race handling
* concurrent integration coverage
* duplicate Vink creation prevented

### ENG1 Slice 3 — Setup recovery ✅

Completed:

* local pre-network draft restoration
* server-persisted DRAFT recovery
* exact setup-step resolution
* correct routing for DRAFT, OPEN, expired, and completed states
* server-authoritative recovery
* real interruption and relaunch flow verified

---

# ENG1 — Core workflow correctness

This is the current milestone. Its purpose is to make the complete Vink workflow deterministic, recoverable, and safe before deployment.

## Slice 4 — Typed failures and duplicate-action protection

Next.

Implement:

* centralized API and domain failure model
* retryable versus terminal classification
* ambiguous-outcome handling
* canonical refresh after conflicts and uncertain mutations
* stable idempotency keys across legitimate retries
* duplicate-tap protection on every mutating action
* audit of every command for server-side idempotency

Commands to audit include:

* create Vink
* add participant
* remove participant
* update split
* open Vink
* organizer contribution
* guest contribution initiation
* invitation resend
* cancellation, where modeled
* merchant authorization
* merchant capture or simulation

The output should include a command matrix showing:

```text
Command
Idempotent?
Database guard?
Automatic retry allowed?
Refresh required after timeout?
UI in-flight protection?
```

## Slice 5 — Timer semantics

Centralize all timing rules.

Likely configuration surface:

```text
VINK_OPEN_DURATION_SECONDS
VINK_CONTRIBUTION_CUTOFF_SECONDS
VINK_PROCESSING_GRACE_SECONDS
VINK_SWEEP_INTERVAL_SECONDS
```

Clarify:

* when a Vink officially starts
* when contributions stop
* whether the final 10 seconds reject new payments
* what happens to in-flight contributions
* when expiry becomes authoritative
* when the deadline sweep runs
* how late callbacks are reconciled
* whether displayed countdown time matches server enforcement

The server owns the deadline. The client only displays it.

No timing value should be silently changed without checking the ratified product decisions.

## Slice 6 — Organizer contribution and merchant-payment separation

Separate these concepts completely:

```text
Organizer contributes their share
```

and:

```text
Organizer asks VinkIn to pay the merchant
```

Commands should resemble:

```text
ContributeOrganizerShare
RequestMerchantAuthorization
CaptureMerchantPurchase
```

This prevents a contribution action from accidentally carrying merchant-spending semantics.

Verify:

* organizer can contribute like any other member
* full funding does not itself imply a completed merchant purchase
* authorization eligibility is calculated separately
* capture is separate from authorization
* repeated authorization or capture requests are safe
* merchant simulation does not bypass domain invariants

## Slice 7 — Complete workflow certification

Run the entire workflow through real services:

```text
Create
→ add participants
→ configure split
→ review
→ open
→ organizer contributes
→ guests contribute
→ fully funded
→ authorize merchant payment
→ capture
→ completed
```

Test failures at every boundary:

* lost HTTP response
* duplicate request
* app termination
* guest refresh
* API restart
* worker restart
* Redis interruption
* delayed event
* duplicate event
* expired Vink
* contribution at cutoff
* merchant request before readiness

ENG1 is complete only when the workflow cannot:

* hang indefinitely
* create duplicates
* enter an impossible state
* rely on realtime for correctness
* silently retry unsafe mutations
* confuse contribution with merchant payment

---

# ENG2 — API and domain contracts

After workflow correctness, formalize the contracts around it.

Implement:

* typed request and response schemas
* runtime validation
* command/query separation
* stable error envelopes
* API versioning
* event-envelope versioning
* snapshot schemas
* pagination conventions
* correlation IDs
* idempotency conventions
* compatibility policy

Recommended API error shape:

```json
{
  "error": {
    "code": "VINK_EXPIRED",
    "message": "This Vink is no longer accepting contributions.",
    "retryable": false,
    "correlationId": "..."
  }
}
```

Screens should react to stable error codes, not raw server messages.

Also define event contracts such as:

```text
VinkCreated
ParticipantAdded
SplitConfigured
VinkOpened
ContributionAccepted
VinkFunded
MerchantAuthorizationRequested
MerchantAuthorized
MerchantCaptured
VinkCompleted
VinkExpired
RefundInitiated
RefundCompleted
```

ENG2 ends with contract tests proving that API clients, events, and snapshots agree.

---

# ENG3 — Client reliability architecture

This milestone turns the Flutter and guest-web clients from working interfaces into resilient applications.

## Flutter organizer application

Implement or harden:

* repository boundaries
* dependency injection
* command controllers
* shared failure mapping
* navigation coordinator
* launch recovery coordinator
* secure local storage
* cancellation and disposal
* app lifecycle handling
* connectivity recovery
* deep links
* background and foreground reconciliation
* stale-cache handling
* testable realtime abstraction
* Android platform validation

Important rule:

```text
HTTP snapshot = authority
Realtime event = invalidation signal
Client state = disposable projection
```

## Guest web

Implement or harden:

* secure invite-token exchange
* server rendering where useful
* hydration safety
* browser refresh recovery
* authoritative countdown
* contribution status recovery
* expired-link handling
* duplicate-submit protection
* mobile browser compatibility
* weak-network behavior
* accessibility
* safe return from payment-provider redirects

## Developer-environment reliability

The problems already found should become documented tooling:

* stale API processes
* unmanaged workers
* disk pressure from Flutter builds
* simulator daemon degradation
* migration and server-version mismatch

Add:

* local service status command
* cleanup command
* environment diagnostics
* reliable restart instructions
* process identification
* simulator recovery notes

---

# ENG4 — Private hosted infrastructure

Deploy a private, non-public pilot environment.

Recommended layout:

```text
vinkin.org
    Marketing website

join.vinkin.org
    Guest web on Vercel

api.vinkin.org
    API on Fly.io

worker
    Separate Fly.io process or app

ops.vinkin.org
    Operations console

Managed PostgreSQL

Managed Redis
```

Keep API and worker separate:

```text
API process
- HTTP
- WebSocket
- health endpoints

Worker process
- BullMQ jobs
- deadline sweeps
- outbox delivery
- provider callbacks
```

Start in one region.

Implement:

* Docker images
* Fly configuration
* environment validation
* migrations during deployment
* readiness and liveness checks
* private pilot secrets
* TLS
* database backups
* Redis durability appropriate for jobs
* deployment rollback
* release identifiers in logs
* private access restrictions

This is initially a **private technical deployment**, not yet a public pilot.

---

# ENG5 — Authentication and identity

Add real user authentication.

Initial organizer authentication:

* email OTP or magic link
* Sign in with Apple
* possibly Google sign-in for Android

Use a managed authentication provider unless a strong reason emerges not to.

Model separately:

```text
Authenticated organizer
Registered member
Guest contributor
Financially verified user
```

They are not the same identity level.

Guest participation should use scoped capability tokens:

* valid only for one Vink
* limited expiration
* limited commands
* revocable
* no access to unrelated Vinks

Do not build KYC here. KYC belongs later with the selected financial provider.

---

# ENG6 — Invitations and delivery

Create an invitation delivery abstraction:

```text
InvitationDeliveryProvider
├── Console
├── Email
└── SMS
```

Delivery flow:

```text
Participant added
→ domain event
→ transactional outbox
→ worker
→ provider
→ delivery attempt
→ delivery status
```

Implement:

* email invitation
* optional SMS invitation
* resend rules
* rate limits
* delivery status
* provider failure handling
* invite expiration
* token rotation
* abuse protection

Invitations must not be sent directly inside the core database transaction.

---

# ENG7 — Observability and auditability

Add production-grade visibility.

## Logging

Every request and job should carry:

* correlation ID
* request ID
* user or guest identity reference
* Vink ID
* command name
* idempotency key where applicable
* release version

Do not log:

* full card data
* secrets
* raw identity documents
* unnecessary personal information

## Metrics

Track:

* API latency
* error rates
* WebSocket connections
* reconnects
* job latency
* queue depth
* deadline sweep delay
* duplicate webhook count
* idempotency replay count
* contribution success rate
* authorization success rate
* refund status
* invitation delivery rate

## Alerts

Alert on:

* API unavailable
* worker unavailable
* queue backlog
* database exhaustion
* deadline jobs running late
* high provider failure rate
* reconciliation mismatch
* repeated invariant violations

## Audit trail

Financially meaningful commands need an immutable audit history:

```text
Who
What
When
Previous state
New state
Correlation ID
Provider reference
```

---

# ENG8 — Security hardening

Complete a security milestone before any external pilot.

Implement:

* rate limiting
* secret management
* token expiration and rotation
* strict authorization checks
* least-privilege database roles
* secure headers
* CORS allowlists
* CSRF strategy where applicable
* input-size limits
* replay protection
* webhook signature verification
* operations-console access control
* dependency scanning
* static analysis
* audit-log protection
* data-retention rules
* privacy review

Create a threat model covering:

* invite-link theft
* organizer impersonation
* duplicate contribution attempts
* payment replay
* malicious merchant simulation
* WebSocket subscription leakage
* ID enumeration
* deadline manipulation
* refund abuse
* privilege escalation in operations tools

---

# ENG9 — Remote workflow certification

Certify the system in the hosted environment under failure.

Test:

* API restart during setup
* worker restart during deadline processing
* Redis restart
* PostgreSQL failover or connection interruption
* WebSocket disconnect
* app backgrounding
* guest browser refresh
* stale client snapshot
* duplicate webhook
* out-of-order webhook
* delayed provider callback
* lost response after committed mutation
* two devices operating on one Vink
* simultaneous contributions
* contribution during cutoff
* expired token
* deployment during an active Vink

Produce a formal certification report with pass/fail evidence.

---

# ENG10 — Closed simulated pilot

Run a limited pilot with no real customer funds.

Participants use:

* real hosted applications
* real authentication
* real invitations
* real databases and queues
* simulated payment provider
* simulated card issuance
* simulated merchant authorization and capture

Measure:

* completion rate
* time to create a Vink
* time to join
* abandonment stage
* invitation delivery
* contribution completion
* recovery events
* support incidents
* confusion around organizer payment
* failure frequency by platform
* iOS versus Android versus guest web

This validates product behavior and operations without financial exposure.

---

# PV12 / Provider and legal closure

This can continue in parallel, but it gates real-money work.

Resolve:

* legal funds-flow model
* money-transmission exposure
* Reg E obligations
* custody of funds
* pooled-account structure
* KYC and sanctions screening
* chargebacks
* refunds
* negative balances
* dispute ownership
* cardholder identity
* merchant authorization model
* interchange eligibility
* prohibited use cases
* restaurant tips
* preauthorization variance
* partial funding
* expired Vinks
* organizer liability
* guest contributor treatment

Select the actual providers only after written feasibility confirmation.

Do not treat a sales conversation as legal or technical approval.

---

# M0 — Real-money authorization gate

No real-money engineering begins until the milestone gate is satisfied.

The gate should require, at minimum:

* approved legal structure
* approved funds flow
* provider written feasibility
* commercial terms understood
* compliance responsibilities assigned
* dispute and refund model approved
* KYC owner selected
* transaction limits defined
* prohibited categories defined
* financial-loss exposure accepted

Until M0 passes:

* provider SDKs remain isolated
* real-money feature flags remain off
* no production payment credentials
* no customer funds

---

# ENG11 — Provider integration foundation

Once M0 passes, build the real provider adapter behind the existing abstraction.

Implement:

* provider client
* credential management
* webhook receiver
* signature validation
* webhook inbox
* deduplication
* event ordering strategy
* reconciliation
* provider-reference mapping
* retry and dead-letter handling
* sandbox-only feature flags
* provider contract tests

No provider-specific types should leak into the core domain.

---

# ENG12 — Financial provider sandbox

Implement the complete sandbox funds flow:

```text
Contributor payment
→ provider confirmation
→ internal ledger posting
→ Vink funding state
→ card eligibility
→ virtual card issuance
→ merchant authorization
→ capture
→ refund or release
→ reconciliation
```

Verify:

* amount invariants
* duplicate callbacks
* delayed callbacks
* partial authorization
* reversed authorization
* declined authorization
* partial capture
* refund
* chargeback representation
* provider/internal-ledger mismatch
* failed issuance
* expired card
* merchant-category restriction

The internal ledger remains the source of Vink accounting truth. Provider data is reconciled against it.

---

# ENG13 — KYC and compliance workflows

Use provider-hosted or provider-approved verification.

Implement:

* verification-required state
* verification-session launch
* callback handling
* pending, verified, rejected, and review states
* sanctions or eligibility restrictions
* age and jurisdiction restrictions
* re-verification
* support escalation
* consent and disclosures
* data minimization

Avoid storing identity documents unless absolutely required.

---

# ENG14 — Controlled real-money pilot

Launch to a very small, manually approved cohort.

Controls should include:

* low per-Vink limits
* low daily limits
* approved categories only
* domestic users only, initially
* organizer allowlist
* manual monitoring
* rapid kill switch
* manual provider reconciliation
* direct participant support
* no gas, hotels, or high-variance merchants
* restaurant mode disabled unless specifically approved

Expand only after stable evidence.

---

# ENG15 — Production readiness and scale

After the controlled pilot succeeds:

* multi-region strategy
* database scaling
* Redis and queue scaling
* disaster recovery
* formal incident response
* reconciliation automation
* support tooling
* fraud controls
* risk scoring
* dynamic limits
* provider redundancy where feasible
* SLOs and error budgets
* privacy compliance
* retention automation
* penetration testing
* app-store production releases
* Google Play production release
* operational staffing
* customer support procedures

---

# Parallel UI/UX track

The UI/UX work remains separate, as you requested.

It owns:

* user journeys
* screen design
* interaction behavior
* content and copy
* visual system
* animation
* accessibility experience
* usability testing
* product-behavior specifications

Engineering owns the mechanisms and guarantees beneath those decisions.

When engineering discovers a conflict, it should document it and return it to the UX/product decision process—not silently redesign the product.

---

# The actual sequence

```text
ENG0  Baseline certification                         ✅

ENG1  Core workflow correctness                      ← current
      Slice 1: Connecting hang                       ✅
      Slice 2: Idempotent creation                   ✅
      Slice 3: Setup recovery                        ✅
      Slice 4: Retry classification and duplicates
      Slice 5: Timer semantics
      Slice 6: Organizer/merchant command split
      Slice 7: Workflow certification

ENG2  API and event contracts

ENG3  Client reliability architecture

ENG4  Private Fly.io deployment

ENG5  Authentication

ENG6  Invitation delivery

ENG7  Observability and audit trail

ENG8  Security hardening

ENG9  Hosted failure certification

ENG10 Closed simulated pilot

PV12  Provider and legal closure                     parallel gate

M0    Real-money authorization gate

ENG11 Real-provider integration foundation

ENG12 Provider sandbox funds flow

ENG13 KYC and compliance

ENG14 Controlled real-money pilot

ENG15 Production readiness and scaling
```

So the immediate next action is still **ENG1 Slice 4**, but it is only one part of a much larger plan. We are currently making the local workflow trustworthy; we have not yet reached deployment, authentication, real provider integration, KYC, or real-money operation.
