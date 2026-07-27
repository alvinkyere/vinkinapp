-- 0016 — Password reset (ENG5 Slice 2). Same shape as 0015's email_verification_tokens
-- (hashed-only, single-use, expiring) — no `email` snapshot column here, unlike that table:
-- resetting a password isn't verifying an address, it's proving control of an inbox at a
-- point in time, so there's nothing for a later email change to invalidate against.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
