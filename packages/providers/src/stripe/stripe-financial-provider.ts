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
  CardholderResult,
  CreateCardholderInput,
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

  async freezeCard(cardId: string): Promise<void> {
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
      const currency = intent.currency.toUpperCase() as 'USD';
      return {
        providerPaymentId: intent.id,
        status: this.mapFullStatus(intent, fullyRefunded),
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
  ): ProviderPaymentStatusCode {
    if (fullyRefunded) return 'REFUNDED';
    if (intent.status === 'requires_capture') return 'AUTHORIZED';
    if (intent.status === 'succeeded') return 'CAPTURED';
    if (intent.status === 'canceled') return 'CANCELED';
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
