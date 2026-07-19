-- 0007 — Operator audit log (PV11, D17). Every mutating action taken through the
-- operations console is recorded here, attributed to the operator's typed name (D17: a
-- shared operator credential, not a per-operator account) — Spec §21 "record
-- operations-console actions in an audit log". Append-only by convention (no application
-- code ever updates or deletes a row); no DB trigger enforces it since, unlike the
-- financial ledger, a mistaken audit row has no money-correctness implication.

CREATE TABLE IF NOT EXISTS operator_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  operator_name TEXT NOT NULL,
  action TEXT NOT NULL,
  vink_id UUID REFERENCES vinks(id) ON DELETE SET NULL,
  details JSONB NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operator_audit_log_vink ON operator_audit_log(vink_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operator_audit_log_created ON operator_audit_log(created_at);
