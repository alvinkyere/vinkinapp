/**
 * Provider-neutral error taxonomy. Adapters translate provider errors into these codes;
 * the orchestrator branches on `code` and `retryable`, never on provider-specific strings.
 *
 * ENG6 Slice 2 additions (`INVALID_REQUEST`, `COMPLIANCE_BLOCKED`, `UNKNOWN_OUTCOME`):
 * a normal, expected per-transaction decline ("this specific card was declined for
 * insufficient funds") is NOT modeled here — that's `AuthorizationResult.declineReason`
 * (`ContributionDeclineReason` in types.ts), a typed return value, not a thrown error. This
 * taxonomy is for conditions where the OPERATION ITSELF couldn't be evaluated normally:
 * malformed input, an outage, an account-level compliance block, or a genuinely ambiguous
 * result. Conflating "this transaction was declined" with "this call failed" would make
 * ordinary business outcomes look like operational failures.
 */

export type ProviderErrorCode =
  | 'IDEMPOTENCY_CONFLICT' // same key, different parameters — a §12 violation upstream (duplicate)
  | 'INVALID_STATE' // e.g. capture after cancel; transition not legal for object state
  | 'AMOUNT_EXCEEDS_AUTHORIZATION' // capture/refund above held/captured amount (§4.7 guard)
  | 'OBJECT_NOT_FOUND'
  | 'INVALID_SIGNATURE' // webhook signature verification failed (§28)
  | 'PROVIDER_UNAVAILABLE' // transient; retry with SAME idempotency key (§12)
  | 'NOT_SUPPORTED' // capability absent on this provider — must be visible, never silent (§9)
  | 'PERMANENTLY_DECLINED' // definitive decline surfaced as error in non-authorize calls
  | 'INVALID_REQUEST' // malformed caller input the provider itself rejects (not a money/shape bug caught earlier)
  | 'COMPLIANCE_BLOCKED' // account/operation-level compliance hold — not a single transaction's decline reason
  | 'UNKNOWN_OUTCOME'; // ambiguous result (e.g. a timeout mid-call) — verify via retrievePaymentStatus/retrieveCardTransaction, don't assume either way

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly providerDetail: string | undefined;

  constructor(code: ProviderErrorCode, message: string, providerDetail?: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    // UNKNOWN_OUTCOME is retryable for the same reason PROVIDER_UNAVAILABLE is: retrying
    // with the SAME idempotency key is always safe (§12) — the retry either replays an
    // already-committed result or genuinely re-executes, never double-charges.
    this.retryable = code === 'PROVIDER_UNAVAILABLE' || code === 'UNKNOWN_OUTCOME';
    this.providerDetail = providerDetail;
  }
}
