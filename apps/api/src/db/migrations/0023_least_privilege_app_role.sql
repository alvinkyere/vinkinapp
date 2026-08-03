-- 0023 — least-privilege database role (ENG8). A grep across every non-test query in
-- apps/api/src confirms the running application never issues DELETE, TRUNCATE, or any DDL —
-- "removal" everywhere in this codebase is a soft-state UPDATE (participants, guests,
-- reconciliation findings), and every append-only table (ledger_entries, vink_state_history,
-- contribution_status_history, operator_audit_log) is already enforced append-only at the DB
-- level (see this same migration's trigger below, and 0004's existing
-- `ledger_entries_append_only`) — so the role the running app connects as needs exactly
-- SELECT/INSERT/UPDATE, nothing more.
--
-- This migration CREATEs the role and grants it those privileges on every table that exists
-- as of migration 0023, plus default privileges so future tables created BY THE SAME ROLE
-- THAT RUNS THIS MIGRATION (whatever connects as the migration runner in each environment —
-- `vinkin` locally via docker-compose, Railway's provisioned owner remotely) are covered
-- automatically. It does NOT change which role `apps/api` actually connects as — that is a
-- real credential/deploy-config action (a new `DATABASE_URL` using this role, with a real
-- password set via `ALTER ROLE vinkin_app PASSWORD '...'`, never checked into this
-- migration), left to the owner. Same "code-complete but not provisioned" shape as ENG4
-- Slice 2's Railway topology — migrations still run with today's existing full-privilege
-- connection, unchanged, until that swap happens.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vinkin_app') THEN
    -- A LOGIN role needs SOME password to be connectable at all; this one is deliberately
    -- not a usable secret (`ALTER ROLE ... PASSWORD` is required before this role is ever
    -- wired into a real DATABASE_URL) and is never logged or referenced again.
    CREATE ROLE vinkin_app LOGIN PASSWORD 'unset-set-a-real-password-before-use';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO vinkin_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO vinkin_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vinkin_app;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO vinkin_app;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vinkin_app;

-- ENG8 ("audit-log protection"): `operator_audit_log` never had DB-level append-only
-- enforcement — only the ledger did (0004's `ledger_entries_append_only`). This mirrors that
-- exact trigger for the three other audit/history tables that, unlike the ledger, previously
-- relied on "no application code ever updates or deletes a row" as a convention rather than
-- a guarantee.
CREATE OR REPLACE FUNCTION audit_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no corrections are ever destructive here)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operator_audit_log_append_only ON operator_audit_log;
CREATE TRIGGER trg_operator_audit_log_append_only
  BEFORE UPDATE OR DELETE ON operator_audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_history_append_only();

DROP TRIGGER IF EXISTS trg_vink_state_history_append_only ON vink_state_history;
CREATE TRIGGER trg_vink_state_history_append_only
  BEFORE UPDATE OR DELETE ON vink_state_history
  FOR EACH ROW EXECUTE FUNCTION audit_history_append_only();

DROP TRIGGER IF EXISTS trg_contribution_status_history_append_only ON contribution_status_history;
CREATE TRIGGER trg_contribution_status_history_append_only
  BEFORE UPDATE OR DELETE ON contribution_status_history
  FOR EACH ROW EXECUTE FUNCTION audit_history_append_only();
