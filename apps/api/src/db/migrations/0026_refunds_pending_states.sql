-- 0026 — RM3A (D47): two new non-terminal Vink states, REFUNDS_PENDING and
-- REFUND_RECOVERY_REQUIRED, sitting between PROCESSING_GRACE and EXPIRED. The
-- capture-immediately funding engine means unfunded expiry may need to refund already-captured
-- money, not merely cancel holds — see packages/domain/src/vink-state-machine.ts's own header
-- comment for why these can't be reached by giving EXPIRED (a tested terminal state) a new
-- outgoing edge. `funded_amount_minor`'s own CHECK is untouched — these states don't change
-- what "funded" means, only what happens when funding fails after some money already moved.

ALTER TABLE vinks DROP CONSTRAINT IF EXISTS vinks_state_check;
ALTER TABLE vinks ADD CONSTRAINT vinks_state_check
  CHECK (state IN
    ('DRAFT','OPEN','SUBMISSIONS_CLOSED','PROCESSING_GRACE','FUNDED',
     'REFUNDS_PENDING','REFUND_RECOVERY_REQUIRED','EXPIRED',
     'CARD_PROVISIONING','CARD_READY','FUNDING_REVERSAL','PURCHASE_AUTHORIZED',
     'SETTLING','COMPLETED','RECOVERY_REQUIRED','RECOVERY_PENDING','CANCELLED','RESTRICTED'));
