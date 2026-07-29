-- 0022 — ENG7 ("Observability and auditability") audit-trail completion. Two additive
-- columns, both nullable (existing rows predate them; every new write supplies a value):
--
-- `contribution_status_history.provider_reference` — the roadmap's own named audit-trail
-- field template ("Who, What, When, Previous state, New state, Correlation ID, Provider
-- reference") was missing this one field even though the live `contributions` row already
-- carries it at the exact moment `applyContributionTransition` writes each history row.
-- Deliberately NOT added to `vink_state_history`: a vink-level transition (e.g.
-- FUNDING_CONFIRMED) spans multiple contributions, each with its own provider reference —
-- there is no single meaningful "the provider reference" at that granularity, so adding a
-- column there would invite exactly one value to be guessed at arbitrarily.
--
-- `operator_audit_log.correlation_id` — the same field, for the OTHER existing audit
-- mechanism (PV11/D17). Without it, an operator action couldn't be correlated back to the
-- request/trace id every other log line and history row already carries.
ALTER TABLE contribution_status_history ADD COLUMN IF NOT EXISTS provider_reference TEXT;
ALTER TABLE operator_audit_log ADD COLUMN IF NOT EXISTS correlation_id TEXT;
