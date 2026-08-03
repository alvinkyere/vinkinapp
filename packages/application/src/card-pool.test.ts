import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, UserId, VinkId } from '../../domain/src/index.ts';
import { newCardId, newCardWalletTokenId } from '../../domain/src/index.ts';
import { MockFinancialProvider } from '../../payment-provider/src/index.ts';
import { InMemoryVinkStore } from './testing/in-memory.ts';
import { ApplicationError } from './errors.ts';
import type { CommandContext } from './ports.ts';
import { createVinkCommand } from './commands.ts';
import {
  disableCardCommand,
  enableCardCommand,
  provisionWalletTokenCommand,
  reserveCardFromPoolCommand,
  returnCardToPoolCommand,
  revokeWalletTokenCommand,
  type CardPoolCommandContext,
  type CardProvisioningCommandContext,
} from './card-pool.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-28T10:00:00Z');
const DEADLINE = '2026-07-28T12:00:00Z';

function organizerCtx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

function poolCtx(store: InMemoryVinkStore): CardPoolCommandContext {
  return { uow: store, clock: { now: () => NOW }, correlationId: 'test' };
}

function provisioningCtx(
  store: InMemoryVinkStore,
  provider: MockFinancialProvider,
): CardProvisioningCommandContext {
  return { uow: store, clock: { now: () => NOW }, correlationId: 'test', provider };
}

function seedCard(store: InMemoryVinkStore, lastFour = '4242'): Card {
  const card: Card = {
    id: newCardId(),
    providerCardId: `card_${lastFour}`,
    displayLastFour: lastFour,
    status: 'AVAILABLE',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  store.cardPool.set(card.id, card);
  return card;
}

/** RM2 fixture: a pool `Card` whose `providerCardId` refers to a REAL mock provider card
 * (via `issueTemporaryCard`), so `enableCard`/`disableCard`/`createWalletProvisioningSession`
 * operate on something that genuinely exists in the provider, not a fabricated id. */
async function seedCardWithRealProviderCard(
  store: InMemoryVinkStore,
  provider: MockFinancialProvider,
): Promise<Card> {
  const { providerCardholderId } = await provider.createCardholder({
    idempotencyKey: `cardholder:test:${Math.random()}`,
    externalAccountId: 'vinkin-financial-account',
    legalName: 'VinkIn Inc',
  });
  const issued = await provider.issueTemporaryCard({
    idempotencyKey: `issue:test:${Math.random()}`,
    providerCardholderId,
    spendLimit: { amountMinor: 100_000, currency: 'USD' },
    metadata: {},
  });
  // D47: pool cards are disabled by default, enabled only while assigned — `issueTemporaryCard`
  // itself always activates (the OLD one-shot-card contract), so this fixture disables it
  // right after, to accurately model a real pool card's resting state.
  await provider.disableCard(issued.providerCardId);
  const card: Card = {
    id: newCardId(),
    providerCardId: issued.providerCardId,
    displayLastFour: '4242',
    status: 'AVAILABLE',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  store.cardPool.set(card.id, card);
  return card;
}

async function draftVink(store: InMemoryVinkStore): Promise<VinkId> {
  const { vink } = await createVinkCommand(organizerCtx(store), {
    purchaseCategory: 'GROCERY',
    subtotalMinor: 5_000,
    tipMinor: 0,
    submissionDeadline: DEADLINE,
    organizerDisplayName: 'Org',
  });
  return vink.id;
}

describe('card pool (RM1, D47)', () => {
  it('reserveCardFromPoolCommand claims one AVAILABLE card and creates an ACTIVE assignment', async () => {
    const store = new InMemoryVinkStore();
    const card = seedCard(store);
    const vinkId = await draftVink(store);

    const assignment = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });

    assert.equal(assignment.cardId, card.id);
    assert.equal(assignment.status, 'ACTIVE');
    assert.equal(assignment.spendingLimit.amountMinor, 5_000);
    assert.equal(assignment.returnedAt, null);
    assert.equal(
      new Date(assignment.usageWindowExpiresAt).getTime() - NOW.getTime(),
      600_000,
      'usage window is exactly 10 minutes out',
    );
    assert.equal(store.cardPool.get(card.id)?.status, 'RESERVED');
  });

  it('CARD_POOL_EXHAUSTED when no card is AVAILABLE', async () => {
    const store = new InMemoryVinkStore();
    const vinkId = await draftVink(store);

    await assert.rejects(
      reserveCardFromPoolCommand(poolCtx(store), {
        vinkId,
        spendingLimitMinor: 5_000,
        usageWindowSeconds: 600,
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === 'CARD_POOL_EXHAUSTED',
    );
  });

  it('a vink can only ever be assigned a card once', async () => {
    const store = new InMemoryVinkStore();
    seedCard(store, '1111');
    seedCard(store, '2222');
    const vinkId = await draftVink(store);

    await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });

    await assert.rejects(
      reserveCardFromPoolCommand(poolCtx(store), {
        vinkId,
        spendingLimitMinor: 5_000,
        usageWindowSeconds: 600,
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === 'INVALID_COMMAND',
    );
  });

  it('returnCardToPoolCommand refuses to return a card whose wallet token is not revoked', async () => {
    const store = new InMemoryVinkStore();
    seedCard(store);
    const vinkId = await draftVink(store);
    const assignment = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });

    // No wallet token provisioned at all (RM1 predates RM5's real provisioning) — must fail
    // closed, exactly like an explicitly-still-PROVISIONED token would.
    await assert.rejects(
      returnCardToPoolCommand(poolCtx(store), { cardAssignmentId: assignment.id }),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === 'WALLET_TOKEN_NOT_REVOKED',
    );
    assert.equal(
      store.cardPool.get(assignment.cardId)?.status,
      'RESERVED',
      'the card must still be RESERVED, not returned to the pool',
    );
  });

  it('THE SECURITY PROPERTY: a card only returns to the pool — and becomes reservable again — once its wallet token is REVOKED, never before', async () => {
    const store = new InMemoryVinkStore();
    const card = seedCard(store);
    const firstVink = await draftVink(store);
    const firstAssignment = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId: firstVink,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });

    // Simulate RM5's real wallet-token provisioning/revocation lifecycle directly against the
    // store (no command exists yet for this — that's RM2/RM5's job).
    await store.insertCardWalletToken({
      id: newCardWalletTokenId(),
      cardAssignmentId: firstAssignment.id,
      providerTokenId: 'ipt_1',
      status: 'PROVISIONED',
      provisionedAt: NOW.toISOString(),
      revokedAt: null,
    });

    // Still provisioned, not revoked — return must still fail.
    await assert.rejects(
      returnCardToPoolCommand(poolCtx(store), { cardAssignmentId: firstAssignment.id }),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === 'WALLET_TOKEN_NOT_REVOKED',
    );

    const token = await store.getCardWalletTokenForAssignment(firstAssignment.id);
    await store.updateCardWalletToken({
      ...token!,
      status: 'REVOKED',
      revokedAt: NOW.toISOString(),
    });

    const returned = await returnCardToPoolCommand(poolCtx(store), {
      cardAssignmentId: firstAssignment.id,
    });
    assert.equal(returned.status, 'RETURNED');
    assert.equal(store.cardPool.get(card.id)?.status, 'AVAILABLE');

    // The actual security property: the card is now reservable again, by a genuinely
    // different Vink, only because its previous wallet token is dead.
    const secondVink = await draftVink(store);
    const secondAssignment = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId: secondVink,
      spendingLimitMinor: 3_000,
      usageWindowSeconds: 600,
    });
    assert.equal(secondAssignment.cardId, card.id);
    assert.notEqual(secondAssignment.id, firstAssignment.id);
  });

  it('returning an already-RETURNED assignment is idempotent, not an error', async () => {
    const store = new InMemoryVinkStore();
    seedCard(store);
    const vinkId = await draftVink(store);
    const assignment = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });
    await store.insertCardWalletToken({
      id: newCardWalletTokenId(),
      cardAssignmentId: assignment.id,
      providerTokenId: 'ipt_1',
      status: 'REVOKED',
      provisionedAt: NOW.toISOString(),
      revokedAt: NOW.toISOString(),
    });

    const first = await returnCardToPoolCommand(poolCtx(store), {
      cardAssignmentId: assignment.id,
    });
    const second = await returnCardToPoolCommand(poolCtx(store), {
      cardAssignmentId: assignment.id,
    });
    assert.equal(first.status, 'RETURNED');
    assert.deepEqual(second, first);
  });
});

describe('card provisioning lifecycle (RM2, D47)', () => {
  it('enableCardCommand progresses RESERVED -> ENABLING -> AWAITING_WALLET_PROVISIONING and is idempotent', async () => {
    const store = new InMemoryVinkStore();
    const provider = new MockFinancialProvider({ now: () => NOW });
    const card = await seedCardWithRealProviderCard(store, provider);
    const vinkId = await draftVink(store);
    const assignment = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });
    assert.equal(assignment.provisioningStatus, 'RESERVED');

    const enabled = await enableCardCommand(provisioningCtx(store, provider), {
      cardAssignmentId: assignment.id,
    });
    assert.equal(enabled.provisioningStatus, 'AWAITING_WALLET_PROVISIONING');
    assert.equal((await provider.getCardStatus(card.providerCardId)).status, 'ACTIVE');

    // Idempotent: a second call is a no-op, not a second provider call.
    const enabledAgain = await enableCardCommand(provisioningCtx(store, provider), {
      cardAssignmentId: assignment.id,
    });
    assert.deepEqual(enabledAgain, enabled);
  });

  it('provisionWalletTokenCommand requires enable first, then reaches READY_TO_PAY', async () => {
    const store = new InMemoryVinkStore();
    const provider = new MockFinancialProvider({ now: () => NOW });
    await seedCardWithRealProviderCard(store, provider);
    const vinkId = await draftVink(store);
    const assignment = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });

    await assert.rejects(
      provisionWalletTokenCommand(provisioningCtx(store, provider), {
        cardAssignmentId: assignment.id,
        walletType: 'APPLE_PAY',
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === 'INVALID_COMMAND',
    );

    await enableCardCommand(provisioningCtx(store, provider), { cardAssignmentId: assignment.id });
    const provisioned = await provisionWalletTokenCommand(provisioningCtx(store, provider), {
      cardAssignmentId: assignment.id,
      walletType: 'APPLE_PAY',
    });
    assert.equal(provisioned.provisioningStatus, 'READY_TO_PAY');
    const token = await store.getCardWalletTokenForAssignment(assignment.id);
    assert.equal(token?.status, 'PROVISIONED');
  });

  it('THE FULL RE-ASSIGNMENT SCENARIO: Card A serves Vink 1, is fully torn down, then genuinely serves Vink 2 — Token 1 can never authorize again', async () => {
    const store = new InMemoryVinkStore();
    const provider = new MockFinancialProvider({ now: () => NOW });
    const card = await seedCardWithRealProviderCard(store, provider);
    const vink1 = await draftVink(store);
    const vink2 = await draftVink(store);
    const ctx = () => provisioningCtx(store, provider);

    // Assign Card A to Vink 1 -> enable -> provision Token 1.
    const assignment1 = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId: vink1,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });
    await enableCardCommand(ctx(), { cardAssignmentId: assignment1.id });
    const ready1 = await provisionWalletTokenCommand(ctx(), {
      cardAssignmentId: assignment1.id,
      walletType: 'APPLE_PAY',
    });
    assert.equal(ready1.provisioningStatus, 'READY_TO_PAY');
    const token1 = await store.getCardWalletTokenForAssignment(assignment1.id);
    assert.ok(token1);

    // Disable -> revoke Token 1 -> return Card A to the pool.
    await disableCardCommand(ctx(), { cardAssignmentId: assignment1.id });
    const sanitized1 = await revokeWalletTokenCommand(ctx(), { cardAssignmentId: assignment1.id });
    assert.equal(sanitized1.provisioningStatus, 'SANITIZED');
    assert.equal((await provider.getWalletToken(token1!.providerTokenId)).status, 'REVOKED');
    const returned1 = await returnCardToPoolCommand(poolCtx(store), {
      cardAssignmentId: assignment1.id,
    });
    assert.equal(returned1.status, 'RETURNED');
    assert.equal(store.cardPool.get(card.id)?.status, 'AVAILABLE');

    // Assign the SAME underlying Card A to Vink 2 -> enable -> provision Token 2.
    const assignment2 = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId: vink2,
      spendingLimitMinor: 3_000,
      usageWindowSeconds: 600,
    });
    assert.equal(assignment2.cardId, card.id, 'the same physical card is reused');
    assert.notEqual(assignment2.id, assignment1.id);
    await enableCardCommand(ctx(), { cardAssignmentId: assignment2.id });
    const ready2 = await provisionWalletTokenCommand(ctx(), {
      cardAssignmentId: assignment2.id,
      walletType: 'GOOGLE_PAY',
    });
    assert.equal(ready2.provisioningStatus, 'READY_TO_PAY');
    const token2 = await store.getCardWalletTokenForAssignment(assignment2.id);
    assert.ok(token2);
    assert.notEqual(token2!.providerTokenId, token1!.providerTokenId);

    // THE ACTUAL PROOF: Token 1 is dead forever; Token 2 is the only valid token for Card A.
    assert.equal((await provider.getWalletToken(token1!.providerTokenId)).status, 'REVOKED');
    assert.equal((await provider.getWalletToken(token2!.providerTokenId)).status, 'ACTIVE');
    const allTokensForCard = await provider.listWalletTokens(card.providerCardId);
    assert.equal(allTokensForCard.length, 2);
    assert.equal(
      allTokensForCard.find((t) => t.providerTokenId === token1!.providerTokenId)?.status,
      'REVOKED',
    );
    assert.equal(
      allTokensForCard.find((t) => t.providerTokenId === token2!.providerTokenId)?.status,
      'ACTIVE',
    );
  });

  it('a genuinely ambiguous provider outcome (UNKNOWN_OUTCOME) quarantines the card instead of leaving it silently reservable', async () => {
    const store = new InMemoryVinkStore();
    const provider = new MockFinancialProvider({ now: () => NOW });
    const card = await seedCardWithRealProviderCard(store, provider);
    const vinkId = await draftVink(store);
    const assignment = await reserveCardFromPoolCommand(poolCtx(store), {
      vinkId,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });

    provider.simulateUnknownOutcome(false);
    await assert.rejects(
      enableCardCommand(provisioningCtx(store, provider), { cardAssignmentId: assignment.id }),
      (error: unknown) => error instanceof Error && error.name === 'ProviderError',
    );
    assert.equal(
      store.cardPool.get(card.id)?.status,
      'QUARANTINED',
      'an ambiguous outcome must quarantine the card, never leave it silently AVAILABLE or RESERVED-forever',
    );
  });
});
