/**
 * ENG8 ("audit-log protection") — proves migration 0023's new DB-level append-only triggers
 * for the three audit/history tables that, unlike the ledger (0004's
 * `ledger_entries_append_only`, already tested in contributions.integration.test.ts),
 * previously relied on "no application code ever updates or deletes a row" as an unenforced
 * convention rather than a real guarantee. Rows are created through the real app (not
 * hand-crafted SQL) so every domain CHECK constraint is satisfied for free.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('audit/history tables are DB-level append-only (PostgreSQL, ENG8)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const stamp = Date.now();

  before(async () => {
    db = await createIsolatedTestDb('audit_immutability');
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

  it('vink_state_history and contribution_status_history refuse UPDATE and DELETE', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `eng8_immut_org_${stamp}`,
        displayName: 'Organizer',
        password: 'integration-password-1',
      },
    });
    const organizerToken = registered.json().accessToken as string;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `eng8_immut_mem_${stamp}`,
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
      payload: { username: `eng8_immut_mem_${stamp}` },
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

    const vshRows =
      await db.sql`SELECT id FROM vink_state_history WHERE vink_id = ${vinkId} LIMIT 1`;
    assert.equal(vshRows.length, 1, 'expected at least one vink_state_history row to exist');
    await assert.rejects(
      db.sql`UPDATE vink_state_history SET event = 'HACKED' WHERE id = ${(vshRows[0] as { id: string }).id}`,
      /append-only/,
    );
    await assert.rejects(
      db.sql`DELETE FROM vink_state_history WHERE id = ${(vshRows[0] as { id: string }).id}`,
      /append-only/,
    );

    const cshRows = await db.sql`
      SELECT csh.id FROM contribution_status_history csh
      JOIN contributions c ON c.id = csh.contribution_id
      WHERE c.vink_id = ${vinkId} LIMIT 1
    `;
    assert.equal(cshRows.length, 1, 'expected at least one contribution_status_history row');
    await assert.rejects(
      db.sql`UPDATE contribution_status_history SET event = 'HACKED' WHERE id = ${(cshRows[0] as { id: string }).id}`,
      /append-only/,
    );
    await assert.rejects(
      db.sql`DELETE FROM contribution_status_history WHERE id = ${(cshRows[0] as { id: string }).id}`,
      /append-only/,
    );
  });

  it('operator_audit_log refuses UPDATE and DELETE', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/internal/ops/auth/login',
      payload: { operatorName: 'ENG8 Immutability Operator', password: db.env.OPERATOR_PASSWORD },
    });
    const operatorToken = login.json().operatorToken as string;
    const runResponse = await app.inject({
      method: 'POST',
      url: '/internal/ops/reconciliation/run',
      headers: authed(operatorToken),
    });
    assert.equal(runResponse.statusCode, 200);

    const rows = await db.sql`
      SELECT id FROM operator_audit_log
      WHERE action = 'RECONCILIATION_RUN_TRIGGERED' ORDER BY seq DESC LIMIT 1
    `;
    assert.equal(rows.length, 1);
    await assert.rejects(
      db.sql`UPDATE operator_audit_log SET action = 'HACKED' WHERE id = ${(rows[0] as { id: string }).id}`,
      /append-only/,
    );
    await assert.rejects(
      db.sql`DELETE FROM operator_audit_log WHERE id = ${(rows[0] as { id: string }).id}`,
      /append-only/,
    );
  });

  it('migration 0023 created the vinkin_app role with SELECT/INSERT/UPDATE only — no DELETE, no DDL', async () => {
    const [role] =
      await db.sql`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'vinkin_app'`;
    assert.ok(role !== undefined, 'vinkin_app role should exist');
    assert.equal((role as { rolcanlogin: boolean }).rolcanlogin, true);

    const grants = await db.sql`
      SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'vinkin_app' AND table_name = 'vinks'
    `;
    const privileges = grants.map((g) => (g as { privilege_type: string }).privilege_type).sort();
    assert.deepEqual(privileges, ['INSERT', 'SELECT', 'UPDATE']);
  });
});
