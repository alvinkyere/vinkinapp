-- 0005 — Mock temporary cards, merchant authorizations, settlements (PV6).
-- Synchronized with docs/product-validation/01-database-schema-proposal.md §5.

CREATE TABLE IF NOT EXISTS temporary_cards (
  id UUID PRIMARY KEY,
  vink_id UUID UNIQUE NOT NULL REFERENCES vinks(id) ON DELETE CASCADE,
  provider_card_id TEXT NOT NULL,
  display_last_four CHAR(4) NOT NULL CHECK (display_last_four ~ '^[0-9]{4}$'),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACTIVE','CLOSED','FAILED')),
  spending_limit_minor BIGINT NOT NULL CHECK (spending_limit_minor >= 0),
  merchant_lock_key TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ
);
-- No PAN/CVV columns exist, so none can be stored — even for mocks (Plan §7/§21).

CREATE TABLE IF NOT EXISTS purchase_authorizations (
  id UUID PRIMARY KEY,
  vink_id UUID NOT NULL REFERENCES vinks(id) ON DELETE CASCADE,
  temporary_card_id UUID NOT NULL REFERENCES temporary_cards(id),
  provider_authorization_id TEXT,
  merchant_name TEXT NOT NULL,
  merchant_identifier TEXT NOT NULL,
  mcc TEXT NOT NULL,
  requested_amount_minor BIGINT NOT NULL CHECK (requested_amount_minor >= 0),
  approved_amount_minor BIGINT CHECK (approved_amount_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('APPROVED','DECLINED','REVERSED','CAPTURED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Duplicate merchant authorization dedupe (journey E4).
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_auth_provider
  ON purchase_authorizations(provider_authorization_id)
  WHERE provider_authorization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_auth_vink ON purchase_authorizations(vink_id);

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY,
  vink_id UUID NOT NULL REFERENCES vinks(id) ON DELETE CASCADE,
  authorization_id UUID NOT NULL REFERENCES purchase_authorizations(id),
  settled_amount_minor BIGINT NOT NULL CHECK (settled_amount_minor >= 0),
  variance_amount_minor BIGINT NOT NULL CHECK (variance_amount_minor >= 0),  -- magnitude
  status TEXT NOT NULL CHECK (status IN ('MATCHED','OVERAGE','UNDERAGE')),
  settled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settlements_vink ON settlements(vink_id);
