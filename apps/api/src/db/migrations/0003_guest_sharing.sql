-- 0003 — Guest join & sharing (PV4, D14). Guest tokens are stored hashed with an explicit
-- expiry; one guest identity binds to exactly one participant slot (single-slot binding).

ALTER TABLE guest_identities
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days';

CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_identities_token
  ON guest_identities(access_token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_single_guest_slot
  ON participants(guest_identity_id) WHERE guest_identity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vinks_public_code ON vinks(public_code);
