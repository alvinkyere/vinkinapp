-- 0024 — Real-Money Beta card pool (D47, RM1). Additive only: `temporary_cards` and its
-- one-shot per-Vink issuance model are UNTOUCHED by this migration — `provisionCardCommand`/
-- `authorizeMerchantPurchaseCommand`/`settlePurchaseCommand` keep working exactly as before
-- until a later RM slice actually cuts the live FUNDED-Vink flow over to this new schema.
-- This migration lands the new, independently-tested infrastructure first, same "code-
-- complete, not yet wired into the live path" precedent as ENG8's `vinkin_app` role and ENG6
-- Slice 4's webhook ingestion (built before Slice 5's reconciliation processor read it).
--
-- `cards` is long-lived and reusable — the opposite of `temporary_cards.vink_id UNIQUE NOT
-- NULL`, which makes a card the permanent child of exactly one Vink. `card_assignments` is
-- the per-Vink usage history; a `UNIQUE (vink_id)` on it (a Vink is only ever assigned a card
-- once, never reassigned across attempts) plus a partial `UNIQUE (card_id) WHERE status =
-- 'ACTIVE'` on it together give PostgreSQL's own uniqueness (the hard rule's final guard) as
-- the actual enforcement of "a card may only belong to one active Vink at a time" — not
-- merely an application-level check.
--
-- `card_wallet_tokens` is deliberately its own table, not a column on `card_assignments`:
-- authorizations are approved against the assigned wallet token, not solely the underlying
-- card (D47) — the token is a first-class, independently revocable identity. A card is only
-- returnable to the pool once its assignment's token is confirmed REVOKED (enforced by the
-- application command that performs the return, not by a DB constraint here — the constraint
-- layer only guarantees at most one token row per assignment).

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY,
  provider_card_id TEXT NOT NULL,
  display_last_four CHAR(4) NOT NULL CHECK (display_last_four ~ '^[0-9]{4}$'),
  status TEXT NOT NULL CHECK (status IN ('AVAILABLE','RESERVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- No PAN/CVV columns exist, so none can be stored (Plan §7/§21) — unchanged discipline from
-- `temporary_cards`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_provider_card_id ON cards(provider_card_id);

CREATE TABLE IF NOT EXISTS card_assignments (
  id UUID PRIMARY KEY,
  card_id UUID NOT NULL REFERENCES cards(id),
  vink_id UUID NOT NULL UNIQUE REFERENCES vinks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','RETURNED')),
  spending_limit_minor BIGINT NOT NULL CHECK (spending_limit_minor >= 0),
  merchant_lock_key TEXT,
  reserved_at TIMESTAMPTZ NOT NULL,
  -- The D47 10-minute card usage window — distinct from the Vink's own 7-minute
  -- submission_deadline (RM4's concern; the column exists now since it's part of this
  -- table's own shape, not yet read by any sweep in this migration's own slice).
  usage_window_expires_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_assignments_active_card
  ON card_assignments(card_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_card_assignments_card ON card_assignments(card_id, reserved_at);

CREATE TABLE IF NOT EXISTS card_wallet_tokens (
  id UUID PRIMARY KEY,
  card_assignment_id UUID NOT NULL UNIQUE REFERENCES card_assignments(id),
  provider_token_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROVISIONED','REVOKED')),
  provisioned_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
