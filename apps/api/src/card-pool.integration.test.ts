/**
 * RM1 (D47) — the reusable card pool, against real PostgreSQL. Proves the two properties
 * that matter for a shared, reusable resource under real concurrency: (1) a genuinely
 * concurrent race for a small pool never double-assigns a card (the `FOR UPDATE SKIP LOCKED`
 * reservation query is the actual mechanism, not just the application-layer `UNIQUE
 * (vink_id)` pre-check), and (2) a card reassigned across two Vinks in sequence can only be
 * reserved by the second Vink once the first assignment's wallet token is confirmed REVOKED
 * — the real security property the whole wallet-token-scoped-authorization model exists for.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { PostgresVinkStore } from './modules/vinks/store.ts';
import {
  disableCardCommand,
  enableCardCommand,
  provisionWalletTokenCommand,
  reserveCardFromPoolCommand,
  returnCardToPoolCommand,
  revokeWalletTokenCommand,
} from '../../../packages/application/src/index.ts';
import type { VinkId } from '../../../packages/domain/src/index.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('card pool end-to-end (PostgreSQL, RM1/D47)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let store: PostgresVinkStore;
  const stamp = Date.now();

  before(async () => {
    db = await createIsolatedTestDb('card_pool');
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    store = new PostgresVinkStore(db.sql);
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  function poolCtx() {
    return { uow: store, clock: { now: () => new Date() }, correlationId: randomUUID() };
  }

  async function seedCard(lastFour: string): Promise<string> {
    const id = randomUUID();
    await db.sql`INSERT INTO cards (id, provider_card_id, display_last_four, status)
      VALUES (${id}, ${`card_${lastFour}`}, ${lastFour}, 'AVAILABLE')`;
    return id;
  }

  async function createRealVink(username: string): Promise<VinkId> {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: username, password: 'integration-password-1' },
    });
    const accessToken = registered.json().accessToken as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 5_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: username,
      },
    });
    return created.json().vink.id as VinkId;
  }

  it('a genuinely concurrent race for one card never double-assigns it — exactly one winner, the rest see CARD_POOL_EXHAUSTED', async () => {
    await seedCard(`${stamp}`.slice(-4));
    const vinkIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createRealVink(`pool_race_${stamp}_${i}`)),
    );

    const results = await Promise.allSettled(
      vinkIds.map((vinkId) =>
        reserveCardFromPoolCommand(poolCtx(), {
          vinkId,
          spendingLimitMinor: 5_000,
          usageWindowSeconds: 600,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one concurrent reservation succeeds');
    assert.equal(rejected.length, 4);
    for (const failure of rejected) {
      assert.match((failure as PromiseRejectedResult).reason.message ?? '', /pool/i);
    }

    const assignedRows = await db.sql`SELECT count(*)::int AS n FROM card_assignments`;
    assert.equal((assignedRows[0] as { n: number }).n, 1);
  });

  it("THE SECURITY PROPERTY (real Postgres): a card can only be reserved by a second Vink after the first assignment's wallet token is REVOKED", async () => {
    const cardId = await seedCard('9999');
    const firstVink = await createRealVink(`pool_reassign_a_${stamp}`);
    const secondVink = await createRealVink(`pool_reassign_b_${stamp}`);

    const firstAssignment = await reserveCardFromPoolCommand(poolCtx(), {
      vinkId: firstVink,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });
    assert.equal(firstAssignment.cardId, cardId);

    // The card is RESERVED — a second Vink cannot reserve it (the pool is exhausted, since
    // there's only one card seeded), regardless of the token question.
    await assert.rejects(
      reserveCardFromPoolCommand(poolCtx(), {
        vinkId: secondVink,
        spendingLimitMinor: 3_000,
        usageWindowSeconds: 600,
      }),
      /pool/i,
    );

    // Attempting to return before the wallet token is revoked fails, real Postgres included.
    await assert.rejects(
      returnCardToPoolCommand(poolCtx(), { cardAssignmentId: firstAssignment.id }),
      /revoked/i,
    );

    const tokenId = randomUUID();
    await db.sql`INSERT INTO card_wallet_tokens (
      id, card_assignment_id, provider_token_id, status, provisioned_at, revoked_at
    ) VALUES (${tokenId}, ${firstAssignment.id}, 'ipt_test', 'PROVISIONED', now(), NULL)`;

    // Still PROVISIONED, not REVOKED — return still fails.
    await assert.rejects(
      returnCardToPoolCommand(poolCtx(), { cardAssignmentId: firstAssignment.id }),
      /revoked/i,
    );

    await db.sql`UPDATE card_wallet_tokens SET status = 'REVOKED', revoked_at = now()
      WHERE id = ${tokenId}`;

    const returned = await returnCardToPoolCommand(poolCtx(), {
      cardAssignmentId: firstAssignment.id,
    });
    assert.equal(returned.status, 'RETURNED');

    const cardRow = await db.sql`SELECT status FROM cards WHERE id = ${cardId}`;
    assert.equal((cardRow[0] as { status: string }).status, 'AVAILABLE');

    // Now — and only now — the second Vink can genuinely reserve the same underlying card.
    const secondAssignment = await reserveCardFromPoolCommand(poolCtx(), {
      vinkId: secondVink,
      spendingLimitMinor: 3_000,
      usageWindowSeconds: 600,
    });
    assert.equal(secondAssignment.cardId, cardId);
    assert.notEqual(secondAssignment.id, firstAssignment.id);

    // Exactly one ACTIVE assignment for this card at any time — the DB's own partial unique
    // index (migration 0024), not just application logic.
    const activeRows = await db.sql`SELECT count(*)::int AS n FROM card_assignments
      WHERE card_id = ${cardId} AND status = 'ACTIVE'`;
    assert.equal((activeRows[0] as { n: number }).n, 1);
  });
});

describe('card provisioning lifecycle end-to-end (PostgreSQL, RM2/D47)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let store: PostgresVinkStore;
  let provider: MockFinancialProvider;
  const stamp = Date.now();

  before(async () => {
    db = await createIsolatedTestDb('card_provisioning');
    provider = new MockFinancialProvider();
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      provider,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    store = new PostgresVinkStore(db.sql);
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  function ctx() {
    return { uow: store, clock: { now: () => new Date() }, correlationId: randomUUID(), provider };
  }

  /** A pool `cards` row whose `provider_card_id` refers to a REAL mock provider card
   * (via `issueTemporaryCard`), disabled right after issuance — D47's "disabled by default"
   * resting state for a pool card, since `issueTemporaryCard` itself always activates (the
   * OLD one-shot-card contract this fixture deliberately doesn't inherit). */
  async function seedRealCard(): Promise<string> {
    const { providerCardholderId } = await provider.createCardholder({
      idempotencyKey: `cardholder:it:${randomUUID()}`,
      externalAccountId: 'vinkin-financial-account',
      legalName: 'VinkIn Inc',
    });
    const issued = await provider.issueTemporaryCard({
      idempotencyKey: `issue:it:${randomUUID()}`,
      providerCardholderId,
      spendLimit: { amountMinor: 100_000, currency: 'USD' },
      metadata: {},
    });
    await provider.disableCard(issued.providerCardId);
    const id = randomUUID();
    await db.sql`INSERT INTO cards (id, provider_card_id, display_last_four, status)
      VALUES (${id}, ${issued.providerCardId}, '4242', 'AVAILABLE')`;
    return id;
  }

  async function createRealVink(username: string): Promise<VinkId> {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: username, password: 'integration-password-1' },
    });
    const accessToken = registered.json().accessToken as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 5_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: username,
      },
    });
    return created.json().vink.id as VinkId;
  }

  it('THE FULL RE-ASSIGNMENT SCENARIO, against real PostgreSQL + the real provider interface: Card A serves Vink 1, is fully torn down, then genuinely serves Vink 2 — Token 1 can never authorize again', async () => {
    const cardId = await seedRealCard();
    const cardRow = await db.sql`SELECT provider_card_id FROM cards WHERE id = ${cardId}`;
    const providerCardId = (cardRow[0] as { provider_card_id: string }).provider_card_id;

    const vink1 = await createRealVink(`rm2_reassign_a_${stamp}`);
    const vink2 = await createRealVink(`rm2_reassign_b_${stamp}`);

    // Assign Card A to Vink 1 -> enable -> provision Token 1.
    const assignment1 = await reserveCardFromPoolCommand(ctx(), {
      vinkId: vink1,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });
    assert.equal(assignment1.cardId, cardId);
    await enableCardCommand(ctx(), { cardAssignmentId: assignment1.id });
    assert.equal((await provider.getCardStatus(providerCardId)).status, 'ACTIVE');
    const ready1 = await provisionWalletTokenCommand(ctx(), {
      cardAssignmentId: assignment1.id,
      walletType: 'APPLE_PAY',
    });
    assert.equal(ready1.provisioningStatus, 'READY_TO_PAY');
    const token1Row = await db.sql`SELECT provider_token_id FROM card_wallet_tokens
      WHERE card_assignment_id = ${assignment1.id}`;
    const token1Id = (token1Row[0] as { provider_token_id: string }).provider_token_id;
    assert.equal((await provider.getWalletToken(token1Id)).status, 'ACTIVE');

    // Disable -> revoke Token 1 -> return Card A to the pool.
    await disableCardCommand(ctx(), { cardAssignmentId: assignment1.id });
    assert.equal((await provider.getCardStatus(providerCardId)).status, 'INACTIVE');
    const sanitized1 = await revokeWalletTokenCommand(ctx(), {
      cardAssignmentId: assignment1.id,
    });
    assert.equal(sanitized1.provisioningStatus, 'SANITIZED');
    assert.equal((await provider.getWalletToken(token1Id)).status, 'REVOKED');
    const returned1 = await returnCardToPoolCommand(ctx(), { cardAssignmentId: assignment1.id });
    assert.equal(returned1.status, 'RETURNED');
    const cardStatusRow = await db.sql`SELECT status FROM cards WHERE id = ${cardId}`;
    assert.equal((cardStatusRow[0] as { status: string }).status, 'AVAILABLE');

    // Assign the SAME underlying Card A to Vink 2 -> enable -> provision Token 2.
    const assignment2 = await reserveCardFromPoolCommand(ctx(), {
      vinkId: vink2,
      spendingLimitMinor: 3_000,
      usageWindowSeconds: 600,
    });
    assert.equal(assignment2.cardId, cardId, 'the same physical card is genuinely reused');
    assert.notEqual(assignment2.id, assignment1.id);
    await enableCardCommand(ctx(), { cardAssignmentId: assignment2.id });
    const ready2 = await provisionWalletTokenCommand(ctx(), {
      cardAssignmentId: assignment2.id,
      walletType: 'GOOGLE_PAY',
    });
    assert.equal(ready2.provisioningStatus, 'READY_TO_PAY');
    const token2Row = await db.sql`SELECT provider_token_id FROM card_wallet_tokens
      WHERE card_assignment_id = ${assignment2.id}`;
    const token2Id = (token2Row[0] as { provider_token_id: string }).provider_token_id;
    assert.notEqual(token2Id, token1Id);

    // THE ACTUAL PROOF, against the real provider interface + real PostgreSQL rows: Token 1
    // is dead forever; Token 2 is the only valid token for Card A.
    assert.equal((await provider.getWalletToken(token1Id)).status, 'REVOKED');
    assert.equal((await provider.getWalletToken(token2Id)).status, 'ACTIVE');
    const allTokens = await provider.listWalletTokens(providerCardId);
    assert.equal(allTokens.length, 2);
    assert.equal(allTokens.find((t) => t.providerTokenId === token1Id)?.status, 'REVOKED');
    assert.equal(allTokens.find((t) => t.providerTokenId === token2Id)?.status, 'ACTIVE');

    // Exactly one ACTIVE card_assignments row for this card, per migration 0024's own
    // partial unique index — proven again here across a genuine reassignment, not just once.
    const activeRows = await db.sql`SELECT count(*)::int AS n FROM card_assignments
      WHERE card_id = ${cardId} AND status = 'ACTIVE'`;
    assert.equal((activeRows[0] as { n: number }).n, 1);
  });

  it('a genuinely ambiguous provider outcome (UNKNOWN_OUTCOME) quarantines the card in the real database', async () => {
    const cardId = await seedRealCard();
    const vinkId = await createRealVink(`rm2_quarantine_${stamp}`);
    const assignment = await reserveCardFromPoolCommand(ctx(), {
      vinkId,
      spendingLimitMinor: 5_000,
      usageWindowSeconds: 600,
    });

    provider.simulateUnknownOutcome(false);
    await assert.rejects(enableCardCommand(ctx(), { cardAssignmentId: assignment.id }));

    const cardRow = await db.sql`SELECT status FROM cards WHERE id = ${cardId}`;
    assert.equal((cardRow[0] as { status: string }).status, 'QUARANTINED');

    // The real safety property: a quarantined card is genuinely excluded from reservation —
    // not just flagged, structurally unreachable via the same query every real reservation
    // uses.
    const otherVink = await createRealVink(`rm2_q_other_${stamp}`);
    await assert.rejects(
      reserveCardFromPoolCommand(ctx(), {
        vinkId: otherVink,
        spendingLimitMinor: 1_000,
        usageWindowSeconds: 600,
      }),
      /pool/i,
    );
  });
});
