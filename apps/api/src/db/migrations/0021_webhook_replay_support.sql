-- 0021 — ENG6 Slice 6 support columns on webhook_events.
--
-- `signature_header`: the raw signature this event was originally delivered with, stored so
-- an operator-triggered replay can genuinely re-run `parseWebhookEvent` (real cryptographic
-- verification against the stored raw_body) rather than re-inserting a row directly and
-- pretending verification happened. This is NOT the webhook secret itself — a signature is a
-- one-way HMAC output over a specific (timestamp, body) pair; possessing it grants no ability
-- to forge a signature for any other body, so storing it carries none of the risk storing a
-- secret key would. It is still never returned by any API response (Security: "never expose
-- webhook signatures") — write-only from the console's perspective, read only by the replay
-- code path itself. Nullable: historical rows from before this column existed (none in
-- practice, since this is pre-launch) simply cannot be replayed through real verification.
--
-- `delivery_count`: how many times this exact (provider, provider_event_id) — or, for a
-- dead-lettered row, this exact best-effort dedupe key — has been delivered, including the
-- first. Gives the webhook inbox a genuine "retry count" column instead of only "seen once."
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS signature_header TEXT;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS delivery_count INT NOT NULL DEFAULT 1;
