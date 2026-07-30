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
  DEFAULT_OPEN_DURATION_SECONDS,
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
// RM4A (D47): `openVinkCommand` now recomputes the deadline at open time using the real
// default (`DEFAULT_OPEN_DURATION_SECONDS`) — this literal is no longer honored (kept only
// because `createVinkCommand` still accepts an explicit value; `fixture()` below passes it,
// harmlessly overwritten the moment `openVinkCommand` runs).
const DEADLINE = '2026-07-18T12:00:00Z';
const AFTER_DEADLINE = new Date('2026-07-18T12:00:30Z');
// RM4A (D47): 30s into the 60s processing-grace window that starts after the REAL,
// open-time-computed deadline — needed by the one test below that specifically exercises the
// "deadline passed but grace hasn't" WAITING branch. `AFTER_DEADLINE` (deliberately far past
// everything) is still correct for every other test, which only needs "past everything."
const WITHIN_GRACE = new Date(NOW.getTime() + DEFAULT_OPEN_DURATION_SECONDS * 1000 + 30_000);
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
  it('RM3A: captures immediately on the FIRST authorization (not batched until funded), then funds on the last: balanced ledger + FUNDED', async () => {
    const f = await fixture();
    const first = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
    });
    // RM3A: capture happens on THIS contribution's own authorization, immediately — the vink
    // is still OPEN (nobody else has paid) but this money is already captured.
    assert.equal(first.contribution.status, 'CAPTURED');
    assert.equal(first.vinkState, 'OPEN');
    assert.equal(f.store.ledgerPostings.length, 2, 'the first contribution posts immediately');
    const { debits: firstDebits, credits: firstCredits } = ledgerTotals(f.store);
    assert.equal(firstDebits, firstCredits);
    assert.equal(firstDebits, 12_000); // 6000 capture + 6000 funding move

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
      'ContributionCaptureInitiated', // RM3A: the new capture-immediately edge, fired twice
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
    // RM3A: captured immediately, same as any other successful authorization.
    assert.equal(retried.contribution.status, 'CAPTURED');
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
    const outcome = await closeSubmissionsCommand(f.ctx, { vinkId: f.vinkId, now: WITHIN_GRACE });
    assert.equal(outcome, 'WAITING');
    assert.equal((await f.store.getVink(f.vinkId))?.state, 'PROCESSING_GRACE');

    // Provider confirms late (3DS-style); the resolver funds — decision made exactly once.
    f.provider.resolvePendingAuthorization(delayed.contribution.providerReference!, 'AUTHORIZED');
    await resolveContributionCommand(f.ctx, {
      contributionId: delayed.contribution.id,
      vinkId: f.vinkId,
      now: WITHIN_GRACE,
    });
    const vink = await f.store.getVink(f.vinkId);
    assert.equal(vink?.state, 'FUNDED');
    assert.equal(vink?.fundedAmount.amountMinor, 12_000);
  });

  it('RM3A: grace expiry with one contribution still pending and one already captured — the pending hold is cancelled, the captured money is REFUNDED (via REFUNDS_PENDING), vink lands EXPIRED', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberA,
      scenario: 'DELAYED',
    });
    // RM3A: member B's contribution captures immediately — real money moves before the vink
    // ever knows whether the whole session will fund.
    const ok = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.memberB,
    });
    assert.equal(ok.contribution.status, 'CAPTURED');

    // RM4A (D47): with the 7-minute default, `AFTER_DEADLINE`/`AFTER_GRACE` (fixture-era
    // constants, minutes/hours apart) are now both well past the real (much shorter) deadline
    // — `closeSubmissionsCommand` itself resolves the outcome in one shot (deadlineReached is
    // already true by the time it runs); `resolveGraceCommand` afterward is correctly a safe
    // no-op (`NOT_DUE`), the same "idempotent, whichever call actually gets there first"
    // shape this codebase's own sweep design already guarantees (Plan §10).
    const closeOutcome = await closeSubmissionsCommand(f.ctx, {
      vinkId: f.vinkId,
      now: AFTER_DEADLINE,
    });
    const graceOutcome = await resolveGraceCommand(f.ctx, { vinkId: f.vinkId, now: AFTER_GRACE });
    assert.ok(
      closeOutcome === 'EXPIRED' || graceOutcome === 'EXPIRED',
      `expected one of the two sweep calls to resolve EXPIRED, got close=${closeOutcome} grace=${graceOutcome}`,
    );
    assert.equal((await f.store.getVink(f.vinkId))?.state, 'EXPIRED');
    // Passed through REFUNDS_PENDING on its way to EXPIRED — real, audited, not skipped.
    const history = f.store.history.filter((row) => row.vinkId === f.vinkId);
    assert.ok(history.some((row) => row.toState === 'REFUNDS_PENDING'));

    const statuses = [...f.store.contributions.values()].map((row) => row.status);
    assert.deepEqual(statuses.sort(), ['CANCELLED', 'REFUNDED']);
    // The never-captured hold (member A) was released at the provider; the captured
    // contribution (member B) was genuinely refunded, not merely cancelled.
    const status = await f.provider.retrievePaymentStatus(ok.contribution.providerReference!);
    assert.equal(status.status, 'REFUNDED');
    // Money DID move (capture + funding-move + refund-reversal) and nets to zero — this is
    // the exact scenario the pre-RM3A hold model could never produce, since nothing was ever
    // captured before everyone funded.
    assert.equal(f.store.ledgerPostings.length, 3);
    const { debits, credits } = ledgerTotals(f.store);
    assert.equal(debits, credits);
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
    // RM3A: the resolver captures immediately once it learns the authorization actually
    // succeeded — the same capture-immediately treatment as the direct-authorize path.
    assert.equal(resolved.status, 'CAPTURED');
    // Exactly one authorization AND one capture happened at the provider for this
    // participant — the resolver's replay didn't duplicate either side effect.
    const events = f.provider.drainEvents();
    assert.equal(events.filter((event) => event.type === 'payment.authorized').length, 1);
    assert.equal(events.filter((event) => event.type === 'payment.captured').length, 1);
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

  it('Invites feature (D44): an INVITED (not yet accepted) participant cannot authorize a contribution — FORBIDDEN', async () => {
    const store = new InMemoryVinkStore();
    const provider = new MockFinancialProvider({ now: () => NOW });
    const { vink } = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    await addParticipantCommand(
      { ...organizerCtx(store), invitesEnabled: true },
      { vinkId: vink.id, userId: 'user-a' as UserId, displayName: 'a' },
    );
    await setSplitCommand(organizerCtx(store), { vinkId: vink.id, method: 'EQUAL' });
    await openVinkCommand(organizerCtx(store), { vinkId: vink.id });
    await assert.rejects(
      authorizeContributionCommand(
        { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider },
        { vinkId: vink.id, requester: { kind: 'user', userId: 'user-a' } },
      ),
      isAppError('FORBIDDEN'),
    );
  });
});
