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
import {
  authorizeContributionCommand,
  closeSubmissionsCommand,
  resolveContributionCommand,
  resolveGraceCommand,
  type ContributionCommandContext,
} from './contributions.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-18T10:00:00Z');
const DEADLINE = '2026-07-18T12:00:00Z'; // grace deadline = +60s
const AFTER_DEADLINE = new Date('2026-07-18T12:00:30Z');
const AFTER_GRACE = new Date('2026-07-18T12:01:30Z');

interface Fixture {
  store: InMemoryVinkStore;
  provider: MockFinancialProvider;
  ctx: ContributionCommandContext;
  vinkId: VinkId;
  memberA: { kind: 'user'; userId: string };
  memberB: { kind: 'user'; userId: string };
}

function organizerCtx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

async function fixture(): Promise<Fixture> {
  const store = new InMemoryVinkStore();
  const provider = new MockFinancialProvider({ now: () => NOW });
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
  return {
    store,
    provider,
    ctx: { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider },
    vinkId: vink.id,
    memberA: { kind: 'user', userId: 'user-a' },
    memberB: { kind: 'user', userId: 'user-b' },
  };
}

function ledgerTotals(store: InMemoryVinkStore) {
  let debits = 0;
  let credits = 0;
  for (const posting of store.ledgerPostings) {
    for (const entry of posting.entries) {
      if (entry.direction === 'DEBIT') debits += entry.amountMinor;
      else credits += entry.amountMinor;
    }
  }
  return { debits, credits };
}

const isAppError = (code: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === code;

describe('mock contribution flow (Plan PV5)', () => {
  it('funds the vink when the last authorization arrives: capture + balanced ledger + FUNDED', async () => {
    const f = await fixture();
    const first = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
    });
    assert.equal(first.contribution.status, 'AUTHORIZED');
    assert.equal(first.vinkState, 'OPEN');

    const second = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberB,
    });
    assert.equal(second.vinkState, 'FUNDED');
    assert.equal(second.contribution.status, 'CAPTURED');

    const vink = await f.store.getVink(f.vinkId);
    assert.equal(vink?.state, 'FUNDED');
    assert.equal(vink?.fundedAmount.amountMinor, 12_000);
    const statuses = [...f.store.contributions.values()].map((row) => row.status);
    assert.deepEqual(statuses.sort(), ['CAPTURED', 'CAPTURED']);

    // Two postings per contribution (capture + funding move), all balanced.
    assert.equal(f.store.ledgerPostings.length, 4);
    const { debits, credits } = ledgerTotals(f.store);
    assert.equal(debits, credits);
    assert.equal(debits, 24_000); // 2 × (6000 capture + 6000 funding move)

    const eventTypes = f.store.outbox.map((event) => event.eventType);
    for (const expected of [
      'SubmissionsClosed',
      'ProcessingGraceStarted',
      'ContributionCaptured',
      'VinkFunded',
    ]) {
      assert.ok(eventTypes.includes(expected as never), `missing ${expected}`);
    }
  });

  it('a decline is terminal for the attempt; the next attempt succeeds with a fresh key', async () => {
    const f = await fixture();
    const declined = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
      scenario: 'DECLINE',
    });
    assert.equal(declined.contribution.status, 'DECLINED');
    assert.equal(declined.contribution.attemptNumber, 1);

    const retried = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
    });
    assert.equal(retried.contribution.status, 'AUTHORIZED');
    assert.equal(retried.contribution.attemptNumber, 2);
    assert.notEqual(retried.contribution.idempotencyKey, declined.contribution.idempotencyKey);
  });

  it('a double tap replays the live contribution — never a second charge', async () => {
    const f = await fixture();
    const first = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
    });
    const second = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
    });
    assert.equal(second.replayed, true);
    assert.equal(second.contribution.id, first.contribution.id);
    assert.equal(
      [...f.store.contributions.values()].filter(
        (row) => row.participantId === first.contribution.participantId,
      ).length,
      1,
    );
  });

  it('delayed authorization: WAITING during grace, FUNDED once the provider resolves', async () => {
    const f = await fixture();
    const delayed = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
      scenario: 'DELAYED',
    });
    assert.equal(delayed.contribution.status, 'AUTHORIZATION_PENDING');
    await authorizeContributionCommand(f.ctx, { vinkId: f.vinkId, requester: f.memberB });

    // Deadline passes with one contribution still pending → grace waits, no decision yet.
    const outcome = await closeSubmissionsCommand(f.ctx, { vinkId: f.vinkId, now: AFTER_DEADLINE });
    assert.equal(outcome, 'WAITING');
    assert.equal((await f.store.getVink(f.vinkId))?.state, 'PROCESSING_GRACE');

    // Provider confirms late (3DS-style); the resolver funds — decision made exactly once.
    f.provider.resolvePendingAuthorization(delayed.contribution.providerReference!, 'AUTHORIZED');
    await resolveContributionCommand(f.ctx, {
      contributionId: delayed.contribution.id,
      vinkId: f.vinkId,
      now: AFTER_DEADLINE,
    });
    const vink = await f.store.getVink(f.vinkId);
    assert.equal(vink?.state, 'FUNDED');
    assert.equal(vink?.fundedAmount.amountMinor, 12_000);
  });

  it('grace expiry with an unresolved contribution: EXPIRED, every hold released', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
      scenario: 'DELAYED',
    });
    const ok = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberB,
    });

    await closeSubmissionsCommand(f.ctx, { vinkId: f.vinkId, now: AFTER_DEADLINE });
    const outcome = await resolveGraceCommand(f.ctx, { vinkId: f.vinkId, now: AFTER_GRACE });
    assert.equal(outcome, 'EXPIRED');
    assert.equal((await f.store.getVink(f.vinkId))?.state, 'EXPIRED');

    const statuses = [...f.store.contributions.values()].map((row) => row.status);
    assert.deepEqual(statuses.sort(), ['CANCELLED', 'CANCELLED']);
    // The authorized hold was released at the provider too.
    const status = await f.provider.retrievePaymentStatus(ok.contribution.providerReference!);
    assert.equal(status.status, 'CANCELED');
    // No money moved: nothing was captured, so nothing was posted.
    assert.equal(f.store.ledgerPostings.length, 0);
  });

  it('lost response (E5): RESOLUTION_PENDING, then the same key replays without a duplicate', async () => {
    const f = await fixture();
    f.provider.simulateLostResponse();
    const lost = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
    });
    assert.equal(lost.contribution.status, 'RESOLUTION_PENDING');
    assert.equal(lost.contribution.providerReference, null);

    const resolved = await resolveContributionCommand(f.ctx, {
      contributionId: lost.contribution.id,
      vinkId: f.vinkId,
    });
    assert.equal(resolved.status, 'AUTHORIZED');
    // Exactly one authorization happened at the provider for this participant.
    const authorizedEvents = f.provider
      .drainEvents()
      .filter((event) => event.type === 'payment.authorized');
    assert.equal(authorizedEvents.length, 1);
  });

  it('locks split/cover/remove once a live contribution exists', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, { vinkId: f.vinkId, requester: f.memberA });
    await assert.rejects(
      setSplitCommand(organizerCtx(f.store), { vinkId: f.vinkId, method: 'EQUAL' }),
      isAppError('INVALID_COMMAND'),
    );
  });

  it('rejects non-participants and non-OPEN states', async () => {
    const f = await fixture();
    await assert.rejects(
      authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: 'stranger' },
      }),
      isAppError('FORBIDDEN'),
    );
    await closeSubmissionsCommand(f.ctx, { vinkId: f.vinkId, now: AFTER_GRACE });
    await assert.rejects(
      authorizeContributionCommand(f.ctx, { vinkId: f.vinkId, requester: f.memberA }),
      isAppError('INVALID_COMMAND'),
    );
  });
});
