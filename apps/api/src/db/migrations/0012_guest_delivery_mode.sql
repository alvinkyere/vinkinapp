-- 0012 — Guest invitation delivery mode + deferred token minting (Slice I4B, D38).
--
-- I4 minted a guest's access token synchronously at invite time regardless of whether the
-- organizer intended manual sharing or automatic delivery — a raw token cannot be minted
-- again later without invalidating the original (single-slot `access_token_hash`), and D14
-- forbids ever holding the raw token past its one-time HTTP response. Automatic delivery
-- deferred to VINK_OPENED (D23) therefore needs the token minted AT that later moment, not
-- at invite time — so `access_token_hash`/`expires_at` must be nullable until a token
-- actually exists. `delivery_mode` makes the organizer's SMS/email/manual choice an explicit,
-- stored fact (never inferred from provider availability) instead of leaving it implicit in
-- whether `contact_destination` happens to be set.

ALTER TABLE guest_identities
  ALTER COLUMN access_token_hash DROP NOT NULL,
  ALTER COLUMN expires_at DROP NOT NULL,
  ALTER COLUMN expires_at DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (delivery_mode IN ('SMS', 'EMAIL', 'MANUAL'));

-- A guest row with SMS/EMAIL mode and no token yet is genuinely unauthenticatable (no hash
-- can ever equal NULL), so nothing further is needed to keep it inert until dispatch mints
-- one — `idx_guest_identities_token` (migration 0003) already tolerates multiple NULLs under
-- a standard btree unique index.
