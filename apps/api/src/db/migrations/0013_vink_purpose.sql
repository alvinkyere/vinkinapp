-- 0013 — Purpose as first-class Vink metadata (Slice I5B, D39).
-- Purpose is human-readable payment context ("Team lunch", "Cabin weekend"), deliberately
-- separate from `purchase_category` (the policy input, still what `policyForCategory` reads —
-- untouched). Nullable: every Vink created before this migration, and every Vink the
-- five-step wizard (flag off) still creates, has no purpose — that is a valid, permanent
-- state, not a migration gap to backfill. The canonical create flow requires a non-empty
-- purpose client-side; nothing at the database or command layer enforces NOT NULL, since the
-- same POST /api/v1/vinks endpoint continues to serve both flows.
ALTER TABLE vinks ADD COLUMN IF NOT EXISTS purpose TEXT;
