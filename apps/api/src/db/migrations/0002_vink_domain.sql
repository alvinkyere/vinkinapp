-- 0002 — Vink domain (PV3). Synchronized with docs/product-validation/01-database-schema-proposal.md
-- §§2–3 and packages/domain (the CHECK lists mirror the domain unions — domain is source of truth).

CREATE TABLE IF NOT EXISTS guest_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  access_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vinks (
  id UUID PRIMARY KEY,
  organizer_user_id UUID NOT NULL REFERENCES users(id),
  public_code TEXT UNIQUE NOT NULL,
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
  submission_deadline TIMESTAMPTZ NOT NULL,
  processing_grace_deadline TIMESTAMPTZ NOT NULL,
  merchant_lock_status TEXT NOT NULL DEFAULT 'UNLOCKED'
    CHECK (merchant_lock_status IN ('UNLOCKED','LOCKED')),
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY,
  vink_id UUID NOT NULL REFERENCES vinks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  guest_identity_id UUID REFERENCES guest_identities(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ORGANIZER','MEMBER')),
  status TEXT NOT NULL CHECK (status IN ('INVITED','JOINED','REMOVED')),
  allocated_amount_minor BIGINT NOT NULL CHECK (allocated_amount_minor >= 0),
  maximum_approved_amount_minor BIGINT NOT NULL CHECK (maximum_approved_amount_minor >= 0),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (guest_identity_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_participants_vink ON participants(vink_id);

CREATE TABLE IF NOT EXISTS vink_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vink_id UUID NOT NULL REFERENCES vinks(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  event TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vink_state_history_vink ON vink_state_history(vink_id, created_at);

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events(occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON outbox_events(aggregate_type, aggregate_id, occurred_at);

CREATE TABLE IF NOT EXISTS operation_requests (
  idempotency_key TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  result JSONB,
  status TEXT NOT NULL CHECK (status IN ('IN_FLIGHT','SUCCEEDED','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
