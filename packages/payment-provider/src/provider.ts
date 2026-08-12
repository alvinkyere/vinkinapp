import type {
  AuthorizationResult,
  AuthorizeContributionInput,
  CancelAuthorizationInput,
  CancelResult,
  CaptureContributionInput,
  CaptureResult,
  CardResult,
  CardStatusResult,
  CardholderResult,
  ContributionPaymentIntentResult,
  CreateCardholderInput,
  CreateContributionPaymentIntentInput,
  CreateCustomerInput,
  CreateWalletProvisioningSessionInput,
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
  WalletProvisioningPayload,
  WalletTokenResult,
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
  /** RM4C — see `ContributionPaymentIntentResult`'s own doc comment. The resulting
   * `providerPaymentId` is resolved exactly like any other PROCESSING authorization:
   * `retrievePaymentStatus` / `resolveContributionCommand`, never a distinct code path. */
  createContributionPaymentIntent(
    input: CreateContributionPaymentIntentInput,
  ): Promise<ContributionPaymentIntentResult>;
  captureContribution(input: CaptureContributionInput): Promise<CaptureResult>;
  cancelContributionAuthorization(input: CancelAuthorizationInput): Promise<CancelResult>;
  refundContribution(input: RefundContributionInput): Promise<RefundResult>;

  createCardholder(input: CreateCardholderInput): Promise<CardholderResult>;
  issueTemporaryCard(input: IssueTemporaryCardInput): Promise<CardResult>;
  updateCardControls(input: UpdateCardControlsInput): Promise<void>;
  /** RM2 (D47) — the reusable card pool's disabled-by-default default state needs a real
   * inverse of the disable call, which never existed before this slice. */
  enableCard(cardId: string): Promise<void>;
  /** Renamed from `freezeCard` (RM2, D47) — same real Stripe call
   * (`status: 'inactive'`), same only-real-caller (the conformance suite), renamed for
   * symmetry with `enableCard` and to match D47's own "disabled by default" vocabulary. */
  disableCard(cardId: string): Promise<void>;
  closeCard(cardId: string): Promise<void>;
  /** RM2 (D47) — reconciliation and pool-return code needs to confirm the provider's own
   * truth about a card's status, not just trust VinkIn's local row. */
  getCardStatus(cardId: string): Promise<CardStatusResult>;

  /** RM2 (D47) — see `walletProvisioning` capability's own doc comment; gated the same way
   * every other optional capability is (§21, D7) — `NOT_SUPPORTED` when the provider hasn't
   * proven this against a real sandbox, never a silent emulation. */
  createWalletProvisioningSession(
    input: CreateWalletProvisioningSessionInput,
  ): Promise<WalletProvisioningPayload>;
  revokeWalletToken(providerTokenId: string): Promise<void>;
  getWalletToken(providerTokenId: string): Promise<WalletTokenResult>;
  listWalletTokens(providerCardId: string): Promise<WalletTokenResult[]>;

  retrievePaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus>;
  retrieveCardTransaction(providerTransactionId: string): Promise<ProviderCardTransaction>;

  parseWebhookEvent(input: ParseWebhookInput): ProviderEvent;
}
