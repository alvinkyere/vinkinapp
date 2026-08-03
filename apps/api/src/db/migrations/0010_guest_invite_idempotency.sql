-- ENG1 Slice 4: idempotent guest invites. inviteGuestCommand had no duplicate protection at
-- all — a lost-response retry (or a double tap) created a second, genuinely separate guest
-- participant every time. Unlike Vink creation (Slice 2), the invite response's raw guest
-- token can never be recovered for a true replay (D14: only its hash is ever stored) — so
-- this table only needs to detect "this key was already used," not reconstruct the original
-- response. A detected duplicate is rejected (INVITE_ALREADY_SENT) rather than replayed; the
-- client treats that as success and refreshes state instead of showing an error.
CREATE TABLE IF NOT EXISTS guest_invite_idempotency (
  vink_id UUID NOT NULL REFERENCES vinks(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vink_id, idempotency_key)
);
