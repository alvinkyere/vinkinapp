# 04 — Initial Database Schema

PostgreSQL 16+. This is the reference DDL for the financially-critical core (§30). Prisma
migrations (Milestone 1+) must produce exactly these constraints — **the uniqueness and trigger
rules here are the §12/§26 correctness guarantees; Prisma models are a projection of this doc,
not the other way around.**

Conventions: PK `id uuid default gen_random_uuid()` (switch to UUIDv7 when on PG18 or via app
generation — index locality); money `bigint` minor units, `currency char(3) not null default
'USD'`; statuses `text` + `CHECK` (revisit PG enums when Prisma owns migrations); every table
gets `created_at/updated_at timestamptz not null default now()`; soft deletes nowhere —
financial rows are never deleted (§26), non-financial rows use explicit status columns.

## 1. Identity & accounts (M2)

```sql
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164      text UNIQUE,
  email           citext UNIQUE,
  username        citext UNIQUE,
  status          text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE financial_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES users(id),
  status          text NOT NULL DEFAULT 'PENDING_VERIFICATION'
                  CHECK (status IN ('PENDING_VERIFICATION','ACTIVE','CONTRIBUTION_ONLY',
                    'ORGANIZER_ELIGIBLE','ADJUSTMENT_PENDING','RECOVERY_REQUIRED',
                    'RESTRICTED','SUSPENDED','CLOSED')),        -- §3.1
  risk_tier       text NOT NULL DEFAULT 'NEW',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE linked_payment_methods (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_account_id  uuid NOT NULL REFERENCES financial_accounts(id),
  provider              text NOT NULL,
  provider_method_id    text NOT NULL,          -- token only; never PAN/CVV (§35)
  kind                  text NOT NULL CHECK (kind IN ('CARD','APPLE_PAY','GOOGLE_PAY')),
  display_brand         text, display_last4 text, display_exp text,
  is_recovery_method    boolean NOT NULL DEFAULT false,          -- §23
  status                text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','EXPIRED','FAILED','REMOVED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_method_id)
);
-- one active recovery method per account
CREATE UNIQUE INDEX one_active_recovery_method
  ON linked_payment_methods (financial_account_id)
  WHERE is_recovery_method AND status = 'ACTIVE';
```

Also in M2 (DDL analogous, omitted here): `profiles`, `user_contacts`, `user_sessions`,
`user_devices`, `user_verifications`, `user_consents`, `financial_account_status_history`,
`organizer_eligibility`.

## 2. Vinks (M3)

```sql
CREATE TABLE vinks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_account_id   uuid NOT NULL REFERENCES financial_accounts(id),
  status                 text NOT NULL DEFAULT 'DRAFT',      -- §13 vocabulary
  category               text NOT NULL,                      -- §5.1 user-facing
  payment_policy         text NOT NULL CHECK (payment_policy IN
                           ('EXACT_FINAL','RESTAURANT_VARIABLE','VARIABLE_SETTLEMENT_UNSUPPORTED')),
  total_amount_minor     bigint NOT NULL CHECK (total_amount_minor > 0),
  max_total_amount_minor bigint NOT NULL,                    -- §21 maximum approved total
  slippage_limit_minor   bigint NOT NULL DEFAULT 0,          -- §20, frozen at creation
  currency               char(3) NOT NULL DEFAULT 'USD',
  merchant_name_hint     text,
  current_split_version  integer NOT NULL DEFAULT 1,
  -- §10.3 server-owned session boundaries:
  started_at                   timestamptz,
  submissions_close_at         timestamptz,
  expires_at                   timestamptz,
  processing_grace_expires_at  timestamptz,
  maximum_session_expires_at   timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (max_total_amount_minor >= total_amount_minor)
);

CREATE TABLE vink_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vink_id       uuid NOT NULL REFERENCES vinks(id),
  user_id       uuid REFERENCES users(id),        -- NULL for pure guests
  guest_contact text,                             -- phone/email for guest receipts
  role          text NOT NULL DEFAULT 'PARTICIPANT' CHECK (role IN ('ORGANIZER','PARTICIPANT','GUEST')),
  membership    text NOT NULL DEFAULT 'INVITED'   -- INVITED|LINK_OPENED|JOINED|REMOVED|REPLACED
);

CREATE TABLE vink_split_versions (              -- §15: immutable, append-only
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vink_id      uuid NOT NULL REFERENCES vinks(id),
  version      integer NOT NULL,
  reason       text NOT NULL,                   -- INITIAL|MEMBER_REMOVED|REVISED|COVER_REMAINING…
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vink_id, version)
);

CREATE TABLE vink_split_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_version_id  uuid NOT NULL REFERENCES vink_split_versions(id),
  member_id         uuid NOT NULL REFERENCES vink_members(id),
  base_amount_minor bigint NOT NULL CHECK (base_amount_minor >= 0),
  max_amount_minor  bigint NOT NULL,
  UNIQUE (split_version_id, member_id),
  CHECK (max_amount_minor >= base_amount_minor)
);
```

Also M3: `vink_sessions` (QR/guest link tokens, hashed), `vink_invitations`,
`vink_status_history`, `vink_receipts`.

## 3. Contributions (M5) — §11, §12

```sql
CREATE TABLE contribution_slots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vink_id              uuid NOT NULL REFERENCES vinks(id),
  member_id            uuid NOT NULL REFERENCES vink_members(id),
  split_version        integer NOT NULL,
  base_amount_minor    bigint NOT NULL CHECK (base_amount_minor > 0),
  maximum_amount_minor bigint NOT NULL,
  currency             char(3) NOT NULL DEFAULT 'USD',
  status               text NOT NULL DEFAULT 'PAYMENT_NOT_STARTED',   -- §11 vocabulary
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vink_id, member_id, split_version),
  CHECK (maximum_amount_minor >= base_amount_minor)
);

CREATE TABLE contribution_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_slot_id uuid NOT NULL REFERENCES contribution_slots(id),
  attempt_generation   integer NOT NULL,
  provider             text NOT NULL,
  provider_payment_id  text,
  payment_method_type  text NOT NULL,
  status               text NOT NULL DEFAULT 'PROCESSING',
  amount_minor         bigint NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contribution_slot_id, attempt_generation),          -- §12
  UNIQUE (provider, provider_payment_id)                      -- §12 (NULLs don't collide)
);
-- §11: at most one active-or-successful attempt per slot
CREATE UNIQUE INDEX one_live_attempt_per_slot
  ON contribution_attempts (contribution_slot_id)
  WHERE status IN ('PROCESSING','AUTHORIZED','CAPTURE_PENDING','CAPTURED');
```

Also M5: `contribution_captures` (capture_generation, amount, provider capture id, UNIQUE per
§12), `provider_payment_events` — see §6 below.

## 4. Idempotency & webhook inbox (M1 foundation; §12, §28)

```sql
CREATE TABLE idempotency_operations (
  operation_scope  text NOT NULL,      -- 'authorize' | 'capture' | 'refund' | 'issue-card' | …
  operation_id     text NOT NULL,      -- §12 formats, server-derived
  status           text NOT NULL DEFAULT 'IN_PROGRESS'
                   CHECK (status IN ('IN_PROGRESS','SUCCEEDED','FAILED')),
  request_hash     text,
  response_snapshot jsonb,
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_scope, operation_id)                 -- §12
);

CREATE TABLE provider_events (         -- raw webhook inbox, §28
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,
  event_type         text NOT NULL,
  payload            jsonb NOT NULL,
  signature_valid    boolean NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  occurred_at        timestamptz,      -- provider's own timestamp; decisions use THIS (§14/§28)
  processing_status  text NOT NULL DEFAULT 'PENDING'
                     CHECK (processing_status IN ('PENDING','PROCESSING','PROCESSED','FAILED','SKIPPED')),
  attempt_count      integer NOT NULL DEFAULT 0,
  last_error         text,
  processed_at       timestamptz,
  UNIQUE (provider, provider_event_id)                        -- §12/§26 exactly-once
);
```

## 5. Ledger (M6) — §26, enforcement included

```sql
CREATE TABLE ledger_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,   -- e.g. 'processor_clearing', 'vink_available:{vinkId}'
  kind          text NOT NULL CHECK (kind IN ('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY')),
  currency      char(3) NOT NULL DEFAULT 'USD',
  owner_scope   text NOT NULL,          -- PLATFORM | VINK | PARTICIPANT | ORGANIZER | PROVIDER
  owner_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_scope  text NOT NULL,
  operation_id     text NOT NULL,
  description      text NOT NULL,
  correlation_id   uuid,
  posted_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_scope, operation_id)   -- one posting per business operation (§26)
);

CREATE TABLE ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id      uuid NOT NULL REFERENCES ledger_accounts(id),
  direction       text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),   -- §26 positive integers only
  currency        char(3) NOT NULL DEFAULT 'USD',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, created_at);

-- §26 "posted entries cannot be updated or deleted": enforced in the database, not by convention
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger rows are append-only (%: %)', TG_TABLE_NAME, TG_OP;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
-- plus: app role gets INSERT/SELECT only on ledger_* (defense in depth)

-- §26 "every transaction must balance": deferred constraint trigger checks at COMMIT,
-- so multi-row inserts within the transaction are fine.
CREATE OR REPLACE FUNCTION assert_transaction_balanced() RETURNS trigger AS $$
DECLARE imbalance bigint; mixed int;
BEGIN
  SELECT COALESCE(SUM(CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END),0),
         COUNT(DISTINCT currency)
    INTO imbalance, mixed
    FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'unbalanced ledger transaction %: % minor units', NEW.transaction_id, imbalance;
  END IF;
  IF mixed > 1 THEN
    RAISE EXCEPTION 'mixed currencies in ledger transaction %', NEW.transaction_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_transaction_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();
```

`ledger_posting_batches`, `ledger_balance_projections` (materialized running balances,
rebuildable from entries), `reconciliation_runs/items`: M6.

## 6. Cards & merchant transactions (M7) — §16–§19

```sql
CREATE TABLE temporary_cards (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vink_id                     uuid NOT NULL UNIQUE REFERENCES vinks(id),  -- one card per vink (§3.2)
  provider                    text NOT NULL,
  provider_card_id            text NOT NULL,
  provider_cardholder_id      text NOT NULL,
  status                      text NOT NULL DEFAULT 'REQUESTED',
  spend_limit_minor           bigint NOT NULL,      -- funded + slippage/tip max (§20/§21)
  cumulative_authorized_minor bigint NOT NULL DEFAULT 0,
  cumulative_captured_minor   bigint NOT NULL DEFAULT 0,
  -- §18 merchant lock:
  locked_merchant_id   text, locked_merchant_name text, locked_mcc text,
  locked_merchant_country text, locked_terminal_id text, first_authorized_at timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_card_id)
);

CREATE TABLE authorization_decisions (   -- §17: one immutable row per provider auth event
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id                   uuid NOT NULL REFERENCES temporary_cards(id),
  provider_authorization_id text NOT NULL,
  decision                  text NOT NULL CHECK (decision IN ('APPROVED','DECLINED')),
  reason_code               text NOT NULL,   -- OK|DUPLICATE|OVER_LIMIT|MCC_MISMATCH|WRONG_MERCHANT|…
  classification            text,            -- §17: DUPLICATE_RETRY|REVERSAL_RETRY|INCREMENTAL|…
  amount_minor              bigint NOT NULL,
  merchant_id text, merchant_name text, mcc text, merchant_country text, terminal_id text,
  decided_in_ms             integer,         -- real-time auth latency observability (§37)
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_authorization_id)         -- §17 dedupe anchor
);
```

Also M7/M8: `cardholders`, `card_controls`, `card_display_sessions`, `authorizations` (network
lifecycle state per auth), `card_transactions`, `merchant_settlements`, `purchase_adjustments`
(§22 type/responsibility enums), `refunds`, `refund_disbursements`, `reimbursement_requests`,
`reimbursement_allocation_versions`, `reimbursement_payments`, `recovery_obligations`.

## 7. Platform operations (M1+)

```sql
CREATE TABLE outbox_events (            -- §29, written in the same txn as state changes (§27)
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- ordered relay cursor
  event_id       uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type     text NOT NULL,         -- §29 names
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  payload        jsonb NOT NULL,
  correlation_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;
```

Also: `notifications`, `notification_preferences`, `risk_events`, `audit_logs` (append-only,
same trigger pattern as ledger — §35 admin security), `support_cases`, `feature_flags`.

## 8. Transaction recipes (§27)

Contribution capture confirmation (webhook-driven), single transaction:

```text
BEGIN;
  SELECT * FROM contribution_slots WHERE id=$1 FOR UPDATE;
  SELECT * FROM contribution_attempts WHERE id=$2 FOR UPDATE;
  -- guard: attempt status transition legal (§ doc 03 rule 8)
  INSERT INTO ledger_transactions(operation_scope, operation_id, …)      -- 'capture', §12 key
  INSERT INTO ledger_entries …  (DEBIT processor_clearing / CREDIT participant_liability)
  UPDATE contribution_attempts SET status='CAPTURED' WHERE id=$2 AND status='CAPTURE_PENDING';
  UPDATE contribution_slots  SET status='CAPTURED' …;
  UPDATE vink funding projection;
  UPDATE provider_events SET processing_status='PROCESSED', processed_at=now() WHERE id=$3;
  INSERT INTO outbox_events(event_type='ContributionCaptured', …);
COMMIT;
```

Merchant authorization decision: identical shape, locking `temporary_cards` first (§17 order:
card → active auths), inserting `authorization_decisions` + ledger reserve before returning the
approve/decline to the provider within its real-time deadline.
