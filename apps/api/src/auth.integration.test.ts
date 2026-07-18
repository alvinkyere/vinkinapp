/**
 * Auth integration suite — requires real PostgreSQL (docker compose up / CI services).
 * Skipped unless VINKIN_INTEGRATION=1; CI sets it with service containers.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('auth end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: ReturnType<typeof buildApp>;
  const username = `it_user_${Date.now()}`;

  before(async () => {
    db = await createIsolatedTestDb('auth');
    app = buildApp({
      env: db.env,
      sql: db.sql,
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

  it('register → me → refresh (rotation) → reuse detection → logout', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: 'Integration User', password: 'integration-password-1' },
    });
    assert.equal(registered.statusCode, 201);
    const { accessToken, refreshToken, user } = registered.json();
    assert.equal(user.username, username);

    // Duplicate username is a 409, not a 500.
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: 'Dup', password: 'integration-password-1' },
    });
    assert.equal(duplicate.statusCode, 409);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.id, user.id);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: 'integration-password-1' },
    });
    assert.equal(login.statusCode, 200);
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: 'wrong-password-entirely' },
    });
    assert.equal(badLogin.statusCode, 401);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    assert.equal(refreshed.statusCode, 200);
    const rotated = refreshed.json().refreshToken;
    assert.notEqual(rotated, refreshToken);

    // Reusing the rotated-out token is rejected AND kills the successor session too.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    assert.equal(reuse.statusCode, 401);
    // Regression (PV3 defect #1): the family revocation must SURVIVE the 401 — it used to
    // be rolled back because the error was thrown inside the transaction. Verify in the DB
    // that no live session remains for this user before even trying token B.
    const liveSessions = await db.sql`
      SELECT count(*)::int AS n FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE u.username = ${username} AND s.revoked_at IS NULL`;
    assert.equal((liveSessions[0] as { n: number }).n, 0);
    const afterReuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: rotated },
    });
    assert.equal(afterReuse.statusCode, 401);

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: 'integration-password-1' },
    });
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: relogin.json().refreshToken },
    });
    assert.equal(logout.statusCode, 204);
    const refreshAfterLogout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: relogin.json().refreshToken },
    });
    assert.equal(refreshAfterLogout.statusCode, 401);
  });

  it('rejects invalid request bodies with 400 VALIDATION_FAILED', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'x', password: 'short' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'VALIDATION_FAILED');
  });
});
