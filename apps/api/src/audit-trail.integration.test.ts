/**
 * ENG7 ("Observability and auditability") — proves the three real audit-trail gaps the
 * roadmap's own audit found, against real PostgreSQL: `createVinkCommand`/`setSplitCommand`
 * now write a `vink_state_history` row (previously neither wrote to any audit mechanism at
 * all); `contribution_status_history` now carries `provider_reference`; `operator_audit_log`
 * now carries `correlation_id`.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('audit trail completion (PostgreSQL, ENG7)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const stamp = Date.now();

  before(async () => {
    db = await createIsolatedTestDb('audit_trail');
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      provider: new MockFinancialProvider(),
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  function authed(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('createVink and setSplit each write a real vink_state_history row (previously wrote to neither audit mechanism)', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `eng7_audit_org_${stamp}`,
        displayName: 'Organizer',
        password: 'integration-password-1',
      },
    });
    const organizerToken = registered.json().accessToken as string;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `eng7_audit_mem_${stamp}`,
        displayName: 'Member',
        password: 'integration-password-1',
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed(organizerToken),
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 4_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: authed(organizerToken),
      payload: { username: `eng7_audit_mem_${stamp}` },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: authed(organizerToken),
      payload: { method: 'EQUAL' },
    });

    const rows = await db.sql`
      SELECT event, from_state, to_state, actor, correlation_id FROM vink_state_history
      WHERE vink_id = ${vinkId} ORDER BY seq ASC`;
    const events = rows.map((row) => row.event as string);
    assert.deepEqual(events, ['VINK_CREATED', 'SPLIT_CONFIGURED']);
    for (const row of rows) {
      assert.equal(typeof row.actor, 'string');
      assert.equal(typeof row.correlation_id, 'string');
    }
    assert.equal(rows[0]!.from_state, 'NONE');
    assert.equal(rows[0]!.to_state, 'DRAFT');
  });

  it("a captured contribution's status-history row carries the real provider_reference", async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `eng7_pref_org_${stamp}`,
        displayName: 'Organizer',
        password: 'integration-password-1',
      },
    });
    const organizerToken = registered.json().accessToken as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `eng7_pref_mem_${stamp}`,
        displayName: 'Member',
        password: 'integration-password-1',
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed(organizerToken),
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 2_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: authed(organizerToken),
      payload: { username: `eng7_pref_mem_${stamp}` },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: authed(organizerToken),
      payload: { method: 'EQUAL' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: authed(organizerToken),
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed(organizerToken),
    });

    const rows = await db.sql`
      SELECT csh.provider_reference
      FROM contribution_status_history csh
      JOIN contributions c ON c.id = csh.contribution_id
      WHERE c.vink_id = ${vinkId} AND csh.event = 'AUTHORIZATION_APPROVED'`;
    assert.equal(rows.length, 1);
    assert.equal(typeof rows[0]!.provider_reference, 'string');
    assert.ok((rows[0]!.provider_reference as string).length > 0);
  });

  it("an operator action's audit_log row carries a real correlation_id", async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/internal/ops/auth/login',
      payload: { operatorName: 'ENG7 Operator', password: db.env.OPERATOR_PASSWORD },
    });
    const operatorToken = login.json().operatorToken as string;

    const runResponse = await app.inject({
      method: 'POST',
      url: '/internal/ops/reconciliation/run',
      headers: authed(operatorToken),
    });
    assert.equal(runResponse.statusCode, 200);

    const rows = await db.sql`
      SELECT correlation_id FROM operator_audit_log
      WHERE action = 'RECONCILIATION_RUN_TRIGGERED' ORDER BY seq DESC LIMIT 1`;
    assert.equal(rows.length, 1);
    assert.equal(typeof rows[0]!.correlation_id, 'string');
    assert.ok((rows[0]!.correlation_id as string).length > 0);
  });
});
