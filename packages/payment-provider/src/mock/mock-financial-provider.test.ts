import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderError } from '../errors.ts';
import { operationId } from '../operation-ids.ts';
import type { Money } from '../types.ts';
import { MockFinancialProvider } from './mock-financial-provider.ts';

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });

async function setup(methodToken = 'tok_ok') {
  const provider = new MockFinancialProvider();
  const { providerCustomerId } = await provider.createCustomer({
    idempotencyKey: 'cus:test:1',
    externalUserId: 'user-1',
  });
  const { providerMethodId } = await provider.setupPaymentMethod({
    idempotencyKey: 'pm:test:1',
    providerCustomerId,
    methodToken,
    usage: 'CONTRIBUTION',
  });
  return { provider, providerCustomerId, providerMethodId };
}

function authorizeInput(
  ids: { providerCustomerId: string; providerMethodId: string },
  slotId: string,
  generation: number,
  amountMinor: number,
) {
  return {
    idempotencyKey: operationId.authorize(slotId, generation),
    providerCustomerId: ids.providerCustomerId,
    providerMethodId: ids.providerMethodId,
    amount: usd(amountMinor),
    captureMode: 'MANUAL' as const,
    metadata: { vinkId: 'vink-1', contributionSlotId: slotId },
  };
}

describe('contribution lifecycle (§11)', () => {
  it('authorize → capture base ≤ maximum → refund, with events carrying provider timestamps', async () => {
    const ids = await setup();
    const { provider } = ids;

    const auth = await provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    assert.equal(auth.status, 'AUTHORIZED');

    // §21 base-capture strategy: capture the base share, below the authorized maximum
    const capture = await provider.captureContribution({
      idempotencyKey: operationId.capture('slot-1', 1),
      providerPaymentId: auth.providerPaymentId,
      amount: usd(4_500),
    });
    assert.equal(capture.status, 'CAPTURED');

    const refund = await provider.refundContribution({
      idempotencyKey: operationId.refund('refund-1'),
      providerPaymentId: auth.providerPaymentId,
      amount: usd(4_500),
    });
    assert.equal(refund.status, 'REFUND_COMPLETED');

    const status = await provider.retrievePaymentStatus(auth.providerPaymentId);
    assert.equal(status.status, 'REFUNDED');

    const events = provider.drainEvents();
    assert.deepEqual(
      events.map((event) => event.type),
      ['payment.authorized', 'payment.captured', 'refund.completed'],
    );
    for (const event of events) assert.ok(Date.parse(event.occurredAt) > 0);
  });

  it('rejects capture above the authorized maximum (§4.7)', async () => {
    const ids = await setup();
    const auth = await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    await assert.rejects(
      ids.provider.captureContribution({
        idempotencyKey: operationId.capture('slot-1', 1),
        providerPaymentId: auth.providerPaymentId,
        amount: usd(5_001),
      }),
      (error: ProviderError) => error.code === 'AMOUNT_EXCEEDS_AUTHORIZATION',
    );
  });

  it('rejects cancel after capture and refund beyond captured total (INVALID_STATE / limits)', async () => {
    const ids = await setup();
    const auth = await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    await ids.provider.captureContribution({
      idempotencyKey: operationId.capture('slot-1', 1),
      providerPaymentId: auth.providerPaymentId,
      amount: usd(5_000),
    });

    await assert.rejects(
      ids.provider.cancelContributionAuthorization({
        idempotencyKey: 'cancel:v1:slot-1:1',
        providerPaymentId: auth.providerPaymentId,
        reason: 'VINK_EXPIRED',
      }),
      (error: ProviderError) => error.code === 'INVALID_STATE',
    );

    await assert.rejects(
      ids.provider.refundContribution({
        idempotencyKey: operationId.refund('refund-too-big'),
        providerPaymentId: auth.providerPaymentId,
        amount: usd(5_001),
      }),
      (error: ProviderError) => error.code === 'AMOUNT_EXCEEDS_AUTHORIZATION',
    );
  });

  it('releases (cancels) an uncaptured authorization — the preferred failed-Vink path (§25)', async () => {
    const ids = await setup();
    const auth = await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    const cancel = await ids.provider.cancelContributionAuthorization({
      idempotencyKey: 'cancel:v1:slot-1:1',
      providerPaymentId: auth.providerPaymentId,
      reason: 'VINK_EXPIRED',
    });
    assert.equal(cancel.status, 'CANCELED');
    const status = await ids.provider.retrievePaymentStatus(auth.providerPaymentId);
    assert.equal(status.status, 'CANCELED');
  });
});

describe('idempotency (§12)', () => {
  it('replaying the same operation id returns the same payment and emits no duplicate event', async () => {
    const ids = await setup();
    const first = await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    const replay = await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    assert.equal(replay.providerPaymentId, first.providerPaymentId);
    assert.equal(
      ids.provider.drainEvents().filter((event) => event.type === 'payment.authorized').length,
      1,
    );
  });

  it('same operation id with different parameters is a conflict, not a silent overwrite', async () => {
    const ids = await setup();
    await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    await assert.rejects(
      ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 9_999)),
      (error: ProviderError) => error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('a definitive decline requires a NEW attempt generation, which succeeds independently', async () => {
    const ids = await setup('tok_decline');
    const declined = await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    assert.equal(declined.status, 'DECLINED');

    // new generation (gen 2) with a good method — models §11 retry after definitive decline
    const goodMethod = await ids.provider.setupPaymentMethod({
      idempotencyKey: 'pm:test:2',
      providerCustomerId: ids.providerCustomerId,
      methodToken: 'tok_ok',
      usage: 'CONTRIBUTION',
    });
    const retry = await ids.provider.authorizeContribution({
      ...authorizeInput(ids, 'slot-1', 2, 5_000),
      providerMethodId: goodMethod.providerMethodId,
    });
    assert.equal(retry.status, 'AUTHORIZED');
  });
});

describe('async resolution & reconciliation (§14, §28)', () => {
  it('a pending authorization resolves later; retrievePaymentStatus reports provider truth', async () => {
    const ids = await setup('tok_pending');
    const auth = await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    assert.equal(auth.status, 'PROCESSING');

    // grace-period reconciliation reads the provider object directly (§14)
    let status = await ids.provider.retrievePaymentStatus(auth.providerPaymentId);
    assert.equal(status.status, 'PROCESSING');

    ids.provider.resolvePendingAuthorization(auth.providerPaymentId, 'AUTHORIZED');
    status = await ids.provider.retrievePaymentStatus(auth.providerPaymentId);
    assert.equal(status.status, 'AUTHORIZED');
  });

  it('duplicate webhook delivery reuses the SAME provider event id (inbox dedup key, §28)', async () => {
    const ids = await setup();
    await ids.provider.authorizeContribution(authorizeInput(ids, 'slot-1', 1, 5_000));
    ids.provider.duplicateLastEvent();
    const events = ids.provider.drainEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0]!.providerEventId, events[1]!.providerEventId);
  });

  it('verifies webhook signatures and rejects tampering (§28)', async () => {
    const provider = new MockFinancialProvider();
    const event = {
      provider: 'mock',
      providerEventId: 'evt_x',
      type: 'payment.captured',
      occurredAt: new Date().toISOString(),
      objectId: 'pay_x',
      payload: {},
    };
    const rawBody = JSON.stringify(event);
    const parsed = provider.parseWebhookEvent({
      rawBody,
      signatureHeader: MockFinancialProvider.sign(rawBody, 'secret-1'),
      webhookSecret: 'secret-1',
    });
    assert.equal(parsed.providerEventId, 'evt_x');

    assert.throws(
      () =>
        provider.parseWebhookEvent({
          rawBody,
          signatureHeader: MockFinancialProvider.sign(rawBody, 'wrong-secret'),
          webhookSecret: 'secret-1',
        }),
      (error: ProviderError) => error.code === 'INVALID_SIGNATURE',
    );
  });
});

describe('temporary card substrate (§16–§19)', () => {
  async function issueCard(provider: MockFinancialProvider, spendLimitMinor: number) {
    const { providerCardholderId } = await provider.createCardholder({
      idempotencyKey: 'ch:test:1',
      externalAccountId: 'account-1',
      legalName: 'Organizer One',
    });
    const { providerCardId } = await provider.issueTemporaryCard({
      idempotencyKey: operationId.issueCard('vink-1'),
      providerCardholderId,
      spendLimit: usd(spendLimitMinor),
      metadata: { vinkId: 'vink-1' },
    });
    return providerCardId;
  }

  it('approves within limit, declines over cumulative limit (§17 exposure math)', async () => {
    const provider = new MockFinancialProvider();
    const cardId = await issueCard(provider, 12_843); // the §2 grocery example: $128.43

    const first = provider.simulateMerchantAuthorization({
      providerCardId: cardId,
      amount: usd(12_843),
      merchantId: 'mch_grocery',
      merchantName: 'Grocery Mart',
      mcc: '5411',
      merchantCountry: 'US',
    });
    assert.equal(first.approved, true);

    const second = provider.simulateMerchantAuthorization({
      providerCardId: cardId,
      amount: usd(1),
      merchantId: 'mch_grocery',
      merchantName: 'Grocery Mart',
      mcc: '5411',
      merchantCountry: 'US',
    });
    assert.deepEqual(second, { approved: false, declineReason: 'OVER_LIMIT' });
  });

  it('enforces MCC blocks (cash-like always blocked, §3.2/§36) and frozen/closed states', async () => {
    const provider = new MockFinancialProvider();
    const cardId = await issueCard(provider, 10_000);
    await provider.updateCardControls({ providerCardId: cardId, blockedMccs: ['6011'] });

    const atm = provider.simulateMerchantAuthorization({
      providerCardId: cardId,
      amount: usd(2_000),
      merchantId: 'mch_atm',
      merchantName: 'ATM',
      mcc: '6011',
      merchantCountry: 'US',
    });
    assert.equal(atm.declineReason, 'MCC_BLOCKED');

    await provider.freezeCard(cardId);
    const frozen = provider.simulateMerchantAuthorization({
      providerCardId: cardId,
      amount: usd(1_000),
      merchantId: 'mch_grocery',
      merchantName: 'Grocery Mart',
      mcc: '5411',
      merchantCountry: 'US',
    });
    assert.equal(frozen.declineReason, 'CARD_NOT_ACTIVE');
  });

  it('records merchant capture with merchant identity for settlement matching (§18/§22)', async () => {
    const provider = new MockFinancialProvider();
    const cardId = await issueCard(provider, 21_600); // §21 example: $216.00 maximum total

    const auth = provider.simulateMerchantAuthorization({
      providerCardId: cardId,
      amount: usd(18_000), // base bill $180
      merchantId: 'mch_bistro',
      merchantName: 'Bistro',
      mcc: '5812',
      merchantCountry: 'US',
    });
    assert.equal(auth.approved, true);

    // merchant settles base + tip — the §22 over-funded delta is detected by VinkIn's
    // settlement service comparing this capture against the funded amount
    const capture = provider.simulateMerchantCapture(auth.providerAuthorizationId!, usd(19_200));
    assert.equal(capture.kind, 'CAPTURE');
    assert.equal(capture.merchantId, 'mch_bistro');

    const fetched = await provider.retrieveCardTransaction(capture.providerTransactionId);
    assert.equal(fetched.amount.amountMinor, 19_200);
  });
});

describe('money validation (§26)', () => {
  it('rejects non-integer and non-positive amounts at the boundary', async () => {
    const ids = await setup();
    for (const bad of [0, -5, 12.5, Number.NaN]) {
      await assert.rejects(
        ids.provider.authorizeContribution({
          ...authorizeInput(ids, 'slot-bad', 1, 1),
          amount: { amountMinor: bad, currency: 'USD' },
        }),
        RangeError,
      );
    }
  });
});
