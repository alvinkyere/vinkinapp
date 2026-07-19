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
import { authorizeContributionCommand } from './contributions.ts';
import {
  authorizeMerchantPurchaseCommand,
  provisionCardCommand,
  settlePurchaseCommand,
} from './purchases.ts';
import {
  RECOVERY_MAX_ATTEMPTS,
  retryRecoveryCommand,
  startRecoveryCommand,
  type RecoveryCommandContext,
} from './recovery.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-18T10:00:00Z');
const DEADLINE = '2026-07-18T12:00:00Z';

function organizerCtx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

/** Build a vink that settled with a $15 overage → RECOVERY_REQUIRED. */
async function overageFixture(): Promise<{
  store: InMemoryVinkStore;
  provider: MockFinancialProvider;
  ctx: RecoveryCommandContext;
  vinkId: VinkId;
}> {
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
  const card = await provisionCardCommand(ctx, { vinkId: vink.id });
  const swipe = provider.simulateMerchantAuthorization({
    providerCardId: card.providerCardId,
    amount: { amountMinor: 12_000, currency: 'USD' },
    merchantId: 'GROCER-1',
    merchantName: 'Grocer',
    mcc: '5411',
    merchantCountry: 'US',
  });
  const auth = await authorizeMerchantPurchaseCommand(ctx, {
    vinkId: vink.id,
    providerAuthorizationId: swipe.providerAuthorizationId!,
    merchantName: 'Grocer',
    merchantIdentifier: 'GROCER-1',
    mcc: '5411',
    amountMinor: 12_000,
  });
  const settled = await settlePurchaseCommand(ctx, {
    vinkId: vink.id,
    authorizationId: auth.authorization.id,
    settledAmountMinor: 13_500,
  });
  assert.equal(settled.vinkState, 'RECOVERY_REQUIRED');
  return { store, provider, ctx, vinkId: vink.id };
}

function ledgerBalanced(store: InMemoryVinkStore): boolean {
  let d = 0;
  let c = 0;
  for (const p of store.ledgerPostings) {
    for (const e of p.entries) {
      if (e.direction === 'DEBIT') d += e.amountMinor;
      else c += e.amountMinor;
    }
  }
  return d === c;
}

describe('recovery (Plan PV7, journey E7)', () => {
  it('E7: overage → obligation + organizer charged → RECOVERY_RESOLVED → COMPLETED', async () => {
    const f = await overageFixture();
    const result = await startRecoveryCommand(f.ctx, { vinkId: f.vinkId });
    assert.equal(result.outcome, 'RESOLVED');
    assert.equal(result.vinkState, 'COMPLETED');
    assert.equal(result.obligation.amount.amountMinor, 1_500);
    assert.equal(result.obligation.status, 'RESOLVED');
    assert.ok(ledgerBalanced(f.store));

    // Participants were NOT recharged: their contributions remain CAPTURED.
    const statuses = [...f.store.contributions.values()].map((r) => r.status);
    assert.deepEqual(statuses.sort(), ['CAPTURED', 'CAPTURED']);
    const events = f.store.outbox.map((e) => e.eventType);
    assert.ok(events.includes('RecoveryObligationCreated'));
    assert.ok(events.includes('VinkCompleted'));
  });

  it('declined charges retry and finally DEFAULT → RESTRICTED, loss written off', async () => {
    const f = await overageFixture();
    let result = await startRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
    assert.equal(result.outcome, 'RETRY_SCHEDULED');
    assert.equal(result.vinkState, 'RECOVERY_PENDING');

    // attempts 2 .. MAX-1 keep scheduling; the MAX-th fails into DEFAULTED.
    for (let attempt = 2; attempt < RECOVERY_MAX_ATTEMPTS; attempt += 1) {
      result = await retryRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
      assert.equal(result.outcome, 'RETRY_SCHEDULED');
    }
    result = await retryRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
    assert.equal(result.outcome, 'DEFAULTED');
    assert.equal(result.vinkState, 'RESTRICTED');
    assert.equal(result.obligation.status, 'DEFAULTED');
    assert.ok(ledgerBalanced(f.store));
    assert.ok(f.store.outbox.map((e) => e.eventType).includes('OrganizerRestricted'));
  });

  it('a declined start then a successful retry resolves', async () => {
    const f = await overageFixture();
    await startRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
    const retried = await retryRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'SUCCESS' });
    assert.equal(retried.outcome, 'RESOLVED');
    assert.equal(retried.vinkState, 'COMPLETED');
    assert.ok(ledgerBalanced(f.store));
  });

  it('rejects recovery when the vink is not in RECOVERY_REQUIRED', async () => {
    const f = await overageFixture();
    await startRecoveryCommand(f.ctx, { vinkId: f.vinkId }); // → COMPLETED
    await assert.rejects(
      startRecoveryCommand(f.ctx, { vinkId: f.vinkId }),
      (error: unknown) => error instanceof ApplicationError && error.code === 'INVALID_COMMAND',
    );
  });
});
