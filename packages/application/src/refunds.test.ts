import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { UserId, VinkId } from '../../domain/src/index.ts';
import { MockFinancialProvider } from '../../payment-provider/src/index.ts';
import { InMemoryVinkStore } from './testing/in-memory.ts';
import type { CommandContext } from './ports.ts';
import {
  addParticipantCommand,
  createVinkCommand,
  openVinkCommand,
  setSplitCommand,
} from './commands.ts';
import { authorizeContributionCommand } from './contributions.ts';
import { provisionCardCommand } from './purchases.ts';
import {
  refundFailedSessionCommand,
  retryRefundCommand,
  type RefundCommandContext,
} from './refunds.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-18T10:00:00Z');
const DEADLINE = '2026-07-18T12:00:00Z';

function organizerCtx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

/** Build a FUNDED vink, then fail card provisioning → EXPIRED with CAPTURED contributions. */
async function failedSessionFixture(): Promise<{
  store: InMemoryVinkStore;
  provider: MockFinancialProvider;
  ctx: RefundCommandContext;
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

  // Card issuance fails → the vink reverses to EXPIRED; contributions stay CAPTURED.
  provider.simulateTransientFailure();
  await assert.rejects(provisionCardCommand(ctx, { vinkId: vink.id }));
  assert.equal((await store.getVink(vink.id))?.state, 'EXPIRED');
  return { store, provider, ctx, vinkId: vink.id };
}

describe('failed-session refunds (Plan PV7, journeys E2/E8)', () => {
  it('refunds every captured contribution of a failed vink; ledger nets to zero', async () => {
    const f = await failedSessionFixture();
    const summary = await refundFailedSessionCommand(f.ctx, { vinkId: f.vinkId });
    assert.deepEqual(summary, { refunded: 2, failed: 0 });
    const statuses = [...f.store.contributions.values()].map((r) => r.status);
    assert.deepEqual(statuses.sort(), ['REFUNDED', 'REFUNDED']);

    // Capture postings (PV5) + refund reversals (PV7) net every account to zero.
    const net = new Map<string, number>();
    for (const p of f.store.ledgerPostings) {
      for (const e of p.entries) {
        net.set(
          e.account,
          (net.get(e.account) ?? 0) + (e.direction === 'DEBIT' ? e.amountMinor : -e.amountMinor),
        );
      }
    }
    for (const [account, balance] of net) assert.equal(balance, 0, `${account} should net to zero`);
    assert.ok(f.store.outbox.map((e) => e.eventType).includes('RefundCompleted'));
  });

  it('E8: a provider failure yields REFUND_FAILED; retry-refund resolves it', async () => {
    const f = await failedSessionFixture();
    // The first refund call fails transiently (provider unavailable).
    f.provider.simulateTransientFailure();
    const summary = await refundFailedSessionCommand(f.ctx, { vinkId: f.vinkId });
    assert.equal(summary.failed, 1);
    assert.equal(summary.refunded, 1);

    const failed = [...f.store.contributions.values()].find((r) => r.status === 'REFUND_FAILED');
    assert.ok(failed, 'one contribution is REFUND_FAILED (observable, not swallowed)');
    assert.ok(f.store.outbox.map((e) => e.eventType).includes('RefundFailed'));

    const retried = await retryRefundCommand(f.ctx, {
      vinkId: f.vinkId,
      contributionId: failed!.id,
    });
    assert.equal(retried.status, 'REFUNDED');
    const statuses = [...f.store.contributions.values()].map((r) => r.status);
    assert.deepEqual(statuses.sort(), ['REFUNDED', 'REFUNDED']);
  });

  it('retry on a non-failed contribution is a no-op', async () => {
    const f = await failedSessionFixture();
    await refundFailedSessionCommand(f.ctx, { vinkId: f.vinkId });
    const refunded = [...f.store.contributions.values()][0]!;
    const result = await retryRefundCommand(f.ctx, {
      vinkId: f.vinkId,
      contributionId: refunded.id,
    });
    assert.equal(result.status, 'REFUNDED'); // unchanged
  });
});
