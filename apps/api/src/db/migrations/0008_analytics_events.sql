-- 0008 — Funnel analytics events (PV12 prep). Client-reported events for exactly what
-- persisted domain state can't show: where in the funnel someone abandoned or hit an
-- error before anything else was written to the database. Everything else the PV12 exit
-- gate needs (completed-Vink count, participant joins, organizer task completion rate,
-- median join-to-contribution time) is computed straight from existing tables — this table
-- exists only to make failure/drop-off points visible, not to duplicate what's already
-- recorded.

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  client_id TEXT NOT NULL,     -- client-generated, persisted locally; correlates anonymous
                                -- (pre-join, pre-login) events without requiring an account
  app TEXT NOT NULL CHECK (app IN ('organizer_mobile', 'guest_web')),
  event_name TEXT NOT NULL,
  vink_id UUID REFERENCES vinks(id) ON DELETE SET NULL,
  properties JSONB NOT NULL CHECK (jsonb_typeof(properties) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL,  -- client clock, when the event actually happened
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_vink ON analytics_events(vink_id) WHERE vink_id IS NOT NULL;
