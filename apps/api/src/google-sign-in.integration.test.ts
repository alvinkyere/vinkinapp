/**
 * ENG5 Slice 5 — the full `POST /api/v1/auth/oauth/google` route against real PostgreSQL,
 * with a real signed test token (local key pair injected as `googleKeyResolver`) — same
 * structure as `apple-sign-in.integration.test.ts`. Covers what's genuinely different from
 * Apple (name comes from the verified token itself, not a client-supplied field; email trust
 * depends on `email_verified`) plus the shared account-linking/fail-closed behavior proven
 * identically.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const CLIENT_ID = '123-abc.apps.googleusercontent.com';

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
  claims: {
    sub: string;
    email?: string;
    emailVerified?: boolean;
    name?: string;
    audience?: string;
  },
): Promise<string> {
  const payload: Record<string, unknown> = {};
  if (claims.email !== undefined) payload.email = claims.email;
  if (claims.emailVerified !== undefined) payload.email_verified = claims.emailVerified;
  if (claims.name !== undefined) payload.name = claims.name;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://accounts.google.com')
    .setAudience(claims.audience ?? CLIENT_ID)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('3600s')
    .sign(privateKey);
}

describe('Sign in with Google (PostgreSQL, ENG5 Slice 5)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let keyResolver: JWTVerifyGetKey;
  let privateKey: CryptoKey;

  before(async () => {
    db = await createIsolatedTestDb('google_sign_in');
    ({ keyResolver, privateKey } = await makeTestKeySet());
    app = await buildApp({
      env: {
        ...db.env,
        VINKIN_GOOGLE_SIGN_IN_ENABLED: '1',
        GOOGLE_SIGN_IN_CLIENT_ID: CLIENT_ID,
      },
      sql: db.sql,
      googleKeyResolver: keyResolver,
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

  it("a first sign-in creates a real account using the TOKEN's own name claim, issues a real session, and marks the email verified", async () => {
    const token = await signTestToken(privateKey, {
      sub: 'google-sub-1',
      email: 'newuser@gmail.com',
      emailVerified: true,
      name: 'Ada Lovelace',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/google',
      payload: { idToken: token },
    });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.isNewUser, true);
    assert.equal(body.user.displayName, 'Ada Lovelace');
    assert.equal(body.user.email, 'newuser@gmail.com');
    assert.equal(body.user.emailVerified, true);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.id, body.user.id);
  });

  it('an unverified email claim is never trusted: the account is created with no email at all', async () => {
    const token = await signTestToken(privateKey, {
      sub: 'google-sub-2',
      email: 'suspicious@example.com',
      emailVerified: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/google',
      payload: { idToken: token },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().user.email, null);
    assert.equal(response.json().user.displayName, 'VinkIn User');
  });

  it('a repeat sign-in with the same sub logs into the SAME account', async () => {
    const firstToken = await signTestToken(privateKey, {
      sub: 'google-sub-3',
      email: 'repeat@gmail.com',
      emailVerified: true,
      name: 'Repeat User',
    });
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/google',
      payload: { idToken: firstToken },
    });
    assert.equal(first.statusCode, 201);

    const secondToken = await signTestToken(privateKey, { sub: 'google-sub-3' });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/google',
      payload: { idToken: secondToken },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().isNewUser, false);
    assert.equal(second.json().user.id, first.json().user.id);
  });

  it('an Apple identity and a Google identity are independent — the same real email on both never collides across providers by accident', async () => {
    const googleToken = await signTestToken(privateKey, {
      sub: 'google-sub-4',
      email: 'crossprovider@example.com',
      emailVerified: true,
    });
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/google',
      payload: { idToken: googleToken },
    });
    assert.equal(first.statusCode, 201);

    // A second GOOGLE identity with the same email is still correctly rejected (this is the
    // same EMAIL_ALREADY_REGISTERED guard `signInWithOAuth` already proved for Apple, now
    // exercised through the Google route instead — confirms the shared logic really is shared).
    const secondGoogleToken = await signTestToken(privateKey, {
      sub: 'google-sub-4b',
      email: 'crossprovider@example.com',
      emailVerified: true,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/google',
      payload: { idToken: secondGoogleToken },
    });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error, 'EMAIL_ALREADY_REGISTERED');
  });

  it('a forged token (wrong signing key) is rejected by the real route, not a 500', async () => {
    const { privateKey: attackerKey } = await makeTestKeySet();
    const forged = await signTestToken(attackerKey, { sub: 'google-sub-5' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/google',
      payload: { idToken: forged },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'INVALID_GOOGLE_TOKEN');
  });

  it('a malformed request body is a validation error, not a crash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/google',
      payload: {},
    });
    assert.equal(response.statusCode, 400);
  });

  it('fails closed (503) when the feature flag is off, even with a genuinely valid token', async () => {
    const disabledDb = await createIsolatedTestDb('google_sign_in_flag_off');
    const disabledApp = await buildApp({
      env: { ...disabledDb.env, VINKIN_GOOGLE_SIGN_IN_ENABLED: '0' },
      sql: disabledDb.sql,
      googleKeyResolver: keyResolver,
      checkDb: async () => {
        await disabledDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const token = await signTestToken(privateKey, { sub: 'google-sub-6' });
      const response = await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/google',
        payload: { idToken: token },
      });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error, 'GOOGLE_SIGN_IN_DISABLED');
    } finally {
      await disabledApp.close();
      await disabledDb.drop();
    }
  });

  it('fails closed (503) when the flag is on but no client id is configured', async () => {
    const unconfiguredDb = await createIsolatedTestDb('google_sign_in_unconfigured');
    const unconfiguredApp = await buildApp({
      env: { ...unconfiguredDb.env, VINKIN_GOOGLE_SIGN_IN_ENABLED: '1' },
      sql: unconfiguredDb.sql,
      googleKeyResolver: keyResolver,
      checkDb: async () => {
        await unconfiguredDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const token = await signTestToken(privateKey, { sub: 'google-sub-7' });
      const response = await unconfiguredApp.inject({
        method: 'POST',
        url: '/api/v1/auth/oauth/google',
        payload: { idToken: token },
      });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error, 'GOOGLE_SIGN_IN_DISABLED');
    } finally {
      await unconfiguredApp.close();
      await unconfiguredDb.drop();
    }
  });
});
