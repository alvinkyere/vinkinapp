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
import { getParticipantVinkActivity, getParticipantVinkView, getVinkDetails } from './guest.ts';
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

describe('getParticipantVinkActivity (Slice I2D)', () => {
  it('VINK_NOT_FOUND for an unknown vink', async () => {
    const store = new InMemoryVinkStore();
    await assert.rejects(
      getParticipantVinkActivity(store, 'nope' as VinkId, MEMBER_A),
      isAppError('VINK_NOT_FOUND'),
    );
  });

  it('FORBIDDEN for a signed-in user who is not a participant of this vink', async () => {
    const f = await fixture();
    await assert.rejects(
      getParticipantVinkActivity(f.store, f.vinkId, STRANGER),
      isAppError('FORBIDDEN'),
    );
  });

  it('includes vink-wide milestone events (VinkCreated, VinkOpened) but excludes transition rows entirely', async () => {
    const f = await fixture();
    const activity = await getParticipantVinkActivity(f.store, f.vinkId, MEMBER_A);
    const eventTypes = activity.map((entry) => entry.detail.eventType);
    assert.ok(eventTypes.includes('VinkCreated'));
    assert.ok(eventTypes.includes('VinkOpened'));
    assert.ok(activity.every((entry) => entry.kind === 'event'));
  });

  it('every surviving entry is sanitized to {eventType} only — no participantId, actor, or correlationId', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: MEMBER_A },
    });
    const activity = await getParticipantVinkActivity(f.store, f.vinkId, MEMBER_A);
    for (const entry of activity) {
      assert.deepEqual(Object.keys(entry.detail), ['eventType']);
    }
  });

  it(
    "PRIVACY: member A's activity feed includes A's own ContributionAuthorized but never " +
      "member B's — a fellow participant's payment activity is never this participant's business",
    async () => {
      const f = await fixture();
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: MEMBER_A },
      });
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: MEMBER_B },
      });
      const activityA = await getParticipantVinkActivity(f.store, f.vinkId, MEMBER_A);
      const authorizedCount = activityA.filter(
        (entry) => entry.detail.eventType === 'ContributionAuthorized',
      ).length;
      assert.equal(authorizedCount, 1, "exactly one ContributionAuthorized — A's own, never B's");
    },
  );

  it(
    'excludes organizer-only recovery/restriction internals even when they genuinely occurred ' +
      'on this vink (RecoveryObligationCreated, OrganizerRestricted never leak to a participant)',
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
      await settlePurchaseCommand(f.ctx, {
        vinkId: f.vinkId,
        authorizationId: auth.authorization.id,
        settledAmountMinor: 13_500, // overage → RECOVERY_REQUIRED
      });
      await startRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
      for (let attempt = 2; attempt < RECOVERY_MAX_ATTEMPTS; attempt += 1) {
        await retryRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });
      }
      await retryRecoveryCommand(f.ctx, { vinkId: f.vinkId, scenario: 'DECLINE' });

      // Reachability, matching getParticipantVinkView's own RESTRICTED proof — must not throw.
      const activity = await getParticipantVinkActivity(f.store, f.vinkId, MEMBER_A);
      const eventTypes = activity.map((entry) => entry.detail.eventType);
      assert.ok(!eventTypes.includes('RecoveryObligationCreated'));
      assert.ok(!eventTypes.includes('OrganizerRestricted'));
      assert.ok(!eventTypes.includes('SettlementVarianceDetected'));
    },
  );
});

describe('getVinkDetails (Slice I6, D29/D31)', () => {
  it('VINK_NOT_FOUND for an unknown vink', async () => {
    const store = new InMemoryVinkStore();
    await assert.rejects(
      getVinkDetails(store, 'nope' as VinkId, MEMBER_A),
      isAppError('VINK_NOT_FOUND'),
    );
  });

  it('FORBIDDEN for a signed-in user who is neither the organizer nor an active participant', async () => {
    const f = await fixture();
    await assert.rejects(getVinkDetails(f.store, f.vinkId, STRANGER), isAppError('FORBIDDEN'));
  });

  it('the organizer can view it — full shape, viewerRole organizer, no viewerParticipant', async () => {
    const f = await fixture();
    const details = await getVinkDetails(f.store, f.vinkId, ORGANIZER);
    assert.equal(details.vinkId, f.vinkId);
    assert.equal(details.purchaseCategory, 'GROCERY');
    assert.equal(details.totalMinor, 12_000);
    assert.equal(details.viewerRole, 'organizer');
    assert.equal(details.organizerDisplayName, 'Org');
    assert.equal(
      details.viewerParticipant,
      null,
      'D43: the organizer view never carries a viewerParticipant block',
    );
  });

  it('D43: the organizer sees only a customer-safe AGGREGATE summary, never a per-participant breakdown', async () => {
    const f = await fixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: { kind: 'user', userId: MEMBER_A },
    });
    const details = await getVinkDetails(f.store, f.vinkId, ORGANIZER);
    assert.equal(details.summary.confirmedAmountMinor, 5_000);
    assert.equal(details.summary.confirmedParticipantCount, 1);
    assert.equal(details.summary.totalParticipantCount, 3);
    assert.ok(
      !('participants' in details),
      'no per-participant array anywhere on the response — D43 supersedes the earlier widening',
    );
    const serialized = JSON.stringify(details);
    assert.ok(
      !serialized.includes('Member B'),
      "no participant's name ever appears in the organizer's own aggregate-only view",
    );
  });

  it(
    "D43: a participant sees ONLY their own share/outcome — never another participant's amount, " +
      'status, or identity',
    async () => {
      const f = await fixture();
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: MEMBER_A },
      });
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: { kind: 'user', userId: MEMBER_B },
      });
      const details = await getVinkDetails(f.store, f.vinkId, MEMBER_A);
      assert.equal(details.viewerRole, 'participant');
      assert.equal(details.organizerDisplayName, 'Org');
      assert.ok(details.viewerParticipant, "memberA's own viewerParticipant block is present");
      assert.equal(details.viewerParticipant!.assignedShareMinor, 5_000);
      assert.equal(details.viewerParticipant!.confirmedAmountMinor, 5_000);
      assert.equal(details.viewerParticipant!.contributionOutcomeLabel, 'confirmed');
      // The aggregate is fine (pooled, not identity-linked) — but memberB's own name/amount
      // must never appear anywhere in memberA's response.
      const serialized = JSON.stringify(details);
      assert.ok(!serialized.includes('Member B'), "memberB's identity never leaks to memberA");
      assert.ok(
        !serialized.includes('3000') || !serialized.includes('memberBId'),
        "memberB's own amount is never independently identifiable in memberA's view",
      );
      assert.equal(details.summary.confirmedAmountMinor, 8_000, 'aggregate: A (5000) + B (3000)');
      assert.equal(details.summary.confirmedParticipantCount, 2);
    },
  );

  it('vinkOutcome reflects the vink-level outcome category, never the raw state name', async () => {
    const f = await fixture();
    const details = await getVinkDetails(f.store, f.vinkId, ORGANIZER);
    assert.equal(details.vinkOutcome, 'open');
  });

  it('timeline includes vink-wide milestones, sanitized to {eventType, at} only', async () => {
    const f = await fixture();
    const details = await getVinkDetails(f.store, f.vinkId, ORGANIZER);
    const eventTypes = details.timeline.map((entry) => entry.eventType);
    assert.ok(eventTypes.includes('VinkCreated'));
    assert.ok(eventTypes.includes('VinkOpened'));
    for (const entry of details.timeline) {
      assert.deepEqual(Object.keys(entry).sort(), ['at', 'eventType']);
    }
  });

  it('merchantSettlementDetail is null before any settlement occurs', async () => {
    const f = await fixture();
    const details = await getVinkDetails(f.store, f.vinkId, ORGANIZER);
    assert.equal(details.merchantSettlementDetail, null);
  });

  it('merchantSettlementDetail names the real merchant once a settlement occurs', async () => {
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
      merchantName: 'Corner Grocer',
      mcc: '5411',
      merchantCountry: 'US',
    });
    const auth = await authorizeMerchantPurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      providerAuthorizationId: swipe.providerAuthorizationId!,
      merchantName: 'Corner Grocer',
      merchantIdentifier: 'GROCER-1',
      mcc: '5411',
      amountMinor: 12_000,
    });
    await settlePurchaseCommand(f.ctx, {
      vinkId: f.vinkId,
      authorizationId: auth.authorization.id,
      settledAmountMinor: 12_000,
    });

    const details = await getVinkDetails(f.store, f.vinkId, ORGANIZER);
    assert.equal(details.merchantSettlementDetail, 'Corner Grocer — settled');
  });
});
