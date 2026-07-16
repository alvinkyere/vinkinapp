/**
 * Provider-neutral error taxonomy. Adapters translate provider errors into these codes;
 * the orchestrator branches on `code` and `retryable`, never on provider-specific strings.
 */

export type ProviderErrorCode =
  | 'IDEMPOTENCY_CONFLICT' // same key, different parameters — a §12 violation upstream
  | 'INVALID_STATE' // e.g. capture after cancel; transition not legal for object state
  | 'AMOUNT_EXCEEDS_AUTHORIZATION' // capture/refund above held/captured amount (§4.7 guard)
  | 'OBJECT_NOT_FOUND'
  | 'INVALID_SIGNATURE' // webhook signature verification failed (§28)
  | 'PROVIDER_UNAVAILABLE' // transient; retry with SAME idempotency key (§12)
  | 'NOT_SUPPORTED' // capability absent on this provider — must be visible, never silent (§9)
  | 'PERMANENTLY_DECLINED'; // definitive decline surfaced as error in non-authorize calls

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly providerDetail: string | undefined;

  constructor(code: ProviderErrorCode, message: string, providerDetail?: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = code === 'PROVIDER_UNAVAILABLE';
    this.providerDetail = providerDetail;
  }
}
