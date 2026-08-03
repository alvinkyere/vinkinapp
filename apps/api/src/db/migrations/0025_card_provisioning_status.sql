-- 0025 — RM2 (D47): fine-grained card-assignment provisioning tracking + the QUARANTINED
-- card-pool safety state. Additive to migration 0024's schema, same "layered state" design
-- reasoned through in the RM2 milestone report: `cards.status`/`card_assignments.status`
-- (RM1) stay the coarse pool-membership/claim state exactly as already built and tested;
-- `provisioning_status` is new, narrower tracking of the enable -> wallet-provision ->
-- disable -> revoke handshake within one ACTIVE assignment. `returnCardToPoolCommand`'s own
-- RM1-proven security gate (checking the wallet token directly) is UNCHANGED by this
-- migration — provisioning_status is real, application-maintained tracking, not (yet) a
-- second enforced gate, so RM1's own tests keep passing unmodified.

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_status_check;
ALTER TABLE cards ADD CONSTRAINT cards_status_check
  CHECK (status IN ('AVAILABLE', 'RESERVED', 'QUARANTINED'));
-- QUARANTINED cards are automatically excluded from `reserveAvailableCard`'s own
-- `WHERE status = 'AVAILABLE'` query — no query change needed for the safety property "a
-- card an ambiguous provider outcome touched is never silently returned to the pool."

ALTER TABLE card_assignments ADD COLUMN IF NOT EXISTS provisioning_status TEXT NOT NULL
  DEFAULT 'RESERVED'
  CHECK (provisioning_status IN (
    'RESERVED',
    'ENABLING',
    'AWAITING_WALLET_PROVISIONING',
    'READY_TO_PAY',
    'DISABLING',
    'TOKEN_REVOCATION_PENDING',
    'SANITIZED'
  ));
