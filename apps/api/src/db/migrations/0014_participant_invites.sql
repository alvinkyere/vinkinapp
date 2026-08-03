-- 0014 — Participant invites (Invites feature, 2026-07-23): a real INVITED -> accept/decline
-- gate before a participant becomes JOINED, replacing today's immediate-JOINED add-existing-
-- member behavior (flag-gated, VINKIN_INVITES_ENABLED). `joined_at` becomes nullable — null
-- while INVITED, set to the real acceptance moment once accepted. `invited_at` is the new
-- "added to this Vink" timestamp every participant (invited or immediately joined) always has;
-- it replaces `joined_at` as the stable ordering key `setSplitCommand`'s EQUAL-remainder
-- determinism and every `ORDER BY` in this table already relied on.
ALTER TABLE participants ADD COLUMN invited_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill: every pre-existing row's invited_at = its own joined_at — the only timestamp that
-- existed before this migration, and semantically the closest available fact (every
-- participant before this feature existed was invited and joined atomically).
UPDATE participants SET invited_at = joined_at;

ALTER TABLE participants ALTER COLUMN joined_at DROP NOT NULL;
ALTER TABLE participants ALTER COLUMN joined_at DROP DEFAULT;
