import { createHmac } from 'node:crypto';
import { ProviderError } from '../errors.ts';
import type { FinancialProvider } from '../provider.ts';
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
  Money,
  ParseWebhookInput,
  ProviderCardTransaction,
  ProviderEvent,
  ProviderEventType,
  ProviderPaymentStatus,
  RefundContributionInput,
  RefundResult,
  SetupPaymentMethodInput,
  SetupPaymentMethodResult,
  UpdateCardControlsInput,
} from '../types.ts';
import { assertMoney } from '../types.ts';

/**
 * In-memory FinancialProvider used for the M0 feasibility spike and, from M1 on, as the
 * test double for §38 integration/concurrency/chaos suites. It deliberately implements the
 * awkward provider behaviors the Spec warns about, so host code can be tested against them:
 *
 *  - idempotency replay & conflict (§12)
 *  - async authorizations that resolve later (grace-period modeling, §14) via `tok_pending`
 *  - definitive declines via `tok_decline`
 *  - duplicate webhook delivery via `duplicateLastEvent()` (§28)
 *  - provider-side occurredAt timestamps distinct from delivery time (§28)
 *
 * Mock-only helpers (not on the §43 interface): resolvePendingAuthorization,
 * simulateMerchantAuthorization, simulateMerchantCapture, drainEvents, duplicateLastEvent.
 */

interface PaymentRecord {
  id: string;
  customerId: string;
  methodId: string;
  status: ProviderPaymentStatus['status'];
  authorizedAmount: Money | null;
  capturedTotal: number;
  refundedTotal: number;
  currency: 'USD';
  occurredAt: string;
  metadata: Record<string, string>;
}

interface CardRecord {
  id: string;
  cardholderId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'FROZEN' | 'CLOSED';
  spendLimitMinor: number;
  authorizedTotalMinor: number;
  capturedTotalMinor: number;
  allowedMccs: readonly string[] | null;
  blockedMccs: readonly string[];
}

interface IdempotencyRecord {
  paramsHash: string;
  result: unknown;
}

export interface MerchantAuthorizationRequest {
  providerCardId: string;
  amount: Money;
  merchantId: string;
  merchantName: string;
  mcc: string;
  merchantCountry: string;
}

export interface MerchantAuthorizationOutcome {
  approved: boolean;
  declineReason?: 'CARD_NOT_ACTIVE' | 'OVER_LIMIT' | 'MCC_BLOCKED';
  providerAuthorizationId?: string;
}

export class MockFinancialProvider implements FinancialProvider {
  readonly providerName = 'mock';

  private readonly now: () => Date;
  private counter = 0;

  private readonly customers = new Map<string, CreateCustomerInput>();
  private readonly methods = new Map<string, { customerId: string; token: string }>();
  private readonly payments = new Map<string, PaymentRecord>();
  private readonly cardholders = new Map<string, CreateCardholderInput>();
  private readonly cards = new Map<string, CardRecord>();
  private readonly cardTransactions = new Map<string, ProviderCardTransaction>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly events: ProviderEvent[] = [];

  constructor(options?: { now?: () => Date }) {
    this.now = options?.now ?? (() => new Date());
  }

  // -- infrastructure --------------------------------------------------------

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${String(this.counter).padStart(6, '0')}`;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  /** §12 semantics: replay returns the stored result; same key + different params conflicts. */
  private idempotent<T>(key: string, params: unknown, execute: () => T): T {
    const paramsHash = JSON.stringify(params);
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.paramsHash !== paramsHash) {
        throw new ProviderError(
          'IDEMPOTENCY_CONFLICT',
          `idempotency key ${key} reused with different parameters`,
        );
      }
      return existing.result as T;
    }
    const result = execute();
    this.idempotency.set(key, { paramsHash, result });
    return result;
  }

  private emit(type: ProviderEventType, objectId: string, payload: Record<string, unknown>): void {
    this.events.push({
      provider: this.providerName,
      providerEventId: this.nextId('evt'),
      type,
      occurredAt: this.timestamp(),
      objectId,
      payload,
    });
  }

  private getPayment(providerPaymentId: string): PaymentRecord {
    const payment = this.payments.get(providerPaymentId);
    if (!payment) {
      throw new ProviderError('OBJECT_NOT_FOUND', `no payment ${providerPaymentId}`);
    }
    return payment;
  }

  // -- customers & methods ----------------------------------------------------

  async createCustomer(input: CreateCustomerInput): Promise<CustomerResult> {
    return this.idempotent(input.idempotencyKey, input, () => {
      const providerCustomerId = this.nextId('cus');
      this.customers.set(providerCustomerId, input);
      return { providerCustomerId };
    });
  }

  async setupPaymentMethod(input: SetupPaymentMethodInput): Promise<SetupPaymentMethodResult> {
    return this.idempotent(input.idempotencyKey, input, () => {
      if (!this.customers.has(input.providerCustomerId)) {
        throw new ProviderError('OBJECT_NOT_FOUND', `no customer ${input.providerCustomerId}`);
      }
      const providerMethodId = this.nextId('pm');
      this.methods.set(providerMethodId, {
        customerId: input.providerCustomerId,
        token: input.methodToken,
      });
      return {
        providerMethodId,
        kind: 'CARD',
        displayBrand: 'MOCK',
        displayLast4: '4242',
      };
    });
  }

  // -- contribution lifecycle (§11) --------------------------------------------

  async authorizeContribution(input: AuthorizeContributionInput): Promise<AuthorizationResult> {
    assertMoney(input.amount, 'authorizeContribution.amount');
    return this.idempotent(input.idempotencyKey, input, () => {
      const method = this.methods.get(input.providerMethodId);
      if (!method || method.customerId !== input.providerCustomerId) {
        throw new ProviderError('OBJECT_NOT_FOUND', `no method ${input.providerMethodId}`);
      }

      const providerPaymentId = this.nextId('pay');
      const record: PaymentRecord = {
        id: providerPaymentId,
        customerId: input.providerCustomerId,
        methodId: input.providerMethodId,
        status: 'AUTHORIZED',
        authorizedAmount: input.amount,
        capturedTotal: 0,
        refundedTotal: 0,
        currency: input.amount.currency,
        occurredAt: this.timestamp(),
        metadata: input.metadata,
      };

      if (method.token === 'tok_decline') {
        record.status = 'DECLINED';
        record.authorizedAmount = null;
        this.payments.set(providerPaymentId, record);
        this.emit('payment.declined', providerPaymentId, { reason: 'card_declined' });
        return { providerPaymentId, status: 'DECLINED', declineReason: 'card_declined' };
      }

      if (method.token === 'tok_pending') {
        record.status = 'PROCESSING';
        this.payments.set(providerPaymentId, record);
        return { providerPaymentId, status: 'PROCESSING' };
      }

      this.payments.set(providerPaymentId, record);
      this.emit('payment.authorized', providerPaymentId, { amountMinor: input.amount.amountMinor });
      return { providerPaymentId, status: 'AUTHORIZED' };
    });
  }

  /** Mock-only: resolve a `tok_pending` authorization later (models 3DS/webhook delay, §14). */
  resolvePendingAuthorization(providerPaymentId: string, outcome: 'AUTHORIZED' | 'DECLINED'): void {
    const payment = this.getPayment(providerPaymentId);
    if (payment.status !== 'PROCESSING') {
      throw new ProviderError('INVALID_STATE', `payment ${providerPaymentId} is ${payment.status}`);
    }
    payment.status = outcome;
    payment.occurredAt = this.timestamp();
    if (outcome === 'DECLINED') {
      payment.authorizedAmount = null;
      this.emit('payment.declined', providerPaymentId, { reason: 'card_declined' });
    } else {
      this.emit('payment.authorized', providerPaymentId, {
        amountMinor: payment.authorizedAmount?.amountMinor,
      });
    }
  }

  async captureContribution(input: CaptureContributionInput): Promise<CaptureResult> {
    assertMoney(input.amount, 'captureContribution.amount');
    return this.idempotent(input.idempotencyKey, input, () => {
      const payment = this.getPayment(input.providerPaymentId);
      if (payment.status !== 'AUTHORIZED') {
        throw new ProviderError(
          'INVALID_STATE',
          `capture requires AUTHORIZED, payment ${payment.id} is ${payment.status}`,
        );
      }
      const authorized = payment.authorizedAmount;
      if (!authorized || input.amount.amountMinor > authorized.amountMinor) {
        throw new ProviderError(
          'AMOUNT_EXCEEDS_AUTHORIZATION',
          `capture ${input.amount.amountMinor} > authorized ${authorized?.amountMinor ?? 0}`,
        );
      }
      payment.status = 'CAPTURED';
      payment.capturedTotal = input.amount.amountMinor;
      payment.occurredAt = this.timestamp();
      const providerCaptureId = this.nextId('cap');
      this.emit('payment.captured', payment.id, {
        providerCaptureId,
        amountMinor: input.amount.amountMinor,
      });
      return { providerCaptureId, status: 'CAPTURED' };
    });
  }

  async cancelContributionAuthorization(input: CancelAuthorizationInput): Promise<CancelResult> {
    return this.idempotent(input.idempotencyKey, input, () => {
      const payment = this.getPayment(input.providerPaymentId);
      if (payment.status !== 'AUTHORIZED' && payment.status !== 'PROCESSING') {
        throw new ProviderError(
          'INVALID_STATE',
          `cancel requires AUTHORIZED/PROCESSING, payment ${payment.id} is ${payment.status}`,
        );
      }
      payment.status = 'CANCELED';
      payment.occurredAt = this.timestamp();
      this.emit('payment.canceled', payment.id, { reason: input.reason });
      return { status: 'CANCELED' };
    });
  }

  async refundContribution(input: RefundContributionInput): Promise<RefundResult> {
    assertMoney(input.amount, 'refundContribution.amount');
    return this.idempotent(input.idempotencyKey, input, () => {
      const payment = this.getPayment(input.providerPaymentId);
      if (payment.status !== 'CAPTURED' && payment.status !== 'REFUNDED') {
        throw new ProviderError(
          'INVALID_STATE',
          `refund requires CAPTURED, payment ${payment.id} is ${payment.status}`,
        );
      }
      const remaining = payment.capturedTotal - payment.refundedTotal;
      if (input.amount.amountMinor > remaining) {
        throw new ProviderError(
          'AMOUNT_EXCEEDS_AUTHORIZATION',
          `refund ${input.amount.amountMinor} > refundable ${remaining}`,
        );
      }
      payment.refundedTotal += input.amount.amountMinor;
      if (payment.refundedTotal === payment.capturedTotal) {
        payment.status = 'REFUNDED';
      }
      payment.occurredAt = this.timestamp();
      const providerRefundId = this.nextId('re');
      this.emit('refund.completed', payment.id, {
        providerRefundId,
        amountMinor: input.amount.amountMinor,
      });
      return { providerRefundId, status: 'REFUND_COMPLETED' };
    });
  }

  // -- issuing (§16–§18 substrate) ---------------------------------------------

  async createCardholder(input: CreateCardholderInput): Promise<CardholderResult> {
    return this.idempotent(input.idempotencyKey, input, () => {
      const providerCardholderId = this.nextId('ch');
      this.cardholders.set(providerCardholderId, input);
      return { providerCardholderId };
    });
  }

  async issueTemporaryCard(input: IssueTemporaryCardInput): Promise<CardResult> {
    assertMoney(input.spendLimit, 'issueTemporaryCard.spendLimit');
    return this.idempotent(input.idempotencyKey, input, () => {
      if (!this.cardholders.has(input.providerCardholderId)) {
        throw new ProviderError('OBJECT_NOT_FOUND', `no cardholder ${input.providerCardholderId}`);
      }
      const providerCardId = this.nextId('card');
      this.cards.set(providerCardId, {
        id: providerCardId,
        cardholderId: input.providerCardholderId,
        status: 'ACTIVE',
        spendLimitMinor: input.spendLimit.amountMinor,
        authorizedTotalMinor: 0,
        capturedTotalMinor: 0,
        allowedMccs: null,
        blockedMccs: [],
      });
      return { providerCardId, status: 'ACTIVE' };
    });
  }

  async updateCardControls(input: UpdateCardControlsInput): Promise<void> {
    const card = this.requireCard(input.providerCardId);
    if (input.spendLimit) {
      assertMoney(input.spendLimit, 'updateCardControls.spendLimit');
      card.spendLimitMinor = input.spendLimit.amountMinor;
    }
    if (input.allowedMccs) card.allowedMccs = input.allowedMccs;
    if (input.blockedMccs) card.blockedMccs = input.blockedMccs;
  }

  async freezeCard(cardId: string): Promise<void> {
    const card = this.requireCard(cardId);
    if (card.status === 'CLOSED') {
      throw new ProviderError('INVALID_STATE', `card ${cardId} is CLOSED`);
    }
    card.status = 'FROZEN';
  }

  async closeCard(cardId: string): Promise<void> {
    this.requireCard(cardId).status = 'CLOSED';
  }

  private requireCard(cardId: string): CardRecord {
    const card = this.cards.get(cardId);
    if (!card) throw new ProviderError('OBJECT_NOT_FOUND', `no card ${cardId}`);
    return card;
  }

  /**
   * Mock-only: a merchant attempts an authorization on the temporary card. Models the
   * provider-side controls (card state, spend limit, MCC lists). VinkIn's own §17/§19
   * decision engine sits ON TOP of this in the real system — the mock lets those tests
   * simulate the provider half.
   */
  simulateMerchantAuthorization(request: MerchantAuthorizationRequest): MerchantAuthorizationOutcome {
    assertMoney(request.amount, 'simulateMerchantAuthorization.amount');
    const card = this.requireCard(request.providerCardId);

    if (card.status !== 'ACTIVE') {
      return { approved: false, declineReason: 'CARD_NOT_ACTIVE' };
    }
    if (card.blockedMccs.includes(request.mcc)) {
      return { approved: false, declineReason: 'MCC_BLOCKED' };
    }
    if (card.allowedMccs && !card.allowedMccs.includes(request.mcc)) {
      return { approved: false, declineReason: 'MCC_BLOCKED' };
    }
    if (card.authorizedTotalMinor + request.amount.amountMinor > card.spendLimitMinor) {
      return { approved: false, declineReason: 'OVER_LIMIT' };
    }

    card.authorizedTotalMinor += request.amount.amountMinor;
    const providerAuthorizationId = this.nextId('auth');
    this.cardTransactions.set(providerAuthorizationId, {
      providerTransactionId: providerAuthorizationId,
      providerCardId: card.id,
      kind: 'AUTHORIZATION',
      amount: request.amount,
      merchantId: request.merchantId,
      merchantName: request.merchantName,
      mcc: request.mcc,
      merchantCountry: request.merchantCountry,
      occurredAt: this.timestamp(),
    });
    this.emit('card.authorization.created', providerAuthorizationId, {
      providerCardId: card.id,
      amountMinor: request.amount.amountMinor,
      merchantId: request.merchantId,
      mcc: request.mcc,
    });
    return { approved: true, providerAuthorizationId };
  }

  /** Mock-only: merchant captures against a prior authorization (settlement leg, §18/§22). */
  simulateMerchantCapture(providerAuthorizationId: string, amount: Money): ProviderCardTransaction {
    assertMoney(amount, 'simulateMerchantCapture.amount');
    const auth = this.cardTransactions.get(providerAuthorizationId);
    if (!auth || auth.kind !== 'AUTHORIZATION') {
      throw new ProviderError('OBJECT_NOT_FOUND', `no authorization ${providerAuthorizationId}`);
    }
    const card = this.requireCard(auth.providerCardId);
    card.capturedTotalMinor += amount.amountMinor;
    const providerTransactionId = this.nextId('ctx');
    const capture: ProviderCardTransaction = {
      providerTransactionId,
      providerCardId: card.id,
      kind: 'CAPTURE',
      amount,
      merchantId: auth.merchantId,
      merchantName: auth.merchantName,
      mcc: auth.mcc,
      merchantCountry: auth.merchantCountry,
      occurredAt: this.timestamp(),
    };
    this.cardTransactions.set(providerTransactionId, capture);
    this.emit('card.capture.created', providerTransactionId, {
      providerCardId: card.id,
      amountMinor: amount.amountMinor,
    });
    return capture;
  }

  // -- reconciliation reads (§14/§28) -------------------------------------------

  async retrievePaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus> {
    const payment = this.getPayment(providerPaymentId);
    return {
      providerPaymentId: payment.id,
      status: payment.status,
      authorizedAmount: payment.authorizedAmount,
      capturedTotal:
        payment.capturedTotal > 0
          ? { amountMinor: payment.capturedTotal, currency: payment.currency }
          : null,
      refundedTotal:
        payment.refundedTotal > 0
          ? { amountMinor: payment.refundedTotal, currency: payment.currency }
          : null,
      occurredAt: payment.occurredAt,
    };
  }

  async retrieveCardTransaction(providerTransactionId: string): Promise<ProviderCardTransaction> {
    const transaction = this.cardTransactions.get(providerTransactionId);
    if (!transaction) {
      throw new ProviderError('OBJECT_NOT_FOUND', `no card transaction ${providerTransactionId}`);
    }
    return transaction;
  }

  // -- webhook simulation (§28) --------------------------------------------------

  static sign(rawBody: string, webhookSecret: string): string {
    return createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  }

  parseWebhookEvent(input: ParseWebhookInput): ProviderEvent {
    const expected = MockFinancialProvider.sign(input.rawBody, input.webhookSecret);
    if (input.signatureHeader !== expected) {
      throw new ProviderError('INVALID_SIGNATURE', 'webhook signature mismatch');
    }
    return JSON.parse(input.rawBody) as ProviderEvent;
  }

  /** Mock-only: take all pending events (delivery order = emission order unless reordered). */
  drainEvents(): ProviderEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** Mock-only: simulate duplicate delivery — re-queues the last event with the SAME id (§28). */
  duplicateLastEvent(): void {
    const last = this.events[this.events.length - 1];
    if (!last) throw new ProviderError('INVALID_STATE', 'no event to duplicate');
    this.events.push({ ...last });
  }
}
