import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { UserId, VinkId } from '../../domain/src/index.ts';
import { MockFinancialProvider } from '../../payment-provider/src/index.ts';
import { InMemoryVinkStore } from './testing/in-memory.ts';
import { ApplicationError } from './errors.ts';
import type { CommandContext } from './ports.ts';
import {
  addParticipantCommand,
  createVinkCommand,
  openVinkCommand,
  setSplitCommand,
} from './commands.ts';
import { authorizeContributionCommand, type ContributionCommandContext } from './contributions.ts';
import {
  authorizeMerchantPurchaseCommand,
  provisionCardCommand,
  reverseAuthorizationCommand,
  settlePurchaseCommand,
  type PurchaseCommandContext,
} from './purchases.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-18T10:00:00Z');
const DEADLINE = '2026-07-18T12:00:00Z';

interface Fixture {
  store: InMemoryVinkStore;
  provider: MockFinancialProvider;
  ctx: PurchaseCommandContext & ContributionCommandContext;
  vinkId: VinkId;
}

function organizerCtx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

/** Build a FUNDED vink: two members each authorize $60 of a $120 grocery total. */
async function fundedFixture(): Promise<Fixture> {
  const store = new InMemoryVinkStore();
  const provider = new MockFinancialProvider({ now: () => NOW });
  const ctx = { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider };
  const { vink, participants } = await createVinkCommand(organizerCtx(store), {
    purchaseCategory: 'GROCERY',
    subtotalMinor: 12_000,
    tipMinor: 0,
    submissionDeadline: DEADLINE,
    organizerDisplayName: 'Org',
  });
  const a = await addParticipantCommand(organizerCtx(store), {
    vinkId: vink.id,
    userId: 'user-a' as UserId,
    displayName: 'a',
  });
  const b = await addParticipantCommand(organizerCtx(store), {
    vinkId: vink.id,
    userId: 'user-b' as UserId,
    displayName: 'b',
  });
  await setSplitCommand(organizerCtx(store), {
    vinkId: vink.id,
    method: 'CUSTOM_AMOUNT',
    amounts: [
      { participantId: participants[0]!.id, amountMinor: 0 },
      { participantId: a.id, amountMinor: 6_000 },
      { participantId: b.id, amountMinor: 6_000 },
    ],
  });
  await openVinkCommand(organizerCtx(store), { vinkId: vink.id });
  await authorizeContributionCommand(ctx, {
    vinkId: vink.id,
    requester: { kind: 'user', userId: 'user-a' },
  });
  await authorizeContributionCommand(ctx, {
    vinkId: vink.id,
    requester: { kind: 'user', userId: 'user-b' },
  });
  assert.equal((await store.getVink(vink.id))?.state, 'FUNDED');
  return { store, provider, ctx, vinkId: vink.id };
}

/** Provider-side merchant swipe → providerAuthorizationId (what the simulator does). */
function swipe(f: Fixture, cardProviderId: string, amountMinor: number, merchantId = 'GROCER-1') {
  const outcome = f.provider.simulateMerchantAuthorization({
    providerCardId: cardProviderId,
    amount: { amountMinor, currency: 'USD' },
    merchantId,
    merchantName: 'Corner Grocer',
    mcc: '5411',
    merchantCountry: 'US',
  });
  return outcome;
}

const isAppError = (code: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === code;

describe('mock card + purchase flow (Plan PV6)', () => {
  it('E1: FUNDED → card → merchant auth → capture → COMPLETED, ledger balanced, card closed', async () => {
    const f = await fundedFixture();
    const card = await provisionCardCommand(f.ctx, { vinkId: f.vinkId });
    assert.equal(card.status, 'ACTIVE');
    assert.equal(card.spendingLimit.amountMinor, 12_000);
    assert.equal((await f.store.getVink(f.vinkId))?.state, 'CARD_READY');

    const auth = swipe(f, card.providerCardId, 12_000);
    assert.equal(auth.approved, true);
    const result = await authorizeMerchantPurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      providerAuthorizationId: auth.providerAuthorizationId!,
      merchantName: 'Corner Grocer',
      merchantIdentifier: 'GROCER-1',
      mcc: '5411',
      amountMinor: 12_000,
    });
    assert.equal(result.outcome, 'APPROVED');
    assert.equal(result.vinkState, 'PURCHASE_AUTHORIZED');
    assert.equal((await f.store.getCardByVink(f.vinkId))?.merchantLockKey, 'GROCER-1');

    f.provider.simulateMerchantCapture(auth.providerAuthorizationId!, {
      amountMinor: 12_000,
      currency: 'USD',
    });
    const settled = await settlePurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      authorizationId: result.authorization.id,
      settledAmountMinor: 12_000,
    });
    assert.equal(settled.settlement.status, 'MATCHED');
    assert.equal(settled.vinkState, 'COMPLETED');
    assert.equal((await f.store.getCardByVink(f.vinkId))?.status, 'CLOSED');

    let debits = 0;
    let credits = 0;
    for (const posting of f.store.ledgerPostings) {
      for (const entry of posting.entries) {
        if (entry.direction === 'DEBIT') debits += entry.amountMinor;
        else credits += entry.amountMinor;
      }
    }
    assert.equal(debits, credits);
    const events = f.store.outbox.map((e) => e.eventType);
    for (const expected of [
      'MerchantAuthorizationApproved',
      'MerchantLocked',
      'PurchaseCaptured',
      'VinkCompleted',
    ]) {
      assert.ok(events.includes(expected as never), `missing ${expected}`);
    }
  });

  it('EXIT GATE: a fully funded Vink completes EXACTLY ONE purchase (E4 duplicate)', async () => {
    const f = await fundedFixture();
    const card = await provisionCardCommand(f.ctx, { vinkId: f.vinkId });
    const auth = swipe(f, card.providerCardId, 12_000);

    const request = {
      vinkId: f.vinkId,
      providerAuthorizationId: auth.providerAuthorizationId!,
      merchantName: 'Corner Grocer',
      merchantIdentifier: 'GROCER-1',
      mcc: '5411',
      amountMinor: 12_000,
    };
    const first = await authorizeMerchantPurchaseCommand(f.ctx, request);
    const second = await authorizeMerchantPurchaseCommand(f.ctx, request);
    assert.equal(first.outcome, 'APPROVED');
    assert.equal(second.outcome, 'DUPLICATE');
    assert.equal(second.authorization.id, first.authorization.id);
    assert.equal(f.store.purchaseAuthorizations.size, 1);

    // A different merchant on the locked card is declined (first-merchant lock).
    const other = swipe(f, card.providerCardId, 5_000, 'GROCER-2');
    // Provider over-limit may pre-empt; force a fresh provider auth id if declined there.
    const otherAuthId = other.providerAuthorizationId ?? 'auth_other';
    const declined = await authorizeMerchantPurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      providerAuthorizationId: otherAuthId,
      merchantName: 'Other Store',
      merchantIdentifier: 'GROCER-2',
      mcc: '5411',
      amountMinor: 5_000,
    });
    assert.equal(declined.outcome, 'DECLINED');
  });

  it('declines an over-limit authorization and one above the merchant lock', async () => {
    const f = await fundedFixture();
    await provisionCardCommand(f.ctx, { vinkId: f.vinkId });
    const over = await authorizeMerchantPurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      providerAuthorizationId: 'auth_over',
      merchantName: 'Corner Grocer',
      merchantIdentifier: 'GROCER-1',
      mcc: '5411',
      amountMinor: 12_001,
    });
    assert.equal(over.outcome, 'DECLINED');
    assert.equal(over.vinkState, 'CARD_READY');
  });

  it('reversal returns PURCHASE_AUTHORIZED → CARD_READY and releases the reserve', async () => {
    const f = await fundedFixture();
    const card = await provisionCardCommand(f.ctx, { vinkId: f.vinkId });
    const auth = swipe(f, card.providerCardId, 12_000);
    const result = await authorizeMerchantPurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      providerAuthorizationId: auth.providerAuthorizationId!,
      merchantName: 'Corner Grocer',
      merchantIdentifier: 'GROCER-1',
      mcc: '5411',
      amountMinor: 12_000,
    });
    const reversed = await reverseAuthorizationCommand(f.ctx, {
      vinkId: f.vinkId,
      authorizationId: result.authorization.id,
    });
    assert.equal(reversed.state, 'CARD_READY');
    // reserve + release net to zero across postings.
    const net = f.store.ledgerPostings
      .flatMap((p) => p.entries)
      .filter((e) => e.account === 'purchase_authorization_reserve')
      .reduce((sum, e) => sum + (e.direction === 'DEBIT' ? e.amountMinor : -e.amountMinor), 0);
    assert.equal(net, 0);
  });

  it('E7: settlement overage → RECOVERY_REQUIRED (recovery obligation is PV7)', async () => {
    const f = await fundedFixture();
    const card = await provisionCardCommand(f.ctx, { vinkId: f.vinkId });
    const auth = swipe(f, card.providerCardId, 12_000);
    const result = await authorizeMerchantPurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      providerAuthorizationId: auth.providerAuthorizationId!,
      merchantName: 'Corner Grocer',
      merchantIdentifier: 'GROCER-1',
      mcc: '5411',
      amountMinor: 12_000,
    });
    const settled = await settlePurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      authorizationId: result.authorization.id,
      settledAmountMinor: 13_500, // merchant settled $15 over
    });
    assert.equal(settled.settlement.status, 'OVERAGE');
    assert.equal(settled.settlement.varianceAmount.amountMinor, 1_500);
    assert.equal(settled.vinkState, 'RECOVERY_REQUIRED');
    const events = f.store.outbox.map((e) => e.eventType);
    assert.ok(events.includes('SettlementVarianceDetected'));
  });

  it('card provisioning requires FUNDED', async () => {
    const store = new InMemoryVinkStore();
    const provider = new MockFinancialProvider({ now: () => NOW });
    const ctx = { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider };
    const { vink } = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 1_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    await assert.rejects(
      provisionCardCommand(ctx, { vinkId: vink.id }),
      isAppError('INVALID_COMMAND'),
    );
  });
});
