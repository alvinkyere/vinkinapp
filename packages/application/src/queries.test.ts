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
  removeParticipantCommand,
  setSplitCommand,
} from './commands.ts';
import { authorizeContributionCommand, type ContributionCommandContext } from './contributions.ts';
import { getVinkSnapshot, listMyVinks, listMyVinksWithRole } from './queries.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-18T10:00:00Z');
const DEADLINE = '2026-07-18T12:00:00Z';

function organizerCtx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

/** Three-participant fixture: organizer allocated 4000, memberA 4000, memberB 4000 —
 * exercises "organizer included where organizer is a participant" directly. */
async function fixture(): Promise<{
  store: InMemoryVinkStore;
  ctx: ContributionCommandContext;
  vinkId: VinkId;
  organizerParticipantId: string;
  memberAId: string;
  memberBId: string;
}> {
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
      { participantId: participants[0]!.id, amountMinor: 4_000 },
      { participantId: a.id, amountMinor: 4_000 },
      { participantId: b.id, amountMinor: 4_000 },
    ],
  });
  await openVinkCommand(organizerCtx(store), { vinkId: vink.id });
  return {
    store,
    ctx: { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider },
    vinkId: vink.id,
    organizerParticipantId: participants[0]!.id,
    memberAId: a.id,
    memberBId: b.id,
  };
}

describe('contributionProgress (D20/D24, Slice I1)', () => {
  it('zero progress before anyone authorizes', async () => {
    const f = await fixture();
    const snapshot = await getVinkSnapshot(f.store, f.vinkId, ORGANIZER);
    assert.deepEqual(snapshot.contributionProgress, {
      confirmedAmountMinor: 0,
      totalAmountMinor: 12_000,
      confirmedParticipantCount: 0,
      totalParticipantCount: 3,
    });
    // The regression this whole slice exists to fix: fundedAmountMinor stays 0 throughout —
    // contributionProgress is a wholly separate, incremental signal.
    assert.equal(snapshot.vink.fundedAmount.amountMinor, 0);
  });

  it(
    'partial progress after one of three confirms — the exact regression fundedAmountMinor ' +
      'cannot represent (fundedAmountMinor stays 0 while contributionProgress moves)',
    async () => {
      const f = await fixture();
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: 'user-a' },
      });
      const snapshot = await getVinkSnapshot(f.store, f.vinkId, ORGANIZER);
      assert.deepEqual(snapshot.contributionProgress, {
        confirmedAmountMinor: 4_000,
        totalAmountMinor: 12_000,
        confirmedParticipantCount: 1,
        totalParticipantCount: 3,
      });
      // The exact proof the instruction asked for: fundedAmount is still 0 (unchanged,
      // all-at-once-at-full-resolution, per its own domain meaning) while
      // contributionProgress.confirmedAmountMinor is already partially complete.
      assert.equal(snapshot.vink.fundedAmount.amountMinor, 0);
      assert.equal(snapshot.vink.state, 'OPEN');
    },
  );

  it('full progress once every participant, including the organizer, confirms (organizer-as-participant)', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: ORGANIZER },
    });
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: 'user-a' },
    });
    const funded = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: 'user-b' },
    });
    assert.equal(funded.vinkState, 'FUNDED');

    const snapshot = await getVinkSnapshot(f.store, f.vinkId, ORGANIZER);
    assert.deepEqual(snapshot.contributionProgress, {
      confirmedAmountMinor: 12_000,
      totalAmountMinor: 12_000,
      confirmedParticipantCount: 3,
      totalParticipantCount: 3,
    });
    // Now that the D5 resolver has actually run, fundedAmountMinor also reflects the total —
    // the two fields agree at full resolution, as expected; they just don't agree before it.
    assert.equal(snapshot.vink.fundedAmount.amountMinor, 12_000);
  });

  it('a processing (not yet resolved) contribution is excluded from confirmedAmountMinor', async () => {
    const f = await fixture();
    const delayed = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: 'user-a' },
      scenario: 'DELAYED',
    });
    assert.equal(delayed.contribution.status, 'AUTHORIZATION_PENDING');

    const snapshot = await getVinkSnapshot(f.store, f.vinkId, ORGANIZER);
    assert.equal(snapshot.contributionProgress.confirmedAmountMinor, 0);
    assert.equal(snapshot.contributionProgress.confirmedParticipantCount, 0);
  });

  it('a declined contribution is excluded from confirmedAmountMinor', async () => {
    const f = await fixture();
    const declined = await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: 'user-a' },
      scenario: 'DECLINE',
    });
    assert.equal(declined.contribution.status, 'DECLINED');

    const snapshot = await getVinkSnapshot(f.store, f.vinkId, ORGANIZER);
    assert.equal(snapshot.contributionProgress.confirmedAmountMinor, 0);
    assert.equal(snapshot.contributionProgress.confirmedParticipantCount, 0);
  });

  it('a subsequent successful attempt after a decline is counted — the retry, not the decline', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: 'user-a' },
      scenario: 'DECLINE',
    });
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: 'user-a' },
    });
    const snapshot = await getVinkSnapshot(f.store, f.vinkId, ORGANIZER);
    assert.equal(snapshot.contributionProgress.confirmedAmountMinor, 4_000);
    assert.equal(snapshot.contributionProgress.confirmedParticipantCount, 1);
  });

  it('Equal split: confirmedAmountMinor sums the equal per-participant share exactly', async () => {
    const store = new InMemoryVinkStore();
    const provider = new MockFinancialProvider({ now: () => NOW });
    const { vink, participants } = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 10_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const a = await addParticipantCommand(organizerCtx(store), {
      vinkId: vink.id,
      userId: 'user-a' as UserId,
      displayName: 'a',
    });
    await addParticipantCommand(organizerCtx(store), {
      vinkId: vink.id,
      userId: 'user-b' as UserId,
      displayName: 'b',
    });
    await setSplitCommand(organizerCtx(store), { vinkId: vink.id, method: 'EQUAL' });
    await openVinkCommand(organizerCtx(store), { vinkId: vink.id });
    const ctx = { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider };

    await authorizeContributionCommand(ctx, {
      vinkId: vink.id,
      requester: { kind: 'user', userId: 'user-a' },
    });
    const snapshot = await getVinkSnapshot(store, vink.id, ORGANIZER);
    // 10_000 / 3 participants, largest-remainder — assert against participant a's actual
    // allocated share (whatever the split engine computed), not a hand-assumed round number,
    // proving exact integer-minor-unit accuracy rather than an approximation.
    void participants;
    const allocated = (await store.listParticipants(vink.id)).find((p) => p.id === a.id)!
      .allocatedAmount.amountMinor;
    assert.equal(snapshot.contributionProgress.confirmedAmountMinor, allocated);
    assert.ok(Number.isInteger(snapshot.contributionProgress.confirmedAmountMinor));
  });

  it('multiple confirmed contributions accumulate correctly across three participants', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: ORGANIZER },
    });
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: 'user-a' },
    });
    const snapshot = await getVinkSnapshot(f.store, f.vinkId, ORGANIZER);
    assert.equal(snapshot.contributionProgress.confirmedAmountMinor, 8_000);
    assert.equal(snapshot.contributionProgress.confirmedParticipantCount, 2);
    assert.equal(snapshot.contributionProgress.totalParticipantCount, 3);
  });
});

describe('listMyVinksWithRole — participant-inclusive retrieval (Phase 3 §1, Slice I2)', () => {
  const MEMBER = 'member-user' as UserId;

  async function twoVinkFixture(): Promise<{
    store: InMemoryVinkStore;
    ownVinkId: VinkId;
    memberVinkId: VinkId;
  }> {
    const store = new InMemoryVinkStore();
    // Vink 1: this user is the organizer.
    const own = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 5_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    // Vink 2: a DIFFERENT organizer creates it and adds our user as a member.
    const otherOrganizerCtx: CommandContext = {
      uow: store,
      clock: { now: () => NOW },
      actorUserId: 'other-organizer',
      correlationId: 'test',
    };
    const other = await createVinkCommand(otherOrganizerCtx, {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 8_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Other Org',
    });
    await addParticipantCommand(otherOrganizerCtx, {
      vinkId: other.vink.id,
      userId: MEMBER,
      displayName: 'Member',
    });
    return { store, ownVinkId: own.vink.id, memberVinkId: other.vink.id };
  }

  it(
    'a member added by username, with no link, appears via their own role-annotated list — ' +
      'the exact real gap this slice fixes (P1-3): listMyVinks alone gives them nothing',
    async () => {
      const f = await twoVinkFixture();
      const memberView = await listMyVinksWithRole(f.store, MEMBER);
      assert.equal(memberView.length, 1);
      assert.equal(memberView[0]!.vink.id, f.memberVinkId);
      assert.equal(memberView[0]!.role, 'participant');

      // The exact regression this fixes: today's listMyVinks gives this same user nothing.
      const legacyView = await listMyVinks(f.store, MEMBER);
      assert.deepEqual(legacyView, []);
    },
  );

  it('the organizer sees their own Vink with role "organizer", exactly once (dedup)', async () => {
    const f = await twoVinkFixture();
    const view = await listMyVinksWithRole(f.store, ORGANIZER);
    assert.equal(view.length, 1);
    assert.equal(view[0]!.vink.id, f.ownVinkId);
    assert.equal(view[0]!.role, 'organizer');
  });

  it(
    'organizer role always wins when the same user is both organizer and (somehow) also ' +
      'participant-matched for the same Vink — never double-counted, never demoted to ' +
      '"participant"',
    async () => {
      const store = new InMemoryVinkStore();
      const created = await createVinkCommand(organizerCtx(store), {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 5_000,
        tipMinor: 0,
        submissionDeadline: DEADLINE,
        organizerDisplayName: 'Org',
      });
      // The organizer's own auto-created participant row already has userId === ORGANIZER
      // (Phase 0 §3) — listVinksByParticipant(ORGANIZER) and listVinksByOrganizer(ORGANIZER)
      // both legitimately return this same Vink; the union must not produce two entries.
      const view = await listMyVinksWithRole(store, ORGANIZER);
      const matching = view.filter((entry) => entry.vink.id === created.vink.id);
      assert.equal(matching.length, 1);
      assert.equal(matching[0]!.role, 'organizer');
    },
  );

  it('a user with no organized and no participated Vinks gets an empty list, not an error', async () => {
    const store = new InMemoryVinkStore();
    const view = await listMyVinksWithRole(store, 'nobody-here' as UserId);
    assert.deepEqual(view, []);
  });

  it('newest first across the combined organizer+participant union', async () => {
    const store = new InMemoryVinkStore();
    const older = await createVinkCommand(
      {
        uow: store,
        clock: { now: () => new Date('2026-07-17T10:00:00Z') },
        actorUserId: ORGANIZER,
        correlationId: 'test',
      },
      {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 1_000,
        tipMinor: 0,
        submissionDeadline: DEADLINE,
        organizerDisplayName: 'Org',
      },
    );
    const otherOrganizerCtx: CommandContext = {
      uow: store,
      clock: { now: () => new Date('2026-07-19T10:00:00Z') },
      actorUserId: 'other-organizer',
      correlationId: 'test',
    };
    const newer = await createVinkCommand(otherOrganizerCtx, {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 2_000,
      tipMinor: 0,
      submissionDeadline: '2026-07-19T12:00:00Z',
      organizerDisplayName: 'Other Org',
    });
    await addParticipantCommand(otherOrganizerCtx, {
      vinkId: newer.vink.id,
      userId: ORGANIZER,
      displayName: 'Org as a guest member elsewhere',
    });
    const view = await listMyVinksWithRole(store, ORGANIZER);
    assert.deepEqual(
      view.map((entry) => entry.vink.id),
      [newer.vink.id, older.vink.id],
    );
  });

  it('a removed participant no longer appears in the participant-inclusive list', async () => {
    const store = new InMemoryVinkStore();
    const otherOrganizerCtx: CommandContext = {
      uow: store,
      clock: { now: () => NOW },
      actorUserId: 'other-organizer',
      correlationId: 'test',
    };
    const vink = await createVinkCommand(otherOrganizerCtx, {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 5_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Other Org',
    });
    const member = await addParticipantCommand(otherOrganizerCtx, {
      vinkId: vink.vink.id,
      userId: MEMBER,
      displayName: 'Member',
    });
    await removeParticipantCommand(otherOrganizerCtx, {
      vinkId: vink.vink.id,
      participantId: member.id,
    });
    const view = await listMyVinksWithRole(store, MEMBER);
    assert.deepEqual(view, []);
  });
});
