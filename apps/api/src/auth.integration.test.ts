/**
 * Auth integration suite — requires real PostgreSQL (docker compose up / CI services).
 * Skipped unless VINKIN_INTEGRATION=1; CI sets it with service containers.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('auth end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const username = `it_user_${Date.now()}`;

  before(async () => {
    db = await createIsolatedTestDb('auth');
    app = await buildApp({
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

  it('ENG9 #16: a refresh token past its real expires_at is rejected as INVALID, distinct from reuse detection', async () => {
    // Deliberately distinct from the reuse-detection test above: this token is NEVER rotated
    // or reused — it is a genuinely still-valid, never-consumed session whose expires_at has
    // simply passed. Ages the row directly rather than waiting REFRESH_TOKEN_TTL_SECONDS
    // (30 days) of real wall-clock time.
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `expiry_${Date.now()}`,
        displayName: 'Expiry Test',
        password: 'integration-password-1',
      },
    });
    assert.equal(registered.statusCode, 201);
    const { refreshToken } = registered.json();

    await db.sql`UPDATE auth_sessions SET expires_at = now() - interval '1 second'
      WHERE refresh_token_hash = ${createHash('sha256').update(refreshToken).digest('hex')}`;

    const expired = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    assert.equal(expired.statusCode, 401);
  });

  it('ENG9 #16: an access token past its real JWT exp claim is rejected, not silently accepted', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: `access_expiry_${Date.now()}`,
        displayName: 'Access Expiry Test',
        password: 'integration-password-1',
      },
    });
    assert.equal(registered.statusCode, 201);
    const { user } = registered.json();

    // Constructed with the app's own real JWT_SECRET and the exact same claim shape
    // `signAccessToken` produces — only `exp` is deliberately backdated, proving
    // `verifyAccessToken`'s real jose expiry check, not a mocked clock.
    const expiredAccessToken = await new SignJWT({ sid: 'irrelevant-session-id' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('vinkin-api')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(db.env.JWT_SECRET));

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${expiredAccessToken}` },
    });
    assert.equal(me.statusCode, 401);
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

  it('Slice I4: registration captures phone (users.phone existed since PV1 but was never wired)', async () => {
    const phoneUsername = `it_phone_${Date.now()}`;
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: phoneUsername,
        displayName: 'Phone User',
        phone: '+1 555-0100',
        password: 'integration-password-1',
      },
    });
    assert.equal(registered.statusCode, 201);
    assert.equal(registered.json().user.phone, '+1 555-0100');

    const dbRow = await db.sql`SELECT phone FROM users WHERE username = ${phoneUsername}`;
    assert.equal((dbRow[0] as { phone: string }).phone, '+1 555-0100');
  });

  it('Slice I4: PATCH /api/v1/me lets a signed-in user set/change/clear their contact info', async () => {
    const patchUsername = `it_patch_${Date.now()}`;
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: patchUsername,
        displayName: 'Patch User',
        password: 'integration-password-1',
      },
    });
    const { accessToken } = registered.json();
    assert.equal(registered.json().user.email, null);

    const setEmail = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { email: 'patch-user@example.com' },
    });
    assert.equal(setEmail.statusCode, 200);
    assert.equal(setEmail.json().user.email, 'patch-user@example.com');
    // Omitted field (phone) is left unchanged, not wiped to null.
    assert.equal(setEmail.json().user.phone, null);

    const setPhone = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { phone: '+1 555-0199' },
    });
    assert.equal(setPhone.statusCode, 200);
    assert.equal(setPhone.json().user.phone, '+1 555-0199');
    // The earlier email set is still there — this PATCH only touched phone.
    assert.equal(setPhone.json().user.email, 'patch-user@example.com');

    const clearEmail = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { email: null },
    });
    assert.equal(clearEmail.statusCode, 200);
    assert.equal(clearEmail.json().user.email, null);
    assert.equal(clearEmail.json().user.phone, '+1 555-0199');

    const unauthenticated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      payload: { email: 'nope@example.com' },
    });
    assert.equal(unauthenticated.statusCode, 401);
  });
});
