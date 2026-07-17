import type {
  AuthorizationResult,
  AuthorizeContributionInput,
  CancelAuthorizationInput,
  CancelResult,
  CaptureContributionInput,
  CaptureResult,
  CardResult,
  CardholderResult,
  CreateCardholderInput,
  CreateCustomerInput,
  CustomerResult,
  IssueTemporaryCardInput,
  ParseWebhookInput,
  ProviderCapabilities,
  ProviderCardTransaction,
  ProviderEvent,
  ProviderPaymentStatus,
  RefundContributionInput,
  RefundResult,
  SetupPaymentMethodInput,
  SetupPaymentMethodResult,
  UpdateCardControlsInput,
} from './types.ts';

/**
 * The provider-neutral financial interface — Spec §43, verbatim method set, plus
 * `parseWebhookEvent` (additive extension recorded in docs/architecture/00 §2.3.4:
 * §28 mandates signature verification, which is inherently provider-specific).
 *
 * Contract rules every adapter must satisfy (the mock encodes them; adapter conformance
 * tests reuse the same suite):
 *  1. Same idempotencyKey + same parameters  → same result, no duplicate side effect (§12).
 *  2. Same idempotencyKey + different params → ProviderError('IDEMPOTENCY_CONFLICT').
 *  3. capture/refund above the held/captured amount → 'AMOUNT_EXCEEDS_AUTHORIZATION' (§4.7).
 *  4. Illegal lifecycle transitions → 'INVALID_STATE' (never silent success).
 *  5. Missing capability → 'NOT_SUPPORTED' (never emulate silently — §9 fallback rule).
 *  6. retrievePaymentStatus/retrieveCardTransaction report provider-side truth with
 *     provider-side timestamps — the reconciliation path of §14/§28 depends on them.
 */
export interface FinancialProvider {
  readonly providerName: string;

  /**
   * Honest declaration of what this provider supports. Application code must gate on these
   * flags — a capability is never assumed because another provider has it. Verified per
   * provider by the shared conformance suite in packages/payment-provider-contract-tests.
   */
  readonly capabilities: ProviderCapabilities;

  createCustomer(input: CreateCustomerInput): Promise<CustomerResult>;
  setupPaymentMethod(input: SetupPaymentMethodInput): Promise<SetupPaymentMethodResult>;

  authorizeContribution(input: AuthorizeContributionInput): Promise<AuthorizationResult>;
  captureContribution(input: CaptureContributionInput): Promise<CaptureResult>;
  cancelContributionAuthorization(input: CancelAuthorizationInput): Promise<CancelResult>;
  refundContribution(input: RefundContributionInput): Promise<RefundResult>;

  createCardholder(input: CreateCardholderInput): Promise<CardholderResult>;
  issueTemporaryCard(input: IssueTemporaryCardInput): Promise<CardResult>;
  updateCardControls(input: UpdateCardControlsInput): Promise<void>;
  freezeCard(cardId: string): Promise<void>;
  closeCard(cardId: string): Promise<void>;

  retrievePaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus>;
  retrieveCardTransaction(providerTransactionId: string): Promise<ProviderCardTransaction>;

  parseWebhookEvent(input: ParseWebhookInput): ProviderEvent;
}
