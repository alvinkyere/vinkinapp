-- 0017 — Magic-link (passwordless) login (ENG5 Slice 3). Same shape as 0016's
-- password_reset_tokens (hashed-only, single-use, no email snapshot, no password involved) —
-- the token itself is the only credential, and it grants an immediate real session on
-- confirm, same as a successful login/register.

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_user ON magic_link_tokens(user_id);
