/**
 * Recovery + failed-session refunds end-to-end — the PV7 exit gate ("every failed or
 * adjusted financial path reaches an explicit, observable state"). Real PostgreSQL;
 * VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runSweeps } from './jobs/sweeps.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('recovery + refunds end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let provider: MockFinancialProvider;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const stamp = Date.now();
  const users = {
    organizer: `pv7_org_${stamp}`,
    memberA: `pv7_a_${stamp}`,
    memberB: `pv7_b_${stamp}`,
  };
  const tokens: Record<string, string> = {};

  function authed(who: keyof typeof users) {
    return { authorization: `Bearer ${tokens[who]}` };
  }

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
    return vinkId;
  }

  /** Fund → provision → settle over the approved amount → RECOVERY_REQUIRED. */
  async function overageVink(): Promise<string> {
    const vinkId = await fundedVink();
    await runSweeps(db.sql, provider); // provisions the card
    const auth = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/merchant-authorizations`,
      payload: {
        merchantName: 'Grocer',
        merchantIdentifier: 'GROCER-1',
        mcc: '5411',
        amountMinor: 12_000,
      },
    });
    const authorizationId = auth.json().authorizationId as string;
    const providerAuthorizationId = auth.json().providerAuthorizationId as string;
    await app.inject({
      method: 'POST',
      url: `/internal/simulator/authorizations/${authorizationId}/capture`,
      payload: { vinkId, providerAuthorizationId, settledAmountMinor: 13_500 },
    });
    assert.equal(
      (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
      'RECOVERY_REQUIRED',
    );
    return vinkId;
  }

  async function ledgerBalanced(): Promise<boolean> {
    const totals = await db.sql`
      SELECT COALESCE(SUM(amount_minor) FILTER (WHERE direction='DEBIT'),0)::int AS d,
             COALESCE(SUM(amount_minor) FILTER (WHERE direction='CREDIT'),0)::int AS c
      FROM ledger_entries`;
    const { d, c } = totals[0] as { d: number; c: number };
    return d === c;
  }

  before(async () => {
    db = await createIsolatedTestDb('recovery');
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

  it('E7: overage → recovery obligation → organizer charged → COMPLETED; participants untouched', async () => {
    const vinkId = await overageVink();
    const start = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/recovery/start`,
      payload: {},
    });
    assert.equal(start.statusCode, 200);
    assert.equal(start.json().outcome, 'RESOLVED');
    assert.equal(start.json().vinkState, 'COMPLETED');
    assert.equal(start.json().amountMinor, 1_500);

    assert.equal(
      (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
      'COMPLETED',
    );
    const obligation =
      await db.sql`SELECT status FROM recovery_obligations WHERE vink_id = ${vinkId}`;
    assert.equal(obligation[0]!.status, 'RESOLVED');
    // Participants were not recharged.
    const contribStatuses =
      await db.sql`SELECT DISTINCT status FROM contributions WHERE vink_id = ${vinkId}`;
    assert.deepEqual(
      contribStatuses.map((r) => r.status),
      ['CAPTURED'],
    );
    assert.ok(await ledgerBalanced());

    // The organizer snapshot exposes the resolved recovery.
    const snapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}`,
      headers: authed('organizer'),
    });
    assert.equal(snapshot.json().recovery.status, 'RESOLVED');
    assert.equal(snapshot.json().recovery.amountMinor, 1_500);
  });

  it('declined recovery retries to DEFAULT → RESTRICTED, ledger balanced', async () => {
    const vinkId = await overageVink();
    let res = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/recovery/start`,
      payload: { scenario: 'DECLINE' },
    });
    assert.equal(res.json().outcome, 'RETRY_SCHEDULED');
    for (let i = 0; i < 1; i += 1) {
      res = await app.inject({
        method: 'POST',
        url: `/internal/simulator/vinks/${vinkId}/recovery/retry`,
        payload: { scenario: 'DECLINE' },
      });
      assert.equal(res.json().outcome, 'RETRY_SCHEDULED');
    }
    res = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/recovery/retry`,
      payload: { scenario: 'DECLINE' },
    });
    assert.equal(res.json().outcome, 'DEFAULTED');
    assert.equal(res.json().vinkState, 'RESTRICTED');
    assert.equal(
      (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
      'RESTRICTED',
    );
    assert.ok(await ledgerBalanced());
  });

  it('E8: failed-session refund with a provider failure → REFUND_FAILED → retry → REFUNDED', async () => {
    const vinkId = await fundedVink();
    // Card issuance fails → the vink reverses to EXPIRED with CAPTURED contributions.
    provider.simulateTransientFailure();
    await runSweeps(db.sql, provider);
    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'EXPIRED');

    // The first refund attempt fails transiently.
    provider.simulateTransientFailure();
    const refund = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/refund-failed-session`,
      payload: {},
    });
    assert.equal(refund.statusCode, 200);
    assert.equal(refund.json().failed, 1);
    assert.equal(refund.json().refunded, 1);

    const failed =
      await db.sql`SELECT id FROM contributions WHERE vink_id = ${vinkId} AND status = 'REFUND_FAILED'`;
    assert.equal(failed.length, 1);

    const retry = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/contributions/${failed[0]!.id}/retry-refund`,
      payload: {},
    });
    assert.equal(retry.json().status, 'REFUNDED');
    const statuses =
      await db.sql`SELECT status FROM contributions WHERE vink_id = ${vinkId} ORDER BY status`;
    assert.deepEqual(
      statuses.map((r) => r.status),
      ['REFUNDED', 'REFUNDED'],
    );
    assert.ok(await ledgerBalanced());
  });
});
