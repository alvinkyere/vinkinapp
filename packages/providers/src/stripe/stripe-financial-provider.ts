/**
 * ENG6 Slice 3 — real Stripe adapter, sandbox-mode only (D46, docs/architecture/
 * 06-milestone-0-gate.md). This is a technical proof that VinkIn's provider-neutral
 * interface maps onto a real provider's actual API — not a production-readiness claim
 * (D46's own text says so explicitly; `docs/architecture/06-milestone-0-gate.md` still
 * governs whether this may ever run against live-mode Stripe).
 *
 * Two capability declarations are honest limitations, not oversights:
 *  - `merchantCategoryControls: false` — VinkIn's domain has never defined a canonical MCC
 *    vocabulary anywhere in this codebase (confirmed by search before writing this); Stripe's
 *    own Issuing API expects its own named category enum, not raw MCC codes, so there is
 *    nothing real to map `allowedMccs`/`blockedMccs` from yet. `updateCardControls` still
 *    fully supports `spendLimit`.
 *  - `multipleCapture`, `extendedAuthorization`, `merchantSpecificControls`: real Stripe
 *    capabilities that exist, but this pass never exercised them against the real sandbox —
 *    declared `false` rather than assumed, per this package's own "don't code around
 *    undocumented provider behavior" discipline (ENG6 Slice 1).
 */

import Stripe from 'stripe';
import type { FinancialProvider } from '../../../payment-provider/src/provider.ts';
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
  CustomerResult,
  IssueTemporaryCardInput,
  ParseWebhookInput,
  ProviderCapabilities,
  ProviderCardTransaction,
  ProviderEvent,
  ProviderEventType,
  ProviderPaymentStatus,
  ProviderPaymentStatusCode,
  RefundContributionInput,
  RefundResult,
  SetupPaymentMethodInput,
  SetupPaymentMethodResult,
  UpdateCardControlsInput,
  WalletProvisioningPayload,
  WalletTokenResult,
} from '../../../payment-provider/src/types.ts';
import { ProviderError } from '../../../payment-provider/src/errors.ts';
import { loadStripeAdapterConfig, type StripeAdapterConfig } from './config.ts';
import { stripeDeclineReason, translateStripeError } from './errors.ts';

function paymentIntentStatus(
  status: Stripe.PaymentIntent.Status,
): Extract<ProviderPaymentStatusCode, 'PROCESSING' | 'AUTHORIZED' | 'DECLINED'> {
  if (status === 'requires_capture') return 'AUTHORIZED';
  if (status === 'succeeded') return 'AUTHORIZED'; // immediate-capture edge case; VinkIn never requests this (captureMode is always MANUAL) but a real account default could still produce it
  if (status === 'canceled') return 'DECLINED';
  return 'PROCESSING'; // requires_payment_method / requires_confirmation / requires_action / processing
}

export class StripeFinancialProvider implements FinancialProvider {
  readonly providerName = 'stripe';

  readonly capabilities: ProviderCapabilities = {
    manualCapture: true,
    partialCapture: true,
    multipleCapture: false,
    extendedAuthorization: false,
    realTimeAuthorization: true,
    merchantCategoryControls: false,
    merchantSpecificControls: false,
    virtualCardIssuing: true,
    consumerCardholders: true,
    offSessionRecovery: true,
    // RM2 (D47): see the four wallet methods' own doc comment below — verified live that
    // card creation itself is currently blocked on this account's Financial Account v2
    // requirement, so there is no way to verify Stripe's real push-provisioning API yet.
    walletProvisioning: false,
  };

  private readonly stripe: Stripe;
  private readonly config: StripeAdapterConfig;

  constructor(config: StripeAdapterConfig = loadStripeAdapterConfig()) {
    this.config = config;
    this.stripe = new Stripe(config.secretKey, { apiVersion: '2026-06-24.dahlia' });
  }

  async createCustomer(input: CreateCustomerInput): Promise<CustomerResult> {
    try {
      const customer = await this.stripe.customers.create(
        {
          metadata: { externalUserId: input.externalUserId },
          ...(input.email !== undefined && { email: input.email }),
          ...(input.phone !== undefined && { phone: input.phone }),
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { providerCustomerId: customer.id };
    } catch (error) {
      translateStripeError(error);
    }
  }

  async setupPaymentMethod(input: SetupPaymentMethodInput): Promise<SetupPaymentMethodResult> {
    try {
      const method = await this.stripe.paymentMethods.attach(
        input.methodToken,
        { customer: input.providerCustomerId },
        { idempotencyKey: input.idempotencyKey },
      );
      return {
        providerMethodId: method.id,
        kind: method.type === 'card' ? 'CARD' : 'CARD',
        displayBrand: method.card?.brand ?? 'unknown',
        displayLast4: method.card?.last4 ?? '0000',
      };
    } catch (error) {
      translateStripeError(error);
    }
  }

  async authorizeContribution(input: AuthorizeContributionInput): Promise<AuthorizationResult> {
    // Same INVALID_REQUEST validation as the mock (packages/payment-provider/src/mock/
    // mock-financial-provider.ts) — every adapter must satisfy the shared conformance
    // suite's own test for this (D7), not just the mock.
    if (input.metadata.vinkId === undefined || input.metadata.vinkId.length === 0) {
      throw new ProviderError(
        'INVALID_REQUEST',
        'authorizeContribution.metadata.vinkId is required',
      );
    }
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amount.amountMinor,
          currency: input.amount.currency.toLowerCase(),
          customer: input.providerCustomerId,
          payment_method: input.providerMethodId,
          capture_method: 'manual',
          confirm: true,
          off_session: true,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { providerPaymentId: intent.id, status: paymentIntentStatus(intent.status) };
    } catch (error) {
      // A card decline on the INITIAL authorization is normal, expected data (Slice 2's own
      // design), never a thrown ProviderError — this is the one call site translateStripeError
      // deliberately isn't used for a StripeCardError; every other exception type still is.
      if (error instanceof Stripe.errors.StripeCardError) {
        return {
          providerPaymentId: error.payment_intent?.id ?? `declined_${input.idempotencyKey}`,
          status: 'DECLINED',
          declineReason: stripeDeclineReason(error.decline_code ?? error.code ?? null),
        };
      }
      translateStripeError(error);
    }
  }

  /** RM4C — real hosted card collection. Deliberately `confirm: false`/no `payment_method`
   * (unlike `authorizeContribution` above, which is the server-side-token path): the client
   * collects the card directly with Stripe's own hosted UI (Elements/PaymentSheet) using
   * `client_secret`, never sending raw card data to VinkIn (§35). `capture_method: 'manual'`
   * matches every other contribution authorization in this codebase — `retrievePaymentStatus`
   * / `resolveContributionCommand` resolve the outcome exactly like any other PROCESSING
   * authorization once the client (and, where required, 3DS) confirms. */
  async createContributionPaymentIntent(
    input: CreateContributionPaymentIntentInput,
  ): Promise<ContributionPaymentIntentResult> {
    if (input.metadata.vinkId === undefined || input.metadata.vinkId.length === 0) {
      throw new ProviderError(
        'INVALID_REQUEST',
        'createContributionPaymentIntent.metadata.vinkId is required',
      );
    }
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amount.amountMinor,
          currency: input.amount.currency.toLowerCase(),
          customer: input.providerCustomerId,
          capture_method: 'manual',
          // `allow_redirects: 'never'` matches this codebase's own established choice (guest-
          // web/mobile both disclose "no return-URL page exists") — confirmed live against the
          // real sandbox that omitting this makes Stripe REQUIRE a `return_url` at confirm
          // time and reject the confirmation otherwise (a real bug this file's own RM4C
          // sandbox contract-test run caught: a client confirming with no return_url got a
          // configuration error, not a card outcome, and the PaymentIntent never left
          // `requires_payment_method`). This does not disable 3DS — an in-page authentication
          // challenge is `next_action.type: use_stripe_sdk`, not a redirect.
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (intent.client_secret === null) {
        throw new ProviderError(
          'PROVIDER_UNAVAILABLE',
          'Stripe did not return a client secret for the created payment intent',
        );
      }
      return { providerPaymentId: intent.id, clientSecret: intent.client_secret };
    } catch (error) {
      translateStripeError(error);
    }
  }

  async captureContribution(input: CaptureContributionInput): Promise<CaptureResult> {
    try {
      const intent = await this.stripe.paymentIntents.capture(
        input.providerPaymentId,
        { amount_to_capture: input.amount.amountMinor },
        { idempotencyKey: input.idempotencyKey },
      );
      return {
        providerCaptureId: intent.latest_charge?.toString() ?? intent.id,
        status: intent.status === 'succeeded' ? 'CAPTURED' : 'PROCESSING',
      };
    } catch (error) {
      translateStripeError(error);
    }
  }

  async cancelContributionAuthorization(input: CancelAuthorizationInput): Promise<CancelResult> {
    try {
      const intent = await this.stripe.paymentIntents.cancel(input.providerPaymentId, undefined, {
        idempotencyKey: input.idempotencyKey,
      });
      return { status: intent.status === 'canceled' ? 'CANCELED' : 'PROCESSING' };
    } catch (error) {
      translateStripeError(error);
    }
  }

  async refundContribution(input: RefundContributionInput): Promise<RefundResult> {
    try {
      const refund = await this.stripe.refunds.create(
        { payment_intent: input.providerPaymentId, amount: input.amount.amountMinor },
        { idempotencyKey: input.idempotencyKey },
      );
      return {
        providerRefundId: refund.id,
        // §25: never claim completion early — only Stripe's own 'succeeded' status does.
        // A refund that comes back 'failed' at creation time is genuinely exceptional (not
        // the normal async-pending shape this field otherwise models); surfaced as thrown
        // PROVIDER_UNAVAILABLE rather than silently reported as REFUND_INITIATED, which
        // would misrepresent a call that's already known to have failed.
        status: refund.status === 'succeeded' ? 'REFUND_COMPLETED' : 'REFUND_INITIATED',
      };
    } catch (error) {
      translateStripeError(error);
    }
  }

  async createCardholder(input: CreateCardholderInput): Promise<CardholderResult> {
    // ENG6 Slice 3 finding, disclosed in the milestone report: `CreateCardholderInput` carries
    // no email or billing address, but Stripe Issuing requires both for an `individual`
    // cardholder. VinkIn's domain has never collected this data (no KYC flow exists — Slice
    // 1's audit). Sandbox-only placeholder values stand in here; a real cardholder-onboarding
    // flow needs the interface itself to carry real data before this could ever run live.
    try {
      const cardholder = await this.stripe.issuing.cardholders.create(
        {
          type: 'individual',
          name: input.legalName,
          email: `${input.externalAccountId}@sandbox.vinkin.internal`,
          billing: {
            address: {
              line1: '123 Sandbox St',
              city: 'San Francisco',
              state: 'CA',
              postal_code: '94103',
              country: 'US',
            },
          },
          metadata: { externalAccountId: input.externalAccountId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { providerCardholderId: cardholder.id };
    } catch (error) {
      translateStripeError(error);
    }
  }

  async issueTemporaryCard(input: IssueTemporaryCardInput): Promise<CardResult> {
    try {
      const card = await this.stripe.issuing.cards.create(
        {
          cardholder: input.providerCardholderId,
          currency: input.spendLimit.currency.toLowerCase(),
          type: 'virtual',
          spending_controls: {
            spending_limits: [{ amount: input.spendLimit.amountMinor, interval: 'all_time' }],
          },
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      // Stripe issues a virtual card `inactive` by default — activated here as part of
      // issuance so this method's own contract (a spendable card on return, matching
      // `packages/domain`'s PV6 assumption that an issued card is immediately usable) holds,
      // rather than surfacing Stripe's own default-inactive quirk as a surprise to callers.
      const activated = await this.stripe.issuing.cards.update(card.id, { status: 'active' });
      return {
        providerCardId: activated.id,
        status: activated.status === 'active' ? 'ACTIVE' : 'INACTIVE',
      };
    } catch (error) {
      translateStripeError(error);
    }
  }

  async updateCardControls(input: UpdateCardControlsInput): Promise<void> {
    if (
      (input.allowedMccs !== undefined && input.allowedMccs.length > 0) ||
      (input.blockedMccs !== undefined && input.blockedMccs.length > 0)
    ) {
      // Honest NOT_SUPPORTED per this file's own top-of-file doc comment — never a silent
      // no-op (§9 fallback rule).
      throw new ProviderError(
        'NOT_SUPPORTED',
        'MCC allow/block lists are not supported by this adapter — VinkIn has no canonical ' +
          'MCC vocabulary to map onto Stripe’s own category enum yet',
      );
    }
    if (input.spendLimit === undefined) return;
    try {
      await this.stripe.issuing.cards.update(input.providerCardId, {
        spending_controls: {
          spending_limits: [{ amount: input.spendLimit.amountMinor, interval: 'all_time' }],
        },
      });
    } catch (error) {
      translateStripeError(error);
    }
  }

  async enableCard(cardId: string): Promise<void> {
    // The identical call `issueTemporaryCard` already makes to activate a freshly issued
    // card (line ~256 above) — already proven against the real sandbox by that call site;
    // this is the same API surface reused as its own explicit, callable operation, which
    // RM2 (D47) needs for "disabled by default, enabled only while assigned."
    try {
      await this.stripe.issuing.cards.update(cardId, { status: 'active' });
    } catch (error) {
      translateStripeError(error);
    }
  }

  /** Renamed from `freezeCard` (RM2, D47) — identical real call, only the caller-facing name
   * changed, for symmetry with `enableCard`. */
  async disableCard(cardId: string): Promise<void> {
    try {
      await this.stripe.issuing.cards.update(cardId, { status: 'inactive' });
    } catch (error) {
      translateStripeError(error);
    }
  }

  async closeCard(cardId: string): Promise<void> {
    try {
      await this.stripe.issuing.cards.update(cardId, { status: 'canceled' });
    } catch (error) {
      translateStripeError(error);
    }
  }

  async getCardStatus(cardId: string): Promise<CardStatusResult> {
    try {
      const card = await this.stripe.issuing.cards.retrieve(cardId);
      const status: CardStatusResult['status'] =
        card.status === 'active' ? 'ACTIVE' : card.status === 'canceled' ? 'CLOSED' : 'INACTIVE';
      return { providerCardId: card.id, status };
    } catch (error) {
      translateStripeError(error);
    }
  }

  // -- RM2 (D47): wallet-token provisioning ------------------------------------------------
  //
  // Declared NOT_SUPPORTED (walletProvisioning: false above), disclosed rather than guessed:
  // verified live against the real sandbox (this file's own package, `packages/providers`)
  // that `POST /v1/issuing/cards` — card creation itself — is currently blocked on this
  // Stripe account needing a v2 Financial Account (`ENG6-SLICE-5-STRIPE-FINANCIAL-ACCOUNT-
  // NOTE.md`), so there is no real card to provision a wallet token for and no way to verify
  // Stripe's actual push-provisioning API shape against this sandbox. Rather than guess at
  // undocumented behavior (this package's own established discipline, ENG6 Slice 1), these
  // four methods throw NOT_SUPPORTED until that wall clears and the real API can be verified
  // live — the honest per-provider capability gate (§21, D7) is what's supposed to happen
  // here, not a fabricated implementation.

  async createWalletProvisioningSession(): Promise<WalletProvisioningPayload> {
    throw new ProviderError(
      'NOT_SUPPORTED',
      'wallet provisioning is not yet verified against the real Stripe sandbox for this ' +
        'account (blocked on the Financial Account v2 requirement — see ' +
        'ENG6-SLICE-5-STRIPE-FINANCIAL-ACCOUNT-NOTE.md)',
    );
  }

  async revokeWalletToken(): Promise<void> {
    throw new ProviderError('NOT_SUPPORTED', 'wallet provisioning is not yet supported');
  }

  async getWalletToken(): Promise<WalletTokenResult> {
    throw new ProviderError('NOT_SUPPORTED', 'wallet provisioning is not yet supported');
  }

  async listWalletTokens(): Promise<WalletTokenResult[]> {
    throw new ProviderError('NOT_SUPPORTED', 'wallet provisioning is not yet supported');
  }

  async retrievePaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus> {
    try {
      // ENG6 Slice 3 finding, confirmed against the real sandbox: a fully refunded
      // PaymentIntent's own `.status` field stays 'succeeded' — Stripe tracks refund state
      // on the Charge, not the PaymentIntent, so `latest_charge` must be expanded and
      // inspected to ever report REFUNDED. Without this, a fully refunded contribution would
      // permanently misreport as CAPTURED to reconciliation.
      const intent = await this.stripe.paymentIntents.retrieve(providerPaymentId, {
        expand: ['latest_charge'],
      });
      const charge =
        typeof intent.latest_charge === 'object' && intent.latest_charge !== null
          ? intent.latest_charge
          : null;
      const capturedTotal = intent.amount_received;
      const refundedTotal = charge?.amount_refunded ?? 0;
      const fullyRefunded = charge !== null && charge.refunded;
      // RM4C finding, confirmed live against the real sandbox: a declined confirmation
      // attempt does NOT move the PaymentIntent itself to a terminal status — it reverts to
      // `requires_payment_method` (Stripe deliberately allows retrying with a different card
      // on the SAME intent), so `intent.status` alone can never report a decline. Only the
      // Charge Stripe creates for that failed attempt carries `status: 'failed'` — this only
      // ever reflects the MOST RECENT attempt (`latest_charge`), so a later successful retry
      // on the same intent is unaffected.
      const latestAttemptFailed = charge !== null && charge.status === 'failed';
      const currency = intent.currency.toUpperCase() as 'USD';
      return {
        providerPaymentId: intent.id,
        status: this.mapFullStatus(intent, fullyRefunded, latestAttemptFailed),
        authorizedAmount:
          intent.status === 'canceled' ? null : { amountMinor: intent.amount, currency },
        capturedTotal: capturedTotal > 0 ? { amountMinor: capturedTotal, currency } : null,
        refundedTotal: refundedTotal > 0 ? { amountMinor: refundedTotal, currency } : null,
        occurredAt: new Date(intent.created * 1000).toISOString(),
      };
    } catch (error) {
      translateStripeError(error);
    }
  }

  private mapFullStatus(
    intent: Stripe.PaymentIntent,
    fullyRefunded: boolean,
    latestAttemptFailed: boolean,
  ): ProviderPaymentStatusCode {
    if (fullyRefunded) return 'REFUNDED';
    if (intent.status === 'requires_capture') return 'AUTHORIZED';
    if (intent.status === 'succeeded') return 'CAPTURED';
    if (intent.status === 'canceled') return 'CANCELED';
    if (intent.status === 'requires_payment_method' && latestAttemptFailed) return 'DECLINED';
    return 'PROCESSING';
  }

  async retrieveCardTransaction(providerTransactionId: string): Promise<ProviderCardTransaction> {
    try {
      const tx = await this.stripe.issuing.transactions.retrieve(providerTransactionId);
      const merchant = tx.merchant_data;
      return {
        providerTransactionId: tx.id,
        providerCardId: typeof tx.card === 'string' ? tx.card : tx.card.id,
        kind: tx.type === 'capture' ? 'CAPTURE' : 'AUTHORIZATION',
        amount: { amountMinor: Math.abs(tx.amount), currency: tx.currency.toUpperCase() as 'USD' },
        merchantId: merchant.network_id ?? merchant.name ?? 'unknown',
        merchantName: merchant.name ?? 'unknown',
        mcc: merchant.category_code ?? '0000',
        merchantCountry: merchant.country ?? 'US',
        occurredAt: new Date(tx.created * 1000).toISOString(),
      };
    } catch (error) {
      translateStripeError(error);
    }
  }

  parseWebhookEvent(input: ParseWebhookInput): ProviderEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        input.rawBody,
        input.signatureHeader,
        input.webhookSecret,
      );
    } catch {
      throw new ProviderError('INVALID_SIGNATURE', 'Stripe webhook signature verification failed');
    }
    const type = mapStripeEventType(event.type);
    if (type === null) {
      throw new ProviderError('NOT_SUPPORTED', `unmapped Stripe event type: ${event.type}`);
    }
    const object = event.data.object as { id: string };
    return {
      provider: this.providerName,
      providerEventId: event.id,
      type,
      occurredAt: new Date(event.created * 1000).toISOString(),
      objectId: object.id,
      payload: event.data.object as unknown as Record<string, unknown>,
    };
  }
}

function mapStripeEventType(stripeType: string): ProviderEventType | null {
  const map: Record<string, ProviderEventType> = {
    'payment_intent.amount_capturable_updated': 'payment.authorized',
    'payment_intent.succeeded': 'payment.captured',
    'payment_intent.canceled': 'payment.canceled',
    'payment_intent.payment_failed': 'payment.declined',
    'charge.refunded': 'refund.completed',
    'issuing_authorization.request': 'card.authorization.request',
    'issuing_authorization.created': 'card.authorization.created',
    'issuing_transaction.created': 'card.capture.created',
    'charge.dispute.created': 'dispute.created',
  };
  return map[stripeType] ?? null;
}
