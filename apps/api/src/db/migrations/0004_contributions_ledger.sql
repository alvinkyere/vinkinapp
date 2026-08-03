-- 0004 — Contributions + ledger (PV5; D2 ledger timing). Mock money, production-grade
-- rules: the ledger is append-only and balanced, enforced by triggers (doc 04 §5 design).

CREATE TABLE IF NOT EXISTS contributions (
  id UUID PRIMARY KEY,
  vink_id UUID NOT NULL REFERENCES vinks(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id),
  attempt_number INT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  requested_amount_minor BIGINT NOT NULL CHECK (requested_amount_minor >= 0),
  authorized_amount_minor BIGINT CHECK (authorized_amount_minor >= 0),
  captured_amount_minor BIGINT CHECK (captured_amount_minor >= 0),
  refunded_amount_minor BIGINT CHECK (refunded_amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN
    ('CREATED','AUTHORIZATION_PENDING','AUTHORIZED','DECLINED','RESOLUTION_PENDING',
     'CAPTURE_PENDING','CANCELLATION_PENDING','CANCELLED','CAPTURED','SETTLED',
     'REFUND_PENDING','REFUNDED','REFUND_FAILED')),
  provider_reference TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,   -- PostgreSQL uniqueness is the final guard (§12)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contributions_vink ON contributions(vink_id);

-- Exit-gate guard: a participant has at most ONE live contribution — a concurrent
-- double-tap cannot double-count (declined/cancelled attempts free the slot for a retry).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_one_live_per_participant
  ON contributions(participant_id)
  WHERE status NOT IN ('DECLINED','CANCELLED');

CREATE TABLE IF NOT EXISTS contribution_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  event TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contribution_history ON contribution_status_history(contribution_id, seq);

-- --- Ledger (Plan §18) -------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD')
);

INSERT INTO ledger_accounts (code) VALUES
  ('processor_clearing'),
  ('participant_contribution_liability'),
  ('session_funding_balance'),
  ('issuing_funding_balance'),
  ('purchase_authorization_reserve'),
  ('vink_purchase_expense'),
  ('participant_refund_liability'),
  ('organizer_recovery_receivable'),
  ('provider_fee_expense'),
  ('platform_cash')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
  account_id UUID NOT NULL REFERENCES ledger_accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  entry_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_txn ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);

-- Append-only: no UPDATE or DELETE, ever. Corrections are reversal postings.
CREATE OR REPLACE FUNCTION ledger_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (corrections are reversals)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

-- Balanced-at-commit: every transaction's debits must equal its credits. Deferred so a
-- posting's rows can be inserted one by one inside the transaction.
CREATE OR REPLACE FUNCTION ledger_transaction_balanced() RETURNS trigger AS $$
DECLARE
  debit_total BIGINT;
  credit_total BIGINT;
BEGIN
  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0),
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0)
  INTO debit_total, credit_total
  FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced: debits % != credits %',
      NEW.transaction_id, debit_total, credit_total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_transaction_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER trg_ledger_transaction_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transaction_balanced();
