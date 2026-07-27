-- 0018 — OAuth identities (ENG5 Slice 4). Generic across providers (`provider` discriminates)
-- rather than a separate table per provider — Slice 5 (Google) reuses this table exactly,
-- named and shaped for both from the start since the very same brief that requested Apple
-- names Google as the immediate next slice. One row links one external identity to exactly
-- one VinkIn account; a provider identity can never belong to more than one account
-- (UNIQUE (provider, provider_user_id)).

CREATE TABLE IF NOT EXISTS oauth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  provider_user_id TEXT NOT NULL,
  -- The email the provider vouched for at link time (may be an Apple private-relay address,
  -- may be null on a provider that discloses no email) — a snapshot, not a live join to
  -- users.email, since the account's own email can independently change later (Slice 1).
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);
