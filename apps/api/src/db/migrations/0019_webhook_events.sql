-- 0019 — webhook event inbox (ENG6 Slice 4). §28's own three-step rule: verify signature,
-- store raw, dedupe on (provider, provider_event_id) — this table is step 2 and the DB-
-- enforced guard for step 3 (PostgreSQL uniqueness is the final guard, an app-layer check is
-- only ever an optimization ahead of it, same discipline as every other idempotency key in
-- this codebase). `occurred_at` is the provider's own event timestamp, never overwritten by
-- `received_at` — a future consumer (ENG6 Slice 5's reconciliation engine) must be able to
-- reconstruct true event order from `occurred_at`, never from delivery/arrival order, per
-- §28's own "decide by provider occurred_at — never arrival time." Nullable on the three
-- typed columns because a dead-lettered event (signature valid, but this adapter has no
-- mapping for the provider's event type) may not have a structured type/object/timestamp to
-- record — the raw body and the error are what an operator needs to inspect it regardless.
--
-- Deliberately NOT a job queue: no `attempts`/lease/backoff columns. This pass builds the
-- durable, deduped inbox only; a polling processor that actually reconciles these events
-- against ledger/settlement state is out of this slice's scope (ENG6 Slice 5) — inventing
-- automatic reconciliation behavior here would cross the ENG6 brief's own hard boundary
-- ("no automatic reconciliation repairs without reviewed rules").

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT,
  object_id TEXT,
  occurred_at TIMESTAMPTZ,
  raw_body TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'dead_letter')),
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_received
  ON webhook_events (provider, received_at);
