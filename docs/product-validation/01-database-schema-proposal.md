# PV2 — Database Schema Proposal

Synchronized with `packages/domain` (Plan §7–§9). **Proposal only** — no migrations land in
PV2 (Plan §29 scope; migrations are PV2-completion work that begins with PV1's platform, and
the M0 gate's "production ledger migrations" prohibition stays respected: this schema carries
mock money for the validation build). Production-track reference DDL, including the ledger
enforcement triggers this proposal inherits, remains `docs/architecture/04-database-schema.md`.

Conventions: UUID primary keys (never sequential — Plan §21), `BIGINT` integer minor units
for every amount, `TIMESTAMPTZ` for every instant, `TEXT` + `CHECK` for status columns so the
DB rejects states the domain does not define. All status `CHECK` lists are generated from the
`packages/domain` unions — the domain is the source of truth; a drift is a failed migration
review.

## 1. Identity (Plan §6.1)

```sql
users (
  id UUID PK,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,   -- PV1 addition (auth deliverable); scrypt, never plaintext
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- LANDED in PV1 as apps/api/src/db/migrations/0001_identity.sql (users + auth_sessions).
auth_sessions (
  id UUID PK,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT UNIQUE NOT NULL,   -- SHA-256; raw token never stored
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  rotated_from UUID REFERENCES auth_sessions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

organizer_profiles (
  user_id UUID PK REFERENCES users(id),
  eligibility_status TEXT NOT NULL,   -- simulated during the mock build (Plan §7)
  identity_status TEXT NOT NULL,
  backup_payment_status TEXT NOT NULL,
  risk_status TEXT NOT NULL,
  created_at/updated_at TIMESTAMPTZ NOT NULL
)

guest_identities (
  id UUID PK,
  display_name TEXT NOT NULL,
  access_token_hash TEXT NOT NULL,    -- hashed, never the raw token (Plan §21)
  created_at TIMESTAMPTZ NOT NULL
)
```

## 2. Vink session (Plan §6.2, §7, §8)

```sql
vinks (
  id UUID PK,
  organizer_user_id UUID NOT NULL REFERENCES users(id),
  public_code TEXT UNIQUE NOT NULL,          -- cryptographically random
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  purchase_category TEXT NOT NULL CHECK (purchase_category IN
    ('GROCERY','RETAIL','ELECTRONICS','RESTAURANT','HOTEL','FUEL','CAR_RENTAL')),
  payment_policy TEXT NOT NULL CHECK (payment_policy IN
    ('EXACT_FINAL','RESTAURANT_VARIABLE','VARIABLE_SETTLEMENT_UNSUPPORTED')),
  subtotal_amount_minor BIGINT NOT NULL CHECK (subtotal_amount_minor >= 0),
  tip_amount_minor BIGINT NOT NULL CHECK (tip_amount_minor >= 0),
  maximum_amount_minor BIGINT NOT NULL CHECK (maximum_amount_minor >= 0),
  required_amount_minor BIGINT NOT NULL
    CHECK (required_amount_minor >= 0 AND required_amount_minor <= maximum_amount_minor),
  funded_amount_minor BIGINT NOT NULL DEFAULT 0
    CHECK (funded_amount_minor >= 0 AND funded_amount_minor <= maximum_amount_minor),
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN
    ('DRAFT','OPEN','SUBMISSIONS_CLOSED','PROCESSING_GRACE','FUNDED','EXPIRED',
     'CARD_PROVISIONING','CARD_READY','FUNDING_REVERSAL','PURCHASE_AUTHORIZED',
     'SETTLING','COMPLETED','RECOVERY_REQUIRED','RECOVERY_PENDING','CANCELLED','RESTRICTED')),
  submission_deadline TIMESTAMPTZ NOT NULL,        -- PostgreSQL owns deadline truth (Plan §10)
  processing_grace_deadline TIMESTAMPTZ NOT NULL,
  merchant_lock_status TEXT NOT NULL DEFAULT 'UNLOCKED'
    CHECK (merchant_lock_status IN ('UNLOCKED','LOCKED')),
  version BIGINT NOT NULL DEFAULT 1,               -- optimistic concurrency (Plan §11)
  created_at/updated_at TIMESTAMPTZ NOT NULL
)

vink_state_history (
  id UUID PK,
  vink_id UUID NOT NULL REFERENCES vinks(id),
  from_state TEXT NOT NULL,
  event TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor TEXT NOT NULL,               -- domain command name; never an API handler directly
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
)
```

State writes happen only through domain commands inside a `SELECT … FOR UPDATE` transaction
that also inserts the outbox event (Plan §8, §11, §12); every transition appends a
`vink_state_history` row.

## 3. Participation (Plan §6.3, §7)

```sql
participants (
  id UUID PK,
  vink_id UUID NOT NULL REFERENCES vinks(id),
  user_id UUID REFERENCES users(id),
  guest_identity_id UUID REFERENCES guest_identities(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ORGANIZER','MEMBER')),
  status TEXT NOT NULL CHECK (status IN ('INVITED','JOINED','REMOVED')),
  allocated_amount_minor BIGINT NOT NULL CHECK (allocated_amount_minor >= 0),
  maximum_approved_amount_minor BIGINT NOT NULL CHECK (maximum_approved_amount_minor >= 0),
  joined_at/updated_at TIMESTAMPTZ NOT NULL,
  CHECK ((user_id IS NULL) <> (guest_identity_id IS NULL))   -- exactly one identity (Plan §7)
)
```

## 4. Contributions (Plan §6.4, §7, §9)

```sql
contributions (
  id UUID PK,
  vink_id UUID NOT NULL REFERENCES vinks(id),
  participant_id UUID NOT NULL REFERENCES participants(id),
  requested_amount_minor BIGINT NOT NULL CHECK (requested_amount_minor >= 0),
  authorized_amount_minor BIGINT,
  captured_amount_minor BIGINT,
  refunded_amount_minor BIGINT,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN
    ('CREATED','AUTHORIZATION_PENDING','AUTHORIZED','DECLINED','RESOLUTION_PENDING',
     'CAPTURE_PENDING','CANCELLATION_PENDING','CANCELLED','CAPTURED','SETTLED',
     'REFUND_PENDING','REFUNDED','REFUND_FAILED')),
  provider_reference TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,     -- PG uniqueness is the final idempotency guard
  created_at/updated_at TIMESTAMPTZ NOT NULL
)
-- §4.7 guard, enforced in DB as well as domain:
--   CHECK (captured_amount_minor IS NULL
--          OR captured_amount_minor <= <participant maximum>) is cross-row → trigger
--   trg_contribution_within_approved_maximum BEFORE INSERT OR UPDATE
contribution_status_history ( … same shape as vink_state_history … )
```

## 5. Purchase destination (Plan §6.5, §7) — explicitly replaceable boundary

```sql
temporary_cards (
  id UUID PK,
  vink_id UUID NOT NULL REFERENCES vinks(id),
  provider_card_id TEXT NOT NULL,           -- mock provider reference
  display_last_four CHAR(4) NOT NULL CHECK (display_last_four ~ '^[0-9]{4}$'),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACTIVE','CLOSED','FAILED')),
  spending_limit_minor BIGINT NOT NULL CHECK (spending_limit_minor >= 0),
  merchant_lock_key TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ
)
-- No PAN/CVV columns exist, so none can be stored — even for mocks (Plan §7/§21).

purchase_authorizations (
  id UUID PK,
  vink_id UUID NOT NULL REFERENCES vinks(id),
  temporary_card_id UUID NOT NULL REFERENCES temporary_cards(id),
  provider_authorization_id TEXT NOT NULL,
  merchant_name TEXT NOT NULL,
  merchant_identifier TEXT NOT NULL,
  mcc TEXT NOT NULL,
  requested_amount_minor BIGINT NOT NULL CHECK (requested_amount_minor >= 0),
  approved_amount_minor BIGINT,
  status TEXT NOT NULL CHECK (status IN ('APPROVED','DECLINED','REVERSED','CAPTURED')),
  created_at/updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (provider_authorization_id)        -- duplicate merchant authorization dedupe (E4)
)

settlements (
  id UUID PK,
  vink_id UUID NOT NULL REFERENCES vinks(id),
  authorization_id UUID NOT NULL REFERENCES purchase_authorizations(id),
  settled_amount_minor BIGINT NOT NULL CHECK (settled_amount_minor >= 0),
  variance_amount_minor BIGINT NOT NULL CHECK (variance_amount_minor >= 0),  -- magnitude
  status TEXT NOT NULL CHECK (status IN ('MATCHED','OVERAGE','UNDERAGE')),
  settled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
)
```

## 6. Recovery (Plan §6.7, §7)

```sql
recovery_obligations (
  id UUID PK,
  vink_id UUID NOT NULL REFERENCES vinks(id),
  organizer_user_id UUID NOT NULL REFERENCES users(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL CHECK (reason IN ('SETTLEMENT_OVERAGE','MANUAL_ADJUSTMENT')),
  status TEXT NOT NULL CHECK (status IN ('CREATED','PENDING','RESOLVED','DEFAULTED')),
  due_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
)
```

## 7. Ledger (Plan §6.6, §18) — append-only, balanced, integer minor units

Inherits the production-track enforcement design (doc 04 §5) verbatim: `REVOKE UPDATE,
DELETE` on ledger tables plus triggers rejecting both; a deferred constraint trigger verifies
`SUM(debits) = SUM(credits)` per `transaction_id` at commit. Corrections are reversals.

```sql
ledger_accounts (
  id UUID PK,
  code TEXT UNIQUE NOT NULL CHECK (code IN
    ('processor_clearing','participant_contribution_liability','session_funding_balance',
     'issuing_funding_balance','purchase_authorization_reserve','vink_purchase_expense',
     'participant_refund_liability','organizer_recovery_receivable','provider_fee_expense',
     'platform_cash')),                     -- Plan §18 account set
  currency TEXT NOT NULL CHECK (currency = 'USD')
)

ledger_transactions (
  id UUID PK,
  reference_type TEXT NOT NULL,             -- 'contribution' | 'settlement' | …
  reference_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
)

ledger_entries (
  id UUID PK,
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
  account_id UUID NOT NULL REFERENCES ledger_accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  entry_type TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
)
```

## 8. Idempotency and outbox (Plan §11, §12)

```sql
operation_requests (
  idempotency_key TEXT PK,                  -- Plan §11 formats (domain `idempotencyKey.*`)
  request_fingerprint TEXT NOT NULL,        -- same key + different params = conflict error
  result JSONB,
  status TEXT NOT NULL CHECK (status IN ('IN_FLIGHT','SUCCEEDED','FAILED')),
  created_at/updated_at TIMESTAMPTZ NOT NULL
)

outbox_events (
  id UUID PK,
  event_type TEXT NOT NULL,                 -- Plan §12 core event names
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ                  -- NULL until the outbox worker publishes
)
```

## 9. Open items carried to migration time (PV2-completion / PV5)

- Cross-row §4.7 trigger shape (`contributions` vs `participants.maximum_approved_amount`).
- Whether `vinks.funded_amount_minor` is a stored column (fast reads) or a ledger projection
  (single source of truth) — proposal: stored column updated only inside the funding
  transaction, reconciled against the ledger by a sweep job.
- Partitioning/retention for history and outbox tables — not a validation-build concern.
