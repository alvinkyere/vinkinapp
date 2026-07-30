-- 0027 — RM3B (D47): cut purchase_authorizations over to support the card pool alongside the
-- legacy one-shot temporary_cards path. Mirrors the existing `participants.user_id`/
-- `guest_identity_id` mutual-exclusivity idiom (migration 0002) — exactly one of
-- temporary_card_id / card_assignment_id is ever set on a given row, so a legacy in-flight
-- purchase_authorizations row (temporary_card_id set) round-trips unchanged.

ALTER TABLE purchase_authorizations ALTER COLUMN temporary_card_id DROP NOT NULL;
ALTER TABLE purchase_authorizations ADD COLUMN card_assignment_id UUID
  REFERENCES card_assignments(id);
ALTER TABLE purchase_authorizations ADD CONSTRAINT purchase_authorizations_card_ref_check
  CHECK ((temporary_card_id IS NOT NULL) <> (card_assignment_id IS NOT NULL));
