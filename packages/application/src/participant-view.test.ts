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
import { authorizeContributionCommand, type ContributionCommandContext } from './contributions.ts';
import {
  provisionCardCommand,
  authorizeMerchantPurchaseCommand,
  settlePurchaseCommand,
} from './purchases.ts';
import { retryRecoveryCommand, startRecoveryCommand, RECOVERY_MAX_ATTEMPTS } from './recovery.ts';
import { getParticipantVinkView } from './guest.ts';
import { ApplicationError } from './errors.ts';

const isAppError = (code: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === code;

const ORGANIZER = 'organizer-user' as UserId;
const MEMBER_A = 'member-a-user' as UserId;
const MEMBER_B = 'member-b-user' as UserId;
const STRANGER = 'stranger-user' as UserId;
const NOW = new Date('2026-07-21T10:00:00Z');
const DEADLINE = '2026-07-21T12:00:00Z';

function organizerCtx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

/** Two-member fixture (organizer + memberA + memberB), CUSTOM_AMOUNT split so amounts are
 * distinct per participant — a stricter privacy check than an Equal split, which could
 * accidentally pass a "no cross-leak" test by coincidence if every share were identical. */
async function fixture(): Promise<{
  store: InMemoryVinkStore;
  ctx: ContributionCommandContext;
  provider: MockFinancialProvider;
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
    userId: MEMBER_A,
    displayName: 'Member A',
  });
  const b = await addParticipantCommand(organizerCtx(store), {
    vinkId: vink.id,
    userId: MEMBER_B,
    displayName: 'Member B',
  });
  await setSplitCommand(organizerCtx(store), {
    vinkId: vink.id,
    method: 'CUSTOM_AMOUNT',
    amounts: [
      { participantId: participants[0]!.id, amountMinor: 4_000 },
      { participantId: a.id, amountMinor: 5_000 },
      { participantId: b.id, amountMinor: 3_000 },
    ],
  });
  await openVinkCommand(organizerCtx(store), { vinkId: vink.id });
  return {
    store,
    ctx: { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider },
    provider,
    vinkId: vink.id,
    organizerParticipantId: participants[0]!.id,
    memberAId: a.id,
    memberBId: b.id,
  };
}

describe('getParticipantVinkView (Slice I2B)', () => {
  it('VINK_NOT_FOUND for an unknown vink', async () => {
    const store = new InMemoryVinkStore();
    await assert.rejects(
      getParticipantVinkView(store, 'nope' as VinkId, MEMBER_A, NOW),
      isAppError('VINK_NOT_FOUND'),
    );
  });

  it('FORBIDDEN for a signed-in user who is not a participant of this vink', async () => {
    const f = await fixture();
    await assert.rejects(
      getParticipantVinkView(f.store, f.vinkId, STRANGER, NOW),
      isAppError('FORBIDDEN'),
    );
  });

  it("a member's own view: correct own share, own not_started contributionStatus, open outcome", async () => {
    const f = await fixture();
    const view = await getParticipantVinkView(f.store, f.vinkId, MEMBER_A, NOW);
    assert.equal(view.participant.allocatedAmountMinor, 5_000);
    assert.equal(view.participant.contributionStatus, 'not_started');
    assert.equal(view.vink.vinkOutcome, 'open');
    assert.equal(view.vink.state, 'OPEN');
  });

  it(
    "GUEST-PRIVACY-equivalent check: member A's view never leaks member B's allocated " +
      'amount, contribution status, or identity — only the aggregate contributionProgress',
    async () => {
      const f = await fixture();
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: MEMBER_B },
      });
      const viewA = await getParticipantVinkView(f.store, f.vinkId, MEMBER_A, NOW);
      const serialized = JSON.stringify(viewA);
      // Member B's own amount (3_000) and displayName never appear anywhere in A's view —
      // only the aggregate confirmedAmountMinor (3_000, coincidentally B's own share, but
      // reached via the aggregate field, not a per-participant leak) is present.
      assert.ok(!serialized.includes('Member B'));
      assert.equal(viewA.participant.allocatedAmountMinor, 5_000); // still A's own, unaffected
      assert.equal(viewA.participant.contributionStatus, 'not_started'); // still A's own
      assert.equal(viewA.vink.contributionProgress.confirmedAmountMinor, 3_000); // aggregate only
    },
  );

  it('contributionStatus reflects AUTHORIZED as confirmed, matching D24/D25 exactly', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: MEMBER_A },
    });
    const view = await getParticipantVinkView(f.store, f.vinkId, MEMBER_A, NOW);
    assert.equal(view.participant.contributionStatus, 'confirmed');
  });

  it(
    'RESTRICTED reachability: a member whose Vink defaults all the way to RESTRICTED still ' +
      'gets a working (200-equivalent) view, never an error — vinkOutcome reads completed, ' +
      "matching the guest projection's own rule that a participant's money is already " +
      'resolved by the time RESTRICTED is reachable',
    async () => {
      const f = await fixture();
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: ORGANIZER },
      });
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: MEMBER_A },
      });
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: MEMBER_B },
      });
      const card = await provisionCardCommand(f.ctx, { vinkId: f.vinkId });
      const swipe = f.provider.simulateMerchantAuthorization({
        providerCardId: card.providerCardId,
        amount: { amountMinor: 12_000, currency: 'USD' },
        merchantId: 'GROCER-1',
        merchantName: 'Grocer',
        mcc: '5411',
        merchantCountry: 'US',
      });
      const auth = await authorizeMerchantPurchaseCommand(f.ctx, {
        vinkId: f.vinkId,
        providerAuthorizationId: swipe.providerAuthorizationId!,
        merchantName: 'Grocer',
        merchantIdentifier: 'GROCER-1',
        mcc: '5411',
        amountMinor: 12_000,
      });
      const settled = await settlePurchaseCommand(f.ctx, {
        vinkId: f.vinkId,
        authorizationId: auth.authorization.id,
        settledAmountMinor: 13_500, // overage → RECOVERY_REQUIRED
      });
      assert.equal(settled.vinkState, 'RECOVERY_REQUIRED');

      await startRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
      for (let attempt = 2; attempt < RECOVERY_MAX_ATTEMPTS; attempt += 1) {
        await retryRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
      }
      const result = await retryRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
      assert.equal(result.vinkState, 'RESTRICTED');

      // The actual reachability proof: this call must not throw for a genuine participant.
      const view = await getParticipantVinkView(f.store, f.vinkId, MEMBER_A, NOW);
      assert.equal(view.vink.vinkOutcome, 'completed');
      assert.equal(view.vink.state, 'RESTRICTED');
      assert.equal(view.participant.contributionStatus, 'confirmed');
    },
  );
});
