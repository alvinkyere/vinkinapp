-- 0020 — reconciliation scaffolding (ENG6 Slice 5). Two tables: `reconciliation_runs` is the
-- audit trail of *when* reconciliation executed and how much it examined; `reconciliation_findings`
-- is the durable, one-row-per-webhook-event output of classifying that event against VinkIn's
-- own records. Neither table is ever read by any command that mutates financial state — this
-- is read-only, additive scaffolding, per ENG6's own hard boundary against automatic
-- reconciliation repairs.
--
-- `webhook_event_id UNIQUE` is the actual idempotency guard (PostgreSQL uniqueness, the final
-- guard per this codebase's hard rule): re-running reconciliation over a webhook_events row
-- that already has a finding is a structural no-op, not an app-layer "already processed"
-- check that could drift from the database's own truth.
--
-- `seq BIGSERIAL` gives findings a deterministic total order for tests to prove processing
-- happened in provider `occurred_at` order, never HTTP arrival/received_at order (§28) — the
-- same pattern `contribution_status_history`/`ledger_entries`/`outbox_events` already use for
-- an identical reason.

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  events_examined INT NOT NULL DEFAULT 0,
  findings_created INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  run_id UUID NOT NULL REFERENCES reconciliation_runs(id),
  webhook_event_id UUID NOT NULL UNIQUE REFERENCES webhook_events(id),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  classification TEXT NOT NULL
    CHECK (classification IN ('EXPECTED', 'PENDING', 'MISMATCHED', 'ORPHANED', 'UNRECOGNIZED')),
  correlated_entity_type TEXT,
  correlated_entity_id UUID,
  -- Operator-review workflow only — never auto-advanced by any reconciliation code path.
  review_status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (review_status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  -- {reason, proposedRemediation?} — always prose for a human, never an executable action.
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_classification
  ON reconciliation_findings (classification, created_at);
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_review_open
  ON reconciliation_findings (created_at) WHERE review_status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_run ON reconciliation_findings (run_id);
