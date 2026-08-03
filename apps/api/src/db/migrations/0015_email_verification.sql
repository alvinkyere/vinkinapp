-- 0015 — Email verification (ENG5 Slice 1). `email_verified_at` is null until a real send
-- round-trip proves the address is reachable; the address is not deliverable until then.
-- Tokens are stored hashed only (D14 hard rule applied to every bearer secret in this
-- codebase), snapshot their own target `email` so a later email change can never be verified
-- by an in-flight token minted for the old address, and are single-use (`consumed_at`).

ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON email_verification_tokens(user_id);
