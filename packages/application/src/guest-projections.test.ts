import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { UserId, VinkId } from '../../domain/src/index.ts';
import { MockFinancialProvider } from '../../payment-provider/src/index.ts';
import { InMemoryVinkStore } from './testing/in-memory.ts';
import type { CommandContext } from './ports.ts';
import {
  addParticipantCommand,
  cancelVinkCommand,
  createVinkCommand,
  openVinkCommand,
  setSplitCommand,
} from './commands.ts';
import {
  authorizeContributionCommand,
  closeSubmissionsCommand,
  resolveGraceCommand,
  type ContributionCommandContext,
} from './contributions.ts';
import { provisionCardCommand } from './purchases.ts';
import { authorizeMerchantPurchaseCommand, settlePurchaseCommand } from './purchases.ts';
import { refundFailedSessionCommand } from './refunds.ts';
import { startRecoveryCommand } from './recovery.ts';
import {
  getGuestVinkView,
  getPublicVinkView,
  inviteGuestCommand,
  type GuestVinkView,
} from './guest.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-18T10:00:00Z');
const DEADLINE = '2026-07-18T12:00:00Z';
const AFTER_DEADLINE = new Date('2026-07-18T12:00:30Z');
const AFTER_GRACE = new Date('2026-07-18T12:01:30Z');

function organizerCtx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

function unwrap(view: Awaited<ReturnType<typeof getGuestVinkView>>): GuestVinkView {
  assert.ok('participant' in view, 'expected the full GuestVinkView, not NotOpenYetView');
  return view;
}

describe('D23 pre-open guest access (Slice I1)', () => {
  it('gateDraft: true withholds everything but the not-open-yet marker for a DRAFT vink', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 10_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const view = await getPublicVinkView(store, vink.publicCode, NOW, { gateDraft: true });
    assert.deepEqual(view, { vinkOutcome: 'not_open_yet' });
  });

  it("gateDraft omitted preserves today's exact existing (bug) behavior — full leak, unchanged", async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 10_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const view = await getPublicVinkView(store, vink.publicCode, NOW);
    // Today's existing behavior, preserved byte-for-byte for un-migrated callers — this is
    // the exact bug (P0-2) the gate exists to fix once callers opt in.
    assert.equal(view.state, 'DRAFT');
    assert.equal(view.requiredAmountMinor, 10_000);
  });

  it('a guest invited while DRAFT (organizer-initiated) also gets the gate on getGuestVinkView', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 10_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const invited = await inviteGuestCommand(organizerCtx(store), {
      vinkId: vink.id,
      displayName: 'Early Guest',
      accessTokenHash: 'hash-early-guest',
    });
    assert.equal(invited.participant.status, 'JOINED'); // invites are allowed pre-open (commands.ts)

    const gated = await getGuestVinkView(store, 'hash-early-guest', NOW, { gateDraft: true });
    assert.deepEqual(gated, { vinkOutcome: 'not_open_yet' });

    const legacy = await getGuestVinkView(store, 'hash-early-guest', NOW);
    assert.equal(legacy.vink.state, 'DRAFT'); // legacy path unaffected, as designed
  });

  it('once opened, the same guest sees the full gated view with vinkOutcome "open"', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 10_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    await inviteGuestCommand(organizerCtx(store), {
      vinkId: vink.id,
      displayName: 'Early Guest',
      accessTokenHash: 'hash-early-guest',
    });
    await addParticipantCommand(organizerCtx(store), {
      vinkId: vink.id,
      userId: 'user-a' as UserId,
      displayName: 'a',
    });
    await setSplitCommand(organizerCtx(store), { vinkId: vink.id, method: 'EQUAL' });
    await openVinkCommand(organizerCtx(store), { vinkId: vink.id });

    const view = unwrap(
      await getGuestVinkView(store, 'hash-early-guest', NOW, { gateDraft: true }),
    );
    assert.equal(view.vink.vinkOutcome, 'open');
    assert.equal(view.participant.contributionStatus, 'not_started');
  });
});

describe('D24/D25 guest contributionStatus and vinkOutcome (Slice I1)', () => {
  async function twoGuestFixture(): Promise<{
    store: InMemoryVinkStore;
    provider: MockFinancialProvider;
    ctx: ContributionCommandContext;
    vinkId: VinkId;
    tokenX: string;
    tokenY: string;
    requesterX: { kind: 'guest'; guestIdentityId: string };
    requesterY: { kind: 'guest'; guestIdentityId: string };
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
    // Guests are added pre-open, organizer-initiated (inviteGuestCommand allows DRAFT/OPEN,
    // guest.ts) — guestJoinVinkCommand's own public self-join requires the vink to already
    // be OPEN, and openVinkCommand itself requires >=1 non-organizer participant already
    // present, so the invite path is the only way to reach "two guests, vink not yet open".
    const guestX = await inviteGuestCommand(organizerCtx(store), {
      vinkId: vink.id,
      displayName: 'Guest X',
      accessTokenHash: 'hash-x',
    });
    const guestY = await inviteGuestCommand(organizerCtx(store), {
      vinkId: vink.id,
      displayName: 'Guest Y',
      accessTokenHash: 'hash-y',
    });
    await setSplitCommand(organizerCtx(store), {
      vinkId: vink.id,
      method: 'CUSTOM_AMOUNT',
      amounts: [
        { participantId: participants[0]!.id, amountMinor: 0 }, // organizer, deliberate $0
        { participantId: guestX.participant.id, amountMinor: 6_000 },
        { participantId: guestY.participant.id, amountMinor: 6_000 },
      ],
    });
    await openVinkCommand(organizerCtx(store), { vinkId: vink.id });
    return {
      store,
      provider,
      ctx: { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider },
      vinkId: vink.id,
      tokenX: 'hash-x',
      tokenY: 'hash-y',
      requesterX: { kind: 'guest', guestIdentityId: guestX.guest.id },
      requesterY: { kind: 'guest', guestIdentityId: guestY.guest.id },
    };
  }

  it('not_started before any attempt', async () => {
    const f = await twoGuestFixture();
    const view = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
    assert.equal(view.participant.contributionStatus, 'not_started');
  });

  it('processing while an authorization is in flight (DELAYED scenario)', async () => {
    const f = await twoGuestFixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.requesterX,
      scenario: 'DELAYED',
    });
    const view = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
    assert.equal(view.participant.contributionStatus, 'processing');
  });

  it(
    'a confirmed guest is never re-offered the action after reload — contributionStatus is ' +
      'server-resolved every call, not a client flag, and stays "confirmed" across repeated reads',
    async () => {
      const f = await twoGuestFixture();
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: f.requesterX,
      });
      // Simulate three independent "reloads" — three fresh calls, no shared client state.
      for (let i = 0; i < 3; i += 1) {
        const reloaded = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
        assert.equal(reloaded.participant.contributionStatus, 'confirmed');
      }
    },
  );

  it('declined_retryable while the vink is still OPEN', async () => {
    const f = await twoGuestFixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.requesterX,
      scenario: 'DECLINE',
    });
    const view = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
    assert.equal(view.participant.contributionStatus, 'declined_retryable');
  });

  it("GUEST PRIVACY: one guest's contributionStatus never reflects another guest's status", async () => {
    const f = await twoGuestFixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.requesterX,
    }); // X confirms
    // Y never attempts.
    const viewX = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
    const viewY = unwrap(await getGuestVinkView(f.store, f.tokenY, NOW));
    assert.equal(viewX.participant.contributionStatus, 'confirmed');
    assert.equal(viewY.participant.contributionStatus, 'not_started');
    // Neither guest's payload names or references the other participant at all.
    assert.equal(JSON.stringify(viewX).includes(viewY.participant.id), false);
    assert.equal(JSON.stringify(viewY).includes(viewX.participant.id), false);
    // The aggregate progress is visible to both (safe, non-identifying), the per-guest
    // status is not shared between them.
    assert.equal(viewX.vink.contributionProgress.confirmedAmountMinor, 6_000);
    assert.equal(viewY.vink.contributionProgress.confirmedAmountMinor, 6_000);
  });

  it("expired before either guest contributes: declined_final via the resolver's own cancellation, vinkOutcome expired", async () => {
    const f = await twoGuestFixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.requesterX,
      scenario: 'DELAYED', // stays AUTHORIZATION_PENDING through the deadline
    });
    await closeSubmissionsCommand(f.ctx, { vinkId: f.vinkId, now: AFTER_DEADLINE });
    const outcome = await resolveGraceCommand(f.ctx, { vinkId: f.vinkId, now: AFTER_GRACE });
    assert.equal(outcome, 'EXPIRED');

    const viewX = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
    const viewY = unwrap(await getGuestVinkView(f.store, f.tokenY, NOW));
    assert.equal(viewX.vink.vinkOutcome, 'expired');
    assert.equal(viewY.vink.vinkOutcome, 'expired');
    // The resolver explicitly cancels every unresolved hold on FUNDING_FAILED
    // (contributions.ts resolveFunding) — never charged, never retryable.
    assert.equal(viewX.participant.contributionStatus, 'declined_final');
    assert.equal(viewY.participant.contributionStatus, 'not_started'); // Y never attempted at all
  });

  it(
    'expired AFTER a confirmed contribution (FUNDING_REVERSAL → EXPIRED): the contribution ' +
      'stays CAPTURED until refundFailedSessionCommand actually runs — contributionStatus ' +
      'correctly still reads "confirmed" in that brief window, never fabricated as returning',
    async () => {
      const f = await twoGuestFixture();
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: f.requesterX,
      });
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: f.requesterY,
      });
      f.provider.simulateTransientFailure();
      await assert.rejects(provisionCardCommand(f.ctx, { vinkId: f.vinkId }));
      assert.equal((await f.store.getVink(f.vinkId))?.state, 'EXPIRED');

      const viewXDuring = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
      assert.equal(viewXDuring.vink.vinkOutcome, 'expired');
      assert.equal(viewXDuring.participant.contributionStatus, 'confirmed');

      // Now the refund actually runs — status flips to return_pending's terminal, "returned".
      await refundFailedSessionCommand(f.ctx, { vinkId: f.vinkId });
      const viewXAfter = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
      assert.equal(viewXAfter.participant.contributionStatus, 'returned');
    },
  );

  it('E8-style return_pending: a transient provider failure yields REFUND_FAILED, collapsed to return_pending', async () => {
    const f = await twoGuestFixture();
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.requesterX,
    });
    await authorizeContributionCommand(f.ctx, {
      vinkId: f.vinkId,
      requester: f.requesterY,
    });
    f.provider.simulateTransientFailure();
    await assert.rejects(provisionCardCommand(f.ctx, { vinkId: f.vinkId }));

    // One participant's refund fails transiently; the other succeeds.
    f.provider.simulateTransientFailure();
    const summary = await refundFailedSessionCommand(f.ctx, { vinkId: f.vinkId });
    assert.equal(summary.failed, 1);
    assert.equal(summary.refunded, 1);

    const viewX = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
    const viewY = unwrap(await getGuestVinkView(f.store, f.tokenY, NOW));
    const statuses = [
      viewX.participant.contributionStatus,
      viewY.participant.contributionStatus,
    ].sort();
    // One is REFUND_FAILED (collapsed to return_pending — never surfaced as a distinct
    // alarming failure, Phase 2 §9), the other is REFUNDED (returned).
    assert.deepEqual(statuses, ['return_pending', 'returned']);
  });

  it('cancelled before any contribution: cancelled outcome, not_started status', async () => {
    const f = await twoGuestFixture();
    await cancelVinkCommand(organizerCtx(f.store), { vinkId: f.vinkId });
    const view = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
    assert.equal(view.vink.vinkOutcome, 'cancelled');
    assert.equal(view.participant.contributionStatus, 'not_started');
  });

  it(
    'REAL DOMAIN FINDING, accurately reflected not papered over: cancelVinkCommand only ' +
      'transitions the Vink itself — it never releases an already-AUTHORIZED hold ' +
      '(commands.ts cancelVinkCommand has no contribution-side effect at all). A guest whose ' +
      'contribution was already authorized before the organizer cancels therefore still reads ' +
      '"confirmed" even though vinkOutcome is "cancelled" — this projection reports the real, ' +
      'current domain state exactly, rather than fabricating a different contributionStatus ' +
      'to make the combination look tidier. Not modified here (contribution charging/' +
      "cancellation semantics are explicitly out of Slice I1's scope) — flagged in the I1 " +
      'completion report instead.',
    async () => {
      const f = await twoGuestFixture();
      await authorizeContributionCommand(f.ctx, {
        vinkId: f.vinkId,
        requester: f.requesterX,
      });
      await cancelVinkCommand(organizerCtx(f.store), { vinkId: f.vinkId });
      const view = unwrap(await getGuestVinkView(f.store, f.tokenX, NOW));
      assert.equal(view.vink.vinkOutcome, 'cancelled');
      assert.equal(view.participant.contributionStatus, 'confirmed');
    },
  );

  it('recovery_required: a settled contribution reads recovery_required while the vink resolves an overage, then reverts to confirmed once resolved', async () => {
    const store = new InMemoryVinkStore();
    const provider = new MockFinancialProvider({ now: () => NOW });
    const { vink, participants } = await createVinkCommand(organizerCtx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const guest = await inviteGuestCommand(organizerCtx(store), {
      vinkId: vink.id,
      displayName: 'Guest',
      accessTokenHash: 'hash-recovery',
    });
    await setSplitCommand(organizerCtx(store), {
      vinkId: vink.id,
      method: 'CUSTOM_AMOUNT',
      amounts: [
        { participantId: participants[0]!.id, amountMinor: 0 },
        { participantId: guest.participant.id, amountMinor: 12_000 },
      ],
    });
    await openVinkCommand(organizerCtx(store), { vinkId: vink.id });
    const ctx = { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider };
    await authorizeContributionCommand(ctx, {
      vinkId: vink.id,
      requester: { kind: 'guest', guestIdentityId: guest.guest.id },
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
      settledAmountMinor: 13_500, // overage → RECOVERY_REQUIRED
    });
    assert.equal(settled.vinkState, 'RECOVERY_REQUIRED');

    const duringRecovery = unwrap(await getGuestVinkView(store, 'hash-recovery', NOW));
    assert.equal(duringRecovery.vink.vinkOutcome, 'recovery_required');
    assert.equal(duringRecovery.participant.contributionStatus, 'recovery_required');
    // The guest's own money is unaffected either way — never a "pay again" signal exists
    // anywhere in this projection (no such contributionStatus value is defined at all).

    await startRecoveryCommand(ctx, { vinkId: vink.id }); // → RECOVERY_RESOLVED → COMPLETED
    const afterResolved = unwrap(await getGuestVinkView(store, 'hash-recovery', NOW));
    assert.equal(afterResolved.vink.vinkOutcome, 'completed');
    assert.equal(afterResolved.participant.contributionStatus, 'confirmed');
  });
});
