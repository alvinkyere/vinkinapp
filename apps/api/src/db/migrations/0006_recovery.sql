-- 0006 — Recovery obligations (PV7). Organizer restriction is represented at the vink state
-- (RESTRICTED) + an OrganizerRestricted event; a full FinancialAccount lands in a later
-- milestone. Refund state lives on the existing contributions table (PV4/PV5 status set).

CREATE TABLE IF NOT EXISTS recovery_obligations (
  id UUID PRIMARY KEY,
  vink_id UUID NOT NULL REFERENCES vinks(id) ON DELETE CASCADE,
  organizer_user_id UUID NOT NULL REFERENCES users(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL CHECK (reason IN ('SETTLEMENT_OVERAGE', 'MANUAL_ADJUSTMENT')),
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'PENDING', 'RESOLVED', 'DEFAULTED')),
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  due_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One open recovery obligation per vink (a settlement produces exactly one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_one_open_per_vink
  ON recovery_obligations(vink_id) WHERE status IN ('CREATED', 'PENDING');
