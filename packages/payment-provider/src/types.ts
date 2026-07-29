/**
 * Provider-neutral types for the FinancialProvider interface (Spec §43).
 *
 * Rules encoded here:
 *  - Money is integer minor units only (§26). Floats are rejected at runtime.
 *  - Statuses are provider-neutral; adapters map provider vocabulary into these.
 *  - Nothing in this package may import a provider SDK (§42/§43); provider-specific
 *    logic lives in adapter subdirectories only.
 */

export type CurrencyCode = 'USD'; // §36: USD-only in V1

export interface Money {
  amountMinor: number; // integer minor units; validated by assertMoney()
  currency: CurrencyCode;
}

export function assertMoney(money: Money, label: string): void {
  if (!Number.isSafeInteger(money.amountMinor) || money.amountMinor <= 0) {
    throw new RangeError(
      `${label}: amountMinor must be a positive safe integer, got ${money.amountMinor}`,
    );
  }
}

/**
 * What a provider can actually do. Adapters declare this honestly; the application must
 * branch on these flags and may NEVER assume a capability merely because one provider
 * supports it (§21 "do not assume those features are universally available").
 * A false capability means the corresponding operation throws
 * ProviderError('NOT_SUPPORTED') or the behavioral limit surfaces as INVALID_STATE —
 * never a silent emulation (§9).
 */
export interface ProviderCapabilities {
  manualCapture: boolean;
  partialCapture: boolean;
  multipleCapture: boolean;
  extendedAuthorization: boolean;
  realTimeAuthorization: boolean;
  merchantCategoryControls: boolean;
  merchantSpecificControls: boolean;
  virtualCardIssuing: boolean;
  consumerCardholders: boolean;
  offSessionRecovery: boolean;
  /** RM2 (D47) — real Apple/Google Wallet push-provisioning. Declared `false` honestly by
   * the Stripe adapter in this slice: verified live against the real sandbox that card
   * creation itself is currently blocked on Stripe's own Financial Account v2 requirement
   * (the wall ENG6 Slice 5's own decision note documents), so there is no real card to
   * provision a wallet token for and no way to verify this against the real sandbox yet —
   * `true` only for the mock. Never assumed true because another provider has it (§21, D7). */
  walletProvisioning: boolean;
}

/** Provider-neutral payment (contribution) statuses — §11 attempt vocabulary, provider side. */
export type ProviderPaymentStatusCode =
  | 'PROCESSING' // async confirmation pending (3DS / wallet handoff / provider delay)
  | 'AUTHORIZED' // funds held, capturable
  | 'CAPTURED' // funds captured (possibly partially; see capturedTotal)
  | 'CANCELED' // authorization released without capture
  | 'EXPIRED' // authorization hold lapsed before capture/cancel (§21 warns holds don't last)
  | 'DECLINED' // definitive decline — a new attempt generation is required (§12)
  | 'REFUNDED'; // fully refunded after capture

export interface ProviderPaymentStatus {
  providerPaymentId: string;
  status: ProviderPaymentStatusCode;
  authorizedAmount: Money | null;
  capturedTotal: Money | null;
  refundedTotal: Money | null;
  /** Provider-side event time for the latest transition — decisions use this, never arrival time (§14/§28). */
  occurredAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Inputs / results (§43 signatures)
// ---------------------------------------------------------------------------

export interface CreateCustomerInput {
  idempotencyKey: string; // §12 server-derived operation id
  externalUserId: string;
  email?: string;
  phone?: string;
}
export interface CustomerResult {
  providerCustomerId: string;
}

export interface SetupPaymentMethodInput {
  idempotencyKey: string;
  providerCustomerId: string;
  /** Opaque provider token from a hosted component. NEVER raw PAN/CVV (§35). */
  methodToken: string;
  usage: 'CONTRIBUTION' | 'RECOVERY';
}
export interface SetupPaymentMethodResult {
  providerMethodId: string;
  kind: 'CARD' | 'APPLE_PAY' | 'GOOGLE_PAY';
  displayBrand: string;
  displayLast4: string;
}

export interface AuthorizeContributionInput {
  idempotencyKey: string; // authorize:v1:{slotId}:{attemptGeneration} (§12)
  providerCustomerId: string;
  providerMethodId: string;
  amount: Money; // participant's approved maximum for variable policies (§21)
  captureMode: 'MANUAL'; // §11: prefer authorize-then-capture; immediate capture is not modeled in V1
  metadata: Record<string, string>; // vinkId, contributionSlotId, correlationId
}

/**
 * ENG6 Slice 2 — a normal, expected per-transaction decline outcome (never a thrown
 * `ProviderError`; see that file's own doc comment for why the two are kept separate).
 * `GENERIC` covers a decline whose specific reason the provider didn't disclose or that
 * doesn't fit the named categories — never invented as a more specific reason than the
 * provider actually gave.
 */
export type ContributionDeclineReason =
  'CARD_DECLINED' | 'INSUFFICIENT_FUNDS' | 'COMPLIANCE_BLOCKED' | 'EXPIRED_METHOD' | 'GENERIC';

export interface AuthorizationResult {
  providerPaymentId: string;
  status: Extract<ProviderPaymentStatusCode, 'PROCESSING' | 'AUTHORIZED' | 'DECLINED'>;
  declineReason?: ContributionDeclineReason;
}

export interface CaptureContributionInput {
  idempotencyKey: string; // capture:v1:{slotId}:{captureGeneration} (§12)
  providerPaymentId: string;
  amount: Money; // base share ≤ authorized maximum (§21 base-capture strategy)
}
export interface CaptureResult {
  providerCaptureId: string;
  status: Extract<ProviderPaymentStatusCode, 'CAPTURED' | 'PROCESSING'>;
}

export interface CancelAuthorizationInput {
  idempotencyKey: string;
  providerPaymentId: string;
  reason: 'VINK_EXPIRED' | 'VINK_CANCELED' | 'MEMBER_REMOVED' | 'SUPERSEDED';
}
export interface CancelResult {
  status: Extract<ProviderPaymentStatusCode, 'CANCELED' | 'PROCESSING'>;
}

export interface RefundContributionInput {
  idempotencyKey: string; // refund:v1:{refundId} (§12)
  providerPaymentId: string;
  amount: Money;
  reason: 'VINK_FAILED' | 'DISPERSAL' | 'SUPPORT_ADJUSTMENT';
}
export interface RefundResult {
  providerRefundId: string;
  status: 'REFUND_INITIATED' | 'REFUND_COMPLETED'; // §25: never claim completion early
}

// --- Issuing side ----------------------------------------------------------

export interface CreateCardholderInput {
  idempotencyKey: string;
  externalAccountId: string; // VinkIn financial_account id of the ORGANIZER
  legalName: string;
  dateOfBirth?: string;
  verifiedIdentityRef?: string; // KYC artifact reference (§10.1)
}
export interface CardholderResult {
  providerCardholderId: string;
}

export interface IssueTemporaryCardInput {
  idempotencyKey: string; // issue-card:v1:{vinkId} (§12)
  providerCardholderId: string;
  spendLimit: Money; // funded total + slippage/tip headroom (§20/§21)
  metadata: Record<string, string>; // vinkId
}
export interface CardResult {
  providerCardId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateCardControlsInput {
  providerCardId: string;
  spendLimit?: Money;
  allowedMccs?: readonly string[]; // policy-family MCC set (§19)
  blockedMccs?: readonly string[]; // cash-like blocks always on (§3.2, §36)
}

// ---------------------------------------------------------------------------
// RM2 (D47) — the reusable card pool's enable/disable + wallet-token lifecycle.
// `freezeCard` is renamed `disableCard` (its only real caller was the conformance suite's
// own test — confirmed by grep before renaming, zero production call sites); `enableCard` is
// its previously-missing inverse. Real Stripe issuing cards only have three states
// (active/inactive/canceled) — this vocabulary matches that exactly, not a mock invention.
// ---------------------------------------------------------------------------

export type CardStatusCode = 'ACTIVE' | 'INACTIVE' | 'CLOSED';

export interface CardStatusResult {
  providerCardId: string;
  status: CardStatusCode;
}

/** D47 (owner-clarified): authorizations are approved against the assigned wallet token, not
 * solely the underlying card — this is a real security requirement (a stale device from a
 * prior assignment must never authorize against a card now assigned elsewhere), not
 * incidental. `walletType` matters because Apple/Google push-provisioning payload shapes are
 * genuinely different; both are modeled explicitly rather than picking one and assuming. */
export type WalletType = 'APPLE_PAY' | 'GOOGLE_PAY';

export interface CreateWalletProvisioningSessionInput {
  idempotencyKey: string; // wallet-provision:v1:{cardAssignmentId} (§12 shape)
  providerCardId: string;
  walletType: WalletType;
}

/**
 * Deliberately named "session," not "token": VinkIn's own backend does not mint an Apple Pay
 * / Google Pay token directly — the wallet framework on the organizer's device completes
 * provisioning using material this call returns. `provisioningData` is intentionally opaque
 * at this layer (never destructured/interpreted outside an adapter or RM5's real wallet
 * integration code) — Apple's and Google's real push-provisioning payload shapes are
 * genuinely different and provider/platform-specific; baking named fields (e.g. Apple's own
 * `encryptedPassData`/`activationData`/`ephemeralPublicKey`) into this shared, provider-
 * neutral type would leak platform-specific shape into the domain layer the same way a raw
 * Stripe type would (§42/§43).
 */
export interface WalletProvisioningPayload {
  providerReference: string; // the provider's own token/session id — this IS the wallet token id
  walletType: WalletType;
  provisioningData: Record<string, unknown>;
}

export type WalletTokenStatusCode = 'ACTIVE' | 'REVOKED';

export interface WalletTokenResult {
  providerTokenId: string;
  status: WalletTokenStatusCode;
}

export interface ProviderCardTransaction {
  providerTransactionId: string;
  providerCardId: string;
  kind: 'AUTHORIZATION' | 'CAPTURE' | 'REVERSAL' | 'REFUND';
  amount: Money;
  merchantId: string;
  merchantName: string;
  mcc: string;
  merchantCountry: string;
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// Webhook envelope (interface extension — §28 requires signature verification;
// flagged in docs/architecture/00 §2.3.4 as an additive change to §43)
// ---------------------------------------------------------------------------

export type ProviderEventType =
  | 'payment.authorized'
  | 'payment.captured'
  | 'payment.canceled'
  | 'payment.authorization.expired'
  | 'payment.declined'
  | 'refund.completed'
  | 'card.authorization.request' // real-time approve/decline hook (§17)
  | 'card.authorization.created'
  | 'card.capture.created'
  | 'dispute.created';

export interface ProviderEvent {
  provider: string;
  providerEventId: string; // UNIQUE(provider, provider_event_id) inbox key (§12/§28)
  type: ProviderEventType;
  occurredAt: string; // provider-side truth (§28)
  objectId: string; // providerPaymentId / providerCardId / …
  payload: Record<string, unknown>;
}

export interface ParseWebhookInput {
  rawBody: string;
  signatureHeader: string;
  webhookSecret: string;
}
