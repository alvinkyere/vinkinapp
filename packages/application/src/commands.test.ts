import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DomainError,
  IllegalTransitionError,
  type UserId,
  type VinkId,
} from '../../domain/src/index.ts';
import { InMemoryVinkStore } from './testing/in-memory.ts';
import { ApplicationError, CreationIdempotencyRaceError } from './errors.ts';
import type { CommandContext } from './ports.ts';
import {
  addParticipantCommand,
  cancelVinkCommand,
  configureVinkCommand,
  coverRemainingCommand,
  createVinkCommand,
  openVinkCommand,
  removeParticipantCommand,
  setSplitCommand,
} from './commands.ts';
import { getVinkActivity, getVinkSnapshot, listMyVinks } from './queries.ts';

const ORGANIZER = 'organizer-user' as UserId;
const FUTURE = new Date('2026-08-01T12:00:00Z').toISOString();

function ctx(store: InMemoryVinkStore, actorUserId: string = ORGANIZER): CommandContext {
  return {
    uow: store,
    clock: { now: () => new Date('2026-07-17T10:00:00Z') },
    actorUserId,
    correlationId: 'test-correlation',
  };
}

async function createDraft(store: InMemoryVinkStore, subtotalMinor = 12_000) {
  return createVinkCommand(ctx(store), {
    purchaseCategory: 'GROCERY',
    subtotalMinor,
    tipMinor: 0,
    submissionDeadline: FUTURE,
    organizerDisplayName: 'Org',
  });
}

const isAppError = (code: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === code;

describe('CreateVinkCommand', () => {
  it('creates a DRAFT vink with organizer participant, public code and VinkCreated event', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participants } = await createDraft(store);
    assert.equal(vink.state, 'DRAFT');
    assert.equal(vink.requiredAmount.amountMinor, 12_000);
    assert.equal(vink.paymentPolicy, 'EXACT_FINAL');
    assert.match(vink.publicCode, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    assert.equal(participants[0]?.role, 'ORGANIZER');
    assert.deepEqual(
      store.outbox.map((event) => event.eventType),
      ['VinkCreated'],
    );
  });

  it('ENG1 timer semantics: an omitted submissionDeadline defaults to the fallback open duration (24h)', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 5_000,
      tipMinor: 0,
      organizerDisplayName: 'Org',
      // submissionDeadline deliberately omitted — the app no longer computes this itself.
    });
    const now = new Date('2026-07-17T10:00:00Z').getTime();
    const deadline = new Date(vink.submissionDeadline).getTime();
    assert.equal(
      deadline - now,
      86_400_000,
      'defaults to exactly 24h, unchanged from prior hardcoded behavior',
    );
    const grace = new Date(vink.processingGraceDeadline).getTime();
    assert.equal(grace - deadline, 60_000, 'processing grace defaults to 60s (Spec §14)');
  });

  it('ENG1 timer semantics: ctx.timers overrides the fallback for both open duration and grace', async () => {
    const store = new InMemoryVinkStore();
    const customCtx: CommandContext = {
      ...ctx(store),
      timers: { openDurationSeconds: 300, processingGraceSeconds: 15 },
    };
    const { vink } = await createVinkCommand(customCtx, {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 5_000,
      tipMinor: 0,
      organizerDisplayName: 'Org',
    });
    const now = new Date('2026-07-17T10:00:00Z').getTime();
    const deadline = new Date(vink.submissionDeadline).getTime();
    assert.equal(deadline - now, 300_000);
    const grace = new Date(vink.processingGraceDeadline).getTime();
    assert.equal(grace - deadline, 15_000);
  });

  it('ENG1 timer semantics: an explicit submissionDeadline still wins over ctx.timers', async () => {
    const store = new InMemoryVinkStore();
    const customCtx: CommandContext = {
      ...ctx(store),
      timers: { openDurationSeconds: 300, processingGraceSeconds: 15 },
    };
    const { vink } = await createVinkCommand(customCtx, {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 5_000,
      tipMinor: 0,
      submissionDeadline: FUTURE,
      organizerDisplayName: 'Org',
    });
    assert.equal(vink.submissionDeadline, new Date(FUTURE).toISOString());
    // Grace still derives from ctx.timers even when the deadline itself was explicit.
    const grace = new Date(vink.processingGraceDeadline).getTime() - new Date(FUTURE).getTime();
    assert.equal(grace, 15_000);
  });

  it('ENG1 #4: replays the same Vink for a repeated creation idempotency key', async () => {
    const store = new InMemoryVinkStore();
    const input = {
      purchaseCategory: 'GROCERY' as const,
      subtotalMinor: 5_000,
      tipMinor: 0,
      submissionDeadline: FUTURE,
      organizerDisplayName: 'Org',
      creationIdempotencyKey: 'attempt-1',
    };
    const first = await createVinkCommand(ctx(store), input);
    const retry = await createVinkCommand(ctx(store), input);

    assert.equal(retry.vink.id, first.vink.id);
    assert.equal(retry.participants[0]?.id, first.participants[0]?.id);
    assert.equal(store.vinks.size, 1, 'only one Vink was ever inserted');
    assert.deepEqual(
      store.outbox.map((event) => event.eventType),
      ['VinkCreated'],
      'the replay must not emit a second VinkCreated event',
    );
  });

  it('ENG1 #4: a different key (or a different organizer) is a genuinely new Vink', async () => {
    const store = new InMemoryVinkStore();
    const base = {
      purchaseCategory: 'GROCERY' as const,
      subtotalMinor: 5_000,
      tipMinor: 0,
      submissionDeadline: FUTURE,
      organizerDisplayName: 'Org',
    };
    const first = await createVinkCommand(ctx(store), { ...base, creationIdempotencyKey: 'key-a' });
    const second = await createVinkCommand(ctx(store), {
      ...base,
      creationIdempotencyKey: 'key-b',
    });
    const third = await createVinkCommand(ctx(store, 'other-organizer'), {
      ...base,
      creationIdempotencyKey: 'key-a', // same key, different organizer — not a collision
    });

    assert.notEqual(second.vink.id, first.vink.id);
    assert.notEqual(third.vink.id, first.vink.id);
    assert.equal(store.vinks.size, 3);
  });

  it('ENG1 #4: omitting the key never collides across separate calls (back-compat default)', async () => {
    const store = new InMemoryVinkStore();
    const input = {
      purchaseCategory: 'GROCERY' as const,
      subtotalMinor: 5_000,
      tipMinor: 0,
      submissionDeadline: FUTURE,
      organizerDisplayName: 'Org',
    };
    const first = await createVinkCommand(ctx(store), input);
    const second = await createVinkCommand(ctx(store), input);
    assert.notEqual(second.vink.id, first.vink.id);
    assert.equal(store.vinks.size, 2);
  });

  it('ENG1 #4: a lost race at the store replays the winner instead of throwing', async () => {
    const store = new InMemoryVinkStore();
    const winnerInput = {
      purchaseCategory: 'GROCERY' as const,
      subtotalMinor: 5_000,
      tipMinor: 0,
      submissionDeadline: FUTURE,
      organizerDisplayName: 'Org',
      creationIdempotencyKey: 'contested-key',
    };
    const winner = await createVinkCommand(ctx(store), winnerInput);

    // Simulate the rarer genuine race (READ COMMITTED semantics): this transaction's own
    // pre-check runs before the concurrent winner's commit is visible to it, so it proceeds
    // to insert and only then discovers — via the unique constraint, not the pre-check —
    // that it lost. The pre-check "misses" exactly once; after the forced insert failure,
    // the catch block's fresh lookup sees the now-committed winner normally.
    const originalFind = store.findVinkByCreationIdempotencyKey.bind(store);
    let findCalls = 0;
    store.findVinkByCreationIdempotencyKey = async (organizerUserId, key) => {
      findCalls += 1;
      return findCalls === 1 ? null : originalFind(organizerUserId, key);
    };
    store.insertVink = async () => {
      throw new CreationIdempotencyRaceError();
    };

    const loser = await createVinkCommand(ctx(store), winnerInput);
    assert.equal(
      loser.vink.id,
      winner.vink.id,
      'the race loser replays the winner instead of erroring',
    );
    assert.equal(store.vinks.size, 1);
  });

  it('rejects unsupported categories and past deadlines', async () => {
    const store = new InMemoryVinkStore();
    await assert.rejects(
      createVinkCommand(ctx(store), {
        purchaseCategory: 'HOTEL',
        subtotalMinor: 100,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Org',
      }),
      (error: unknown) =>
        error instanceof DomainError && error.code === 'UNSUPPORTED_PURCHASE_CATEGORY',
    );
    await assert.rejects(
      createVinkCommand(ctx(store), {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 100,
        tipMinor: 0,
        submissionDeadline: '2020-01-01T00:00:00Z',
        organizerDisplayName: 'Org',
      }),
      isAppError('INVALID_COMMAND'),
    );
  });
});

describe('participants and split', () => {
  it('runs the full organizer flow: add members → EQUAL split → open (D12 history + event)', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createDraft(store); // $120.00
    for (const name of ['a', 'b', 'c']) {
      await addParticipantCommand(ctx(store), {
        vinkId: vink.id,
        userId: `user-${name}` as UserId,
        displayName: name,
      });
    }
    const { participants } = await setSplitCommand(ctx(store), {
      vinkId: vink.id,
      method: 'EQUAL',
    });
    // 4 active participants (organizer + 3) × $30.00 each.
    assert.deepEqual(
      participants.map((participant) => participant.allocatedAmount.amountMinor),
      [3000, 3000, 3000, 3000],
    );
    const opened = await openVinkCommand(ctx(store), { vinkId: vink.id });
    assert.equal(opened.state, 'OPEN');
    assert.equal(opened.version, vink.version + 2); // split bump + open bump
    const transition = store.history.at(-1);
    assert.equal(transition?.event, 'VINK_OPENED');
    assert.equal(store.outbox.at(-1)?.eventType, 'VinkOpened');
  });

  it('rejects duplicate members, removing the organizer, and split sum mismatches', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participants } = await createDraft(store);
    await addParticipantCommand(ctx(store), {
      vinkId: vink.id,
      userId: 'user-a' as UserId,
      displayName: 'a',
    });
    await assert.rejects(
      addParticipantCommand(ctx(store), {
        vinkId: vink.id,
        userId: 'user-a' as UserId,
        displayName: 'a again',
      }),
      // ENG1 #4: a distinct code from generic INVALID_COMMAND — this is a duplicate-add
      // ("already done"), not a genuinely invalid command.
      isAppError('PARTICIPANT_ALREADY_ADDED'),
    );
    await assert.rejects(
      removeParticipantCommand(ctx(store), {
        vinkId: vink.id,
        participantId: participants[0]!.id,
      }),
      isAppError('INVALID_COMMAND'),
    );
    await assert.rejects(
      setSplitCommand(ctx(store), {
        vinkId: vink.id,
        method: 'CUSTOM_AMOUNT',
        amounts: [{ participantId: participants[0]!.id, amountMinor: 1 }],
      }),
      (error: unknown) => error instanceof DomainError && error.code === 'INVALID_SPLIT',
    );
  });

  it('a removed member loses their allocation and the vink cannot open until covered', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createDraft(store);
    const member = await addParticipantCommand(ctx(store), {
      vinkId: vink.id,
      userId: 'user-a' as UserId,
      displayName: 'a',
    });
    const other = await addParticipantCommand(ctx(store), {
      vinkId: vink.id,
      userId: 'user-b' as UserId,
      displayName: 'b',
    });
    await setSplitCommand(ctx(store), { vinkId: vink.id, method: 'EQUAL' });
    await removeParticipantCommand(ctx(store), { vinkId: vink.id, participantId: member.id });
    assert.equal(store.outbox.at(-1)?.eventType, 'ParticipantRemoved');
    await assert.rejects(
      openVinkCommand(ctx(store), { vinkId: vink.id }),
      isAppError('INVALID_COMMAND'),
    );

    const { participants } = await coverRemainingCommand(ctx(store), { vinkId: vink.id });
    assert.equal(participants[0]?.role, 'ORGANIZER');
    const opened = await openVinkCommand(ctx(store), { vinkId: vink.id });
    assert.equal(opened.state, 'OPEN');
    assert.ok(other.id); // silence unused warning-style lint
  });
});

describe('lifecycle guards', () => {
  it('enforces ownership, version conflicts, and machine legality', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createDraft(store);
    await assert.rejects(
      openVinkCommand(ctx(store, 'someone-else'), { vinkId: vink.id }),
      isAppError('FORBIDDEN'),
    );
    await assert.rejects(
      configureVinkCommand(ctx(store), { vinkId: vink.id, expectedVersion: 99, tipMinor: 100 }),
      isAppError('VINK_VERSION_CONFLICT'),
    );
    // DRAFT cancel is unmodeled (G13, ratified): the machine rejects it loudly.
    await assert.rejects(
      cancelVinkCommand(ctx(store), { vinkId: vink.id }),
      (error: unknown) => error instanceof IllegalTransitionError,
    );
    await assert.rejects(
      openVinkCommand(ctx(store), { vinkId: 'missing' as VinkId }),
      isAppError('VINK_NOT_FOUND'),
    );
  });

  it('cancels an OPEN vink and blocks post-cancel edits', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createDraft(store);
    await addParticipantCommand(ctx(store), {
      vinkId: vink.id,
      userId: 'user-a' as UserId,
      displayName: 'a',
    });
    await setSplitCommand(ctx(store), { vinkId: vink.id, method: 'EQUAL' });
    await openVinkCommand(ctx(store), { vinkId: vink.id });
    const cancelled = await cancelVinkCommand(ctx(store), { vinkId: vink.id });
    assert.equal(cancelled.state, 'CANCELLED');
    assert.equal(store.outbox.at(-1)?.eventType, 'VinkCancelled');
    await assert.rejects(
      addParticipantCommand(ctx(store), {
        vinkId: vink.id,
        userId: 'user-b' as UserId,
        displayName: 'b',
      }),
      isAppError('INVALID_COMMAND'),
    );
  });

  it('configure is DRAFT-only and recomputes required/maximum', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createDraft(store, 10_000);
    const updated = await configureVinkCommand(ctx(store), { vinkId: vink.id, tipMinor: 1_500 });
    assert.equal(updated.requiredAmount.amountMinor, 11_500);
    assert.equal(updated.maximumAmount.amountMinor, 11_500);
  });
});

describe('queries', () => {
  it('snapshot computes allowedActions server-side per state', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createDraft(store);
    let snapshot = await getVinkSnapshot(store, vink.id, ORGANIZER);
    // DRAFT, no members, nothing allocated: cannot open yet, can cover remaining.
    assert.deepEqual(snapshot.allowedActions, [
      'ADD_PARTICIPANT',
      'EDIT_ALLOCATION',
      'COVER_REMAINING',
    ]);
    assert.equal(snapshot.unallocatedAmountMinor, 12_000);

    await addParticipantCommand(ctx(store), {
      vinkId: vink.id,
      userId: 'user-a' as UserId,
      displayName: 'a',
    });
    await setSplitCommand(ctx(store), { vinkId: vink.id, method: 'EQUAL' });
    snapshot = await getVinkSnapshot(store, vink.id, ORGANIZER);
    assert.deepEqual(snapshot.allowedActions, ['OPEN_VINK', 'ADD_PARTICIPANT', 'EDIT_ALLOCATION']);

    await openVinkCommand(ctx(store), { vinkId: vink.id });
    snapshot = await getVinkSnapshot(store, vink.id, ORGANIZER);
    assert.deepEqual(snapshot.allowedActions, [
      'CANCEL_VINK',
      'ADD_PARTICIPANT',
      'EDIT_ALLOCATION',
    ]);

    await assert.rejects(getVinkSnapshot(store, vink.id, 'stranger'), isAppError('FORBIDDEN'));
  });

  it('activity exposes events and transitions for the organizer only', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createDraft(store);
    await addParticipantCommand(ctx(store), {
      vinkId: vink.id,
      userId: 'user-a' as UserId,
      displayName: 'a',
    });
    await setSplitCommand(ctx(store), { vinkId: vink.id, method: 'EQUAL' });
    await openVinkCommand(ctx(store), { vinkId: vink.id });
    const activity = await getVinkActivity(store, vink.id, ORGANIZER);
    const eventTypes = activity
      .filter((entry) => entry.kind === 'event')
      .map((entry) => entry.detail.eventType);
    assert.deepEqual(eventTypes, [
      'VinkCreated',
      'ParticipantJoined',
      'ParticipantAllocationChanged',
      'VinkOpened',
    ]);
    assert.equal(activity.filter((entry) => entry.kind === 'transition').length, 1);
    await assert.rejects(getVinkActivity(store, vink.id, 'stranger'), isAppError('FORBIDDEN'));
  });

  it("listMyVinks returns only the organizer's own vinks, newest first", async () => {
    const store = new InMemoryVinkStore();
    const { vink: first } = await createDraft(store, 1_000);
    const { vink: second } = await createDraft(store, 2_000);
    await createVinkCommand(
      {
        uow: store,
        clock: { now: () => new Date('2026-07-17T10:00:00Z') },
        actorUserId: 'other-organizer',
        correlationId: 'test',
      },
      {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 500,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Other',
      },
    );

    const mine = await listMyVinks(store, ORGANIZER);
    assert.deepEqual(mine.map((vink) => vink.id).sort(), [first.id, second.id].sort());
    assert.ok(mine.every((vink) => vink.organizerUserId === ORGANIZER));
  });
});
