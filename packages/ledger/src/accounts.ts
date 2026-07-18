/** The Plan §18 account set, verbatim. The DB seeds exactly these codes. */
export const LEDGER_ACCOUNT_CODES = [
  'processor_clearing',
  'participant_contribution_liability',
  'session_funding_balance',
  'issuing_funding_balance',
  'purchase_authorization_reserve',
  'vink_purchase_expense',
  'participant_refund_liability',
  'organizer_recovery_receivable',
  'provider_fee_expense',
  'platform_cash',
] as const;

export type LedgerAccountCode = (typeof LEDGER_ACCOUNT_CODES)[number];
