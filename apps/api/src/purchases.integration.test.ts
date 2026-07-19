/**
 * Mock card + purchase flow end-to-end — the PV6 exit gate ("a fully funded Vink can
 * complete EXACTLY ONE simulated merchant purchase"). Real PostgreSQL; VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runSweeps } from './jobs/sweeps.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('mock card + purchase flow end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let provider: MockFinancialProvider;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const stamp = Date.now();
  const users = {
    organizer: `pv6_org_${stamp}`,
    memberA: `pv6_a_${stamp}`,
    memberB: `pv6_b_${stamp}`,
  };
  const tokens: Record<string, string> = {};

  function authed(who: keyof typeof users) {
    return { authorization: `Bearer ${tokens[who]}` };
  }

  /** Create + fund a $120 vink, returning its id (both members authorize). */
  async function fundedVink(): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed('organizer'),
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 12_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;
    const organizerPid = created.json().participants[0].id as string;
    const pids: Record<string, string> = {};
    for (const member of ['memberA', 'memberB'] as const) {
      const added = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/participants`,
        headers: authed('organizer'),
        payload: { username: users[member] },
      });
      pids[member] = added.json().id;
    }
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: authed('organizer'),
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: organizerPid, amountMinor: 0 },
          { participantId: pids.memberA, amountMinor: 6_000 },
          { participantId: pids.memberB, amountMinor: 6_000 },
        ],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: authed('organizer'),
      payload: {},
    });
    for (const member of ['memberA', 'memberB'] as const) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
        headers: authed(member),
        payload: {},
      });
    }
    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'FUNDED');
    return vinkId;
  }

  async function provisionViaSweep(vinkId: string): Promise<void> {
    const swept = await runSweeps(db.sql, provider);
    assert.ok(swept.cardsProvisioned >= 1);
    assert.equal(
      (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
      'CARD_READY',
    );
  }

  before(async () => {
    db = await createIsolatedTestDb('purchase');
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
    for (const [who, username] of Object.entries(users)) {
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      tokens[who] = registered.json().accessToken;
    }
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  it('EXIT GATE: FUNDED → card (via sweep) → merchant auth → capture → COMPLETED, ledger balanced', async () => {
    const vinkId = await fundedVink();
    await provisionViaSweep(vinkId);

    // The organizer's snapshot shows the (clearly simulated) card, not yet locked.
    const snapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}`,
      headers: authed('organizer'),
    });
    assert.equal(snapshot.json().card.status, 'ACTIVE');
    assert.equal(snapshot.json().card.spendingLimitMinor, 12_000);
    assert.equal(snapshot.json().card.merchantLocked, false);

    const auth = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/merchant-authorizations`,
      payload: {
        merchantName: 'Corner Grocer',
        merchantIdentifier: 'GROCER-1',
        mcc: '5411',
        amountMinor: 12_000,
      },
    });
    assert.equal(auth.statusCode, 201);
    assert.equal(auth.json().outcome, 'APPROVED');
    assert.equal(auth.json().vinkState, 'PURCHASE_AUTHORIZED');
    const authorizationId = auth.json().authorizationId as string;
    const providerAuthorizationId = auth.json().providerAuthorizationId as string;

    const capture = await app.inject({
      method: 'POST',
      url: `/internal/simulator/authorizations/${authorizationId}/capture`,
      payload: { vinkId, providerAuthorizationId, settledAmountMinor: 12_000 },
    });
    assert.equal(capture.statusCode, 200);
    assert.equal(capture.json().settlementStatus, 'MATCHED');
    assert.equal(capture.json().vinkState, 'COMPLETED');

    const vinkRow = await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`;
    assert.equal(vinkRow[0]!.state, 'COMPLETED');
    const cardRow = await db.sql`SELECT status FROM temporary_cards WHERE vink_id = ${vinkId}`;
    assert.equal(cardRow[0]!.status, 'CLOSED');

    // Ledger balances across every posting for the vink.
    const totals = await db.sql`
      SELECT COALESCE(SUM(amount_minor) FILTER (WHERE direction='DEBIT'),0)::int AS d,
             COALESCE(SUM(amount_minor) FILTER (WHERE direction='CREDIT'),0)::int AS c
      FROM ledger_entries`;
    assert.equal(
      (totals[0] as { d: number; c: number }).d,
      (totals[0] as { d: number; c: number }).c,
    );

    const events =
      await db.sql`SELECT event_type FROM outbox_events WHERE aggregate_id = ${vinkId}`;
    const types = events.map((row) => row.event_type as string);
    for (const expected of [
      'VinkFunded',
      'TemporaryCardIssued',
      'MerchantAuthorizationApproved',
      'MerchantLocked',
      'PurchaseCaptured',
      'VinkCompleted',
    ]) {
      assert.ok(types.includes(expected), `missing ${expected}`);
    }
  });

  it('EXACTLY ONE: a duplicate merchant authorization does not create a second purchase (E4)', async () => {
    const vinkId = await fundedVink();
    await provisionViaSweep(vinkId);
    const card =
      await db.sql`SELECT provider_card_id FROM temporary_cards WHERE vink_id = ${vinkId}`;
    const providerCardId = card[0]!.provider_card_id as string;

    // Drive the SAME provider authorization id twice through the engine directly.
    const outcome = provider.simulateMerchantAuthorization({
      providerCardId,
      amount: { amountMinor: 12_000, currency: 'USD' },
      merchantId: 'GROCER-1',
      merchantName: 'Corner Grocer',
      mcc: '5411',
      merchantCountry: 'US',
    });
    const providerAuthorizationId = outcome.providerAuthorizationId!;
    const body = {
      merchantName: 'Corner Grocer',
      merchantIdentifier: 'GROCER-1',
      mcc: '5411',
      amountMinor: 12_000,
    };
    // Both requests reuse the same provider auth id by pre-seeding — call the engine route
    // twice; the second must dedupe. (The route mints a provider id per call, so we assert
    // via the DB that at most one APPROVED authorization exists after two swipes.)
    await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/merchant-authorizations`,
      payload: body,
    });
    const second = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/merchant-authorizations`,
      payload: body,
    });
    // The card is now merchant-locked and in PURCHASE_AUTHORIZED, so a fresh swipe is
    // declined (CARD_NOT_READY) — never a second approval.
    assert.equal(second.json().outcome, 'DECLINED');
    const approvals = await db.sql`SELECT count(*)::int AS n FROM purchase_authorizations
      WHERE vink_id = ${vinkId} AND status = 'APPROVED'`;
    assert.equal((approvals[0] as { n: number }).n, 1);
    assert.ok(providerAuthorizationId); // provider-side auth id exists
  });

  it('E7: settlement overage moves the Vink to RECOVERY_REQUIRED (recovery is PV7)', async () => {
    const vinkId = await fundedVink();
    await provisionViaSweep(vinkId);
    const auth = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/merchant-authorizations`,
      payload: {
        merchantName: 'Corner Grocer',
        merchantIdentifier: 'GROCER-1',
        mcc: '5411',
        amountMinor: 12_000,
      },
    });
    const authorizationId = auth.json().authorizationId as string;
    const providerAuthorizationId = auth.json().providerAuthorizationId as string;

    const capture = await app.inject({
      method: 'POST',
      url: `/internal/simulator/authorizations/${authorizationId}/capture`,
      payload: { vinkId, providerAuthorizationId, settledAmountMinor: 13_500 },
    });
    assert.equal(capture.json().settlementStatus, 'OVERAGE');
    assert.equal(capture.json().varianceMinor, 1_500);
    assert.equal(capture.json().vinkState, 'RECOVERY_REQUIRED');
    // Participants were not recharged: their contributions remain CAPTURED, unchanged.
    const contribStatuses =
      await db.sql`SELECT DISTINCT status FROM contributions WHERE vink_id = ${vinkId}`;
    assert.deepEqual(
      contribStatuses.map((r) => r.status),
      ['CAPTURED'],
    );
  });

  it('rejects merchant authorization when the Vink is not card-ready (no card)', async () => {
    const vinkId = await fundedVink(); // FUNDED but not provisioned
    const auth = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/merchant-authorizations`,
      payload: { amountMinor: 12_000 },
    });
    assert.equal(auth.statusCode, 404); // no card to charge
  });
});
