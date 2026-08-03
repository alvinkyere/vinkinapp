/**
 * ENG5 Slice 4 — the full `POST /api/v1/auth/oauth/apple` route against real PostgreSQL, with
 * a real signed test token (local key pair injected as `appleKeyResolver`, same key-set
 * pattern `auth/apple-identity.test.ts` uses) — not just the crypto function in isolation.
 * Covers: new-account creation, returning-user login, account linking is keyed on Apple's
 * stable `sub` (never email), the fail-closed disabled/unconfigured paths, and a forged token
 * being rejected by the real route, not just the underlying verifier.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { APPLE_ISSUER } from './auth/apple-identity.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const CLIENT_ID = 'com.vinkin.vinkinMobile';

async function makeTestKeySet(): Promise<{
  keyResolver: JWTVerifyGetKey;
  privateKey: CryptoKey;
}> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const keyResolver = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] });
  return { keyResolver, privateKey };
}

async function signTestToken(
  privateKey: CryptoKey,
  claims: { sub: string; email?: string; audience?: string },
): Promise<string> {
  return new SignJWT(claims.email !== undefined ? { email: claims.email } : {})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(APPLE_ISSUER)
    .setAudience(claims.audience ?? CLIENT_ID)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('3600s')
    .sign(privateKey);
}

describe('Sign in with Apple (PostgreSQL, ENG5 Slice 4)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let keyResolver: JWTVerifyGetKey;
  let privateKey: CryptoKey;

  before(async () => {
    db = await createIsolatedTestDb('apple_sign_in');
    ({ keyResolver, privateKey } = await makeTestKeySet());
    app = await buildApp({
      env: {
        ...db.env,
        VINKIN_APPLE_SIGN_IN_ENABLED: '1',
        APPLE_SIGN_IN_CLIENT_ID: CLIENT_ID,
      },
      sql: db.sql,
      appleKeyResolver: keyResolver,
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

  it('a first sign-in creates a real account, issues a real session, and marks the provided email verified', async () => {
    const token = await signTestToken(privateKey, {
      sub: 'apple-sub-1',
      email: 'newuser@example.com',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/apple',
      payload: { identityToken: token, givenName: 'Ada', familyName: 'Lovelace' },
    });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.isNewUser, true);
    assert.equal(body.user.email, 'newuser@example.com');
    assert.equal(body.user.emailVerified, true);
    assert.equal(body.user.displayName, 'Ada Lovelace');
    assert.ok(typeof body.accessToken === 'string');
    assert.ok(typeof body.refreshToken === 'string');

    // The issued access token genuinely authenticates.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.id, body.user.id);
  });

  it('a repeat sign-in with the same sub logs into the SAME account, even with no email this time', async () => {
    const firstToken = await signTestToken(privateKey, {
      sub: 'apple-sub-2',
      email: 'repeat@example.com',
    });
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/apple',
      payload: { identityToken: firstToken },
    });
    assert.equal(first.statusCode, 201);
    const firstUserId = first.json().user.id;

    // Apple omits the email claim on repeat sign-ins in practice — same sub, no email.
    const secondToken = await signTestToken(privateKey, { sub: 'apple-sub-2' });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/apple',
      payload: { identityToken: secondToken },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().isNewUser, false);
    assert.equal(second.json().user.id, firstUserId);
    // The original account's email is untouched by a no-email repeat sign-in.
    assert.equal(second.json().user.email, 'repeat@example.com');
  });

  it('a second, DIFFERENT Apple identity reporting an email already on a VinkIn account is rejected, not silently merged or crashed', async () => {
    const tokenA = await signTestToken(privateKey, {
      sub: 'apple-sub-3a',
      email: 'shared@example.com',
    });
    const tokenB = await signTestToken(privateKey, {
      sub: 'apple-sub-3b',
      email: 'shared@example.com',
    });

    const a = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/apple',
      payload: { identityToken: tokenA },
    });
    assert.equal(a.statusCode, 201);

    const b = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/apple',
      payload: { identityToken: tokenB },
    });
    assert.equal(b.statusCode, 409);
    assert.equal(b.json().error, 'EMAIL_ALREADY_REGISTERED');
  });

  it('a forged token (wrong signing key) is rejected by the real route, not a 500', async () => {
    const { privateKey: attackerKey } = await makeTestKeySet();
    const forged = await signTestToken(attackerKey, { sub: 'apple-sub-4' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/apple',
      payload: { identityToken: forged },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'INVALID_APPLE_TOKEN');
  });

  it('a malformed request body is a validation error, not a crash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/apple',
      payload: {},
    });
    assert.equal(response.statusCode, 400);
  });

  it('fails closed (503) when the feature flag is off, even with a genuinely valid token', async () => {
    const disabledDb = await createIsolatedTestDb('apple_sign_in_flag_off');
    const disabledApp = await buildApp({
      env: { ...disabledDb.env, VINKIN_APPLE_SIGN_IN_ENABLED: '0' },
      sql: disabledDb.sql,
      appleKeyResolver: keyResolver,
      checkDb: async () => {
        await disabledDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const token = await signTestToken(privateKey, { sub: 'apple-sub-5' });
      const response = await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/apple',
        payload: { identityToken: token },
      });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error, 'APPLE_SIGN_IN_DISABLED');
    } finally {
      await disabledApp.close();
      await disabledDb.drop();
    }
  });

  it('fails closed (503) when the flag is on but no client id is configured — never accepts an unconfigured audience', async () => {
    const unconfiguredDb = await createIsolatedTestDb('apple_sign_in_unconfigured');
    const unconfiguredApp = await buildApp({
      env: { ...unconfiguredDb.env, VINKIN_APPLE_SIGN_IN_ENABLED: '1' },
      sql: unconfiguredDb.sql,
      appleKeyResolver: keyResolver,
      checkDb: async () => {
        await unconfiguredDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const token = await signTestToken(privateKey, { sub: 'apple-sub-6' });
      const response = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/apple',
        payload: { identityToken: token },
      });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error, 'APPLE_SIGN_IN_DISABLED');
    } finally {
      await unconfiguredApp.close();
      await unconfiguredDb.drop();
    }
  });
});
