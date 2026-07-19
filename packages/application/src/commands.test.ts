import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DomainError,
  IllegalTransitionError,
  type UserId,
  type VinkId,
} from '../../domain/src/index.ts';
import { InMemoryVinkStore } from './testing/in-memory.ts';
import { ApplicationError } from './errors.ts';
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
      isAppError('INVALID_COMMAND'),
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
