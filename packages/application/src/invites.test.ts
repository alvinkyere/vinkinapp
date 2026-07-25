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
  unallocatedAmount,
} from './commands.ts';
import { authorizeContributionCommand } from './contributions.ts';
import { acceptInviteCommand, declineInviteCommand, listMyPendingInvites } from './invites.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-23T10:00:00Z');
const FUTURE = new Date('2026-08-01T12:00:00Z').toISOString();

function ctx(store: InMemoryVinkStore, actorUserId: string, invitesEnabled = true): CommandContext {
  return {
    uow: store,
    clock: { now: () => NOW },
    actorUserId,
    correlationId: 'test',
    invitesEnabled,
  };
}

const isAppError = (code: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === code;

async function inviteFixture() {
  const store = new InMemoryVinkStore();
  const { vink } = await createVinkCommand(ctx(store, ORGANIZER, false), {
    purchaseCategory: 'GROCERY',
    subtotalMinor: 12_000,
    tipMinor: 0,
    submissionDeadline: FUTURE,
    organizerDisplayName: 'Org',
  });
  const invitee = await addParticipantCommand(ctx(store, ORGANIZER), {
    vinkId: vink.id,
    userId: 'user-a' as UserId,
    displayName: 'a',
  });
  await setSplitCommand(ctx(store, ORGANIZER), { vinkId: vink.id, method: 'EQUAL' });
  return { store, vinkId: vink.id as VinkId, invitee };
}

describe('acceptInviteCommand (Invites feature, D44)', () => {
  it('INVITED -> JOINED, joinedAt set, ParticipantInviteAccepted emitted', async () => {
    const { store, vinkId } = await inviteFixture();
    const accepted = await acceptInviteCommand(ctx(store, 'user-a'), { vinkId });
    assert.equal(accepted.status, 'JOINED');
    assert.equal(accepted.joinedAt, NOW.toISOString());
    assert.equal(store.outbox.at(-1)?.eventType, 'ParticipantInviteAccepted');
  });

  it('an accepted invitee can now authorize their own contribution — findOwnParticipant no longer FORBIDDEN', async () => {
    const { store, vinkId } = await inviteFixture();
    await acceptInviteCommand(ctx(store, 'user-a'), { vinkId });
    await openVinkCommand(ctx(store, ORGANIZER), { vinkId });
    const provider = new MockFinancialProvider({ now: () => NOW });
    const result = await authorizeContributionCommand(
      { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider },
      { vinkId, requester: { kind: 'user', userId: 'user-a' } },
    );
    assert.equal(result.contribution.status, 'AUTHORIZED');
  });

  it('rejects a wrong actor (not the invitee) with FORBIDDEN', async () => {
    const { store, vinkId } = await inviteFixture();
    await assert.rejects(
      acceptInviteCommand(ctx(store, ORGANIZER), { vinkId }),
      isAppError('FORBIDDEN'),
    );
    await assert.rejects(
      acceptInviteCommand(ctx(store, 'someone-else'), { vinkId }),
      isAppError('FORBIDDEN'),
    );
  });

  it('double-accept rejects with INVITE_ALREADY_RESOLVED', async () => {
    const { store, vinkId } = await inviteFixture();
    await acceptInviteCommand(ctx(store, 'user-a'), { vinkId });
    await assert.rejects(
      acceptInviteCommand(ctx(store, 'user-a'), { vinkId }),
      isAppError('INVITE_ALREADY_RESOLVED'),
    );
  });

  it('rejects outside DRAFT/OPEN — e.g. a CANCELLED vink', async () => {
    const { store, vinkId } = await inviteFixture();
    const vink = await store.getVink(vinkId);
    assert.ok(vink);
    await store.updateVink({ ...vink!, state: 'CANCELLED' });
    await assert.rejects(
      acceptInviteCommand(ctx(store, 'user-a'), { vinkId }),
      isAppError('INVALID_COMMAND'),
    );
  });
});

describe('declineInviteCommand (Invites feature, D44)', () => {
  it('INVITED -> REMOVED, allocation zeroed, ParticipantInviteDeclined emitted', async () => {
    const { store, vinkId, invitee } = await inviteFixture();
    const declined = await declineInviteCommand(ctx(store, 'user-a'), { vinkId });
    assert.equal(declined.status, 'REMOVED');
    assert.equal(declined.allocatedAmount.amountMinor, 0);
    assert.equal(declined.joinedAt, null);
    assert.equal(store.outbox.at(-1)?.eventType, 'ParticipantInviteDeclined');
    assert.ok(invitee.id);
  });

  it('a decline reopens unallocatedAmount — the organizer must re-cover, exactly like a removal', async () => {
    const { store, vinkId } = await inviteFixture();
    await declineInviteCommand(ctx(store, 'user-a'), { vinkId });
    const vink = await store.getVink(vinkId);
    const participants = await store.listParticipants(vinkId);
    assert.ok(vink);
    assert.ok(unallocatedAmount(vink!, participants).amountMinor > 0);
    await assert.rejects(
      openVinkCommand(ctx(store, ORGANIZER), { vinkId }),
      isAppError('INVALID_COMMAND'),
    );
  });

  it('rejects a wrong actor with FORBIDDEN', async () => {
    const { store, vinkId } = await inviteFixture();
    await assert.rejects(
      declineInviteCommand(ctx(store, ORGANIZER), { vinkId }),
      isAppError('FORBIDDEN'),
    );
  });

  it('double-decline rejects with INVITE_ALREADY_RESOLVED', async () => {
    const { store, vinkId } = await inviteFixture();
    await declineInviteCommand(ctx(store, 'user-a'), { vinkId });
    await assert.rejects(
      declineInviteCommand(ctx(store, 'user-a'), { vinkId }),
      isAppError('INVITE_ALREADY_RESOLVED'),
    );
  });

  it('is blocked once a live contribution exists on the vink — same lock removeParticipantCommand already enforces', async () => {
    const { store, vinkId } = await inviteFixture();
    // A second, already-JOINED member (added before the flag was on for this fixture's
    // organizer ctx) pays their own share — the vink-wide lock should now block the decline.
    const secondCtx = ctx(store, ORGANIZER, false);
    const b = await addParticipantCommand(secondCtx, {
      vinkId,
      userId: 'user-b' as UserId,
      displayName: 'b',
    });
    await setSplitCommand(ctx(store, ORGANIZER), {
      vinkId,
      method: 'CUSTOM_AMOUNT',
      amounts: [
        {
          participantId: (await store.listParticipants(vinkId)).find((p) => p.role === 'ORGANIZER')!
            .id,
          amountMinor: 0,
        },
        {
          participantId: (await store.listParticipants(vinkId)).find((p) => p.userId === 'user-a')!
            .id,
          amountMinor: 6_000,
        },
        { participantId: b.id, amountMinor: 6_000 },
      ],
    });
    await openVinkCommand(ctx(store, ORGANIZER), { vinkId });
    const provider = new MockFinancialProvider({ now: () => NOW });
    await authorizeContributionCommand(
      { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider },
      { vinkId, requester: { kind: 'user', userId: 'user-b' } },
    );
    await assert.rejects(
      declineInviteCommand(ctx(store, 'user-a'), { vinkId }),
      isAppError('INVALID_COMMAND'),
    );
  });
});

describe('listMyPendingInvites', () => {
  it("lists a pending invite with organizer identity and the invitee's own share", async () => {
    const { store, vinkId } = await inviteFixture();
    const invites = await listMyPendingInvites(store, 'user-a');
    assert.equal(invites.length, 1);
    assert.equal(invites[0]?.vinkId, vinkId);
    assert.equal(invites[0]?.organizerDisplayName, 'Org');
    assert.equal(invites[0]?.assignedShareMinor, 6000);
  });

  it('an accepted invite no longer appears in pending invites', async () => {
    const { store, vinkId } = await inviteFixture();
    await acceptInviteCommand(ctx(store, 'user-a'), { vinkId });
    const invites = await listMyPendingInvites(store, 'user-a');
    assert.equal(invites.length, 0);
  });

  it('a user with no pending invites gets an empty list', async () => {
    const store = new InMemoryVinkStore();
    const invites = await listMyPendingInvites(store, 'nobody');
    assert.deepEqual(invites, []);
  });
});
