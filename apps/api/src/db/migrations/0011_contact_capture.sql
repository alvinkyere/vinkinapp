-- 0011 — Contact capture and invitation delivery (Slice I4, D19/D27).
-- Investigation before writing this (per the I4 prompt's own instruction): `users.email` and
-- `users.phone` already exist (migration 0001, PV1) and `email` is already wired into
-- registration — this migration only adds what's genuinely missing: a contact destination on
-- guest identities (an organizer-initiated guest invite has never had anywhere to send an
-- automatic invite) and a delivery-attempt audit trail. Delivery is an infrastructure
-- concern, not domain state (Phase 10 §6, I4) — tracked in its own table, never a column on
-- `participants`, so `packages/domain`'s `Participant` entity stays untouched.

ALTER TABLE guest_identities
  ADD COLUMN IF NOT EXISTS contact_destination TEXT,
  ADD COLUMN IF NOT EXISTS contact_method TEXT CHECK (contact_method IN ('EMAIL', 'SMS'));

CREATE TABLE IF NOT EXISTS invitation_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED')),
  method TEXT NOT NULL CHECK (method IN ('EMAIL', 'SMS')),
  destination TEXT NOT NULL,
  provider_message_id TEXT,
  failure_reason TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitation_deliveries_participant
  ON invitation_deliveries(participant_id);
