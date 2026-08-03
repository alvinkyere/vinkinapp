/**
 * ENG5 Slice 5 — real cryptographic verification of `verifyGoogleIdentityToken`, same "real,
 * not simulated" bar and same local-key-pair technique as `apple-identity.test.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { GoogleIdentityError, verifyGoogleIdentityToken } from './google-identity.ts';

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
    sub?: string;
    email?: string;
    emailVerified?: boolean;
    name?: string;
    issuer?: string;
    audience?: string;
    expiresInSeconds?: number;
  },
): Promise<string> {
  const payload: Record<string, unknown> = {};
  if (claims.email !== undefined) payload.email = claims.email;
  if (claims.emailVerified !== undefined) payload.email_verified = claims.emailVerified;
  if (claims.name !== undefined) payload.name = claims.name;

  let builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(claims.issuer ?? 'https://accounts.google.com')
    .setAudience(claims.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(`${claims.expiresInSeconds ?? 3600}s`);
  if (claims.sub !== undefined) builder = builder.setSubject(claims.sub);
  return builder.sign(privateKey);
}

describe('verifyGoogleIdentityToken (ENG5 Slice 5)', () => {
  it('accepts a valid token, extracting sub/email/name', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'google-user-1',
      email: 'someone@gmail.com',
      emailVerified: true,
      name: 'Ada Lovelace',
    });

    const identity = await verifyGoogleIdentityToken(token, CLIENT_ID, keyResolver);
    assert.equal(identity.sub, 'google-user-1');
    assert.equal(identity.email, 'someone@gmail.com');
    assert.equal(identity.name, 'Ada Lovelace');
  });

  it('accepts the OTHER valid Google issuer value ("accounts.google.com", no scheme)', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'google-user-1',
      issuer: 'accounts.google.com',
    });

    const identity = await verifyGoogleIdentityToken(token, CLIENT_ID, keyResolver);
    assert.equal(identity.sub, 'google-user-1');
  });

  it('never trusts an unverified email claim — treats it as absent, not as fact', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'google-user-1',
      email: 'unverified@example.com',
      emailVerified: false,
    });

    const identity = await verifyGoogleIdentityToken(token, CLIENT_ID, keyResolver);
    assert.equal(identity.email, null);
  });

  it('a token with no name claim yields name: null, not an error', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, { sub: 'google-user-1' });

    const identity = await verifyGoogleIdentityToken(token, CLIENT_ID, keyResolver);
    assert.equal(identity.name, null);
  });

  it('rejects a token signed by a DIFFERENT key (forged signature)', async () => {
    const { privateKey: attackerKey } = await makeTestKeySet();
    const { keyResolver: realKeyResolver } = await makeTestKeySet();
    const forged = await signTestToken(attackerKey, { sub: 'google-user-1' });

    await assert.rejects(
      () => verifyGoogleIdentityToken(forged, CLIENT_ID, realKeyResolver),
      GoogleIdentityError,
    );
  });

  it('rejects a token with a wrong issuer', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'google-user-1',
      issuer: 'https://evil.example.com',
    });

    await assert.rejects(
      () => verifyGoogleIdentityToken(token, CLIENT_ID, keyResolver),
      GoogleIdentityError,
    );
  });

  it('rejects a token minted for a DIFFERENT app (wrong audience)', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'google-user-1',
      audience: 'someone-elses-client-id.apps.googleusercontent.com',
    });

    await assert.rejects(
      () => verifyGoogleIdentityToken(token, CLIENT_ID, keyResolver),
      GoogleIdentityError,
    );
  });

  it('rejects an expired token', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'google-user-1',
      expiresInSeconds: -10,
    });

    await assert.rejects(
      () => verifyGoogleIdentityToken(token, CLIENT_ID, keyResolver),
      GoogleIdentityError,
    );
  });

  it('rejects a well-formed but sub-less token', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, { email: 'someone@gmail.com' });

    await assert.rejects(
      () => verifyGoogleIdentityToken(token, CLIENT_ID, keyResolver),
      GoogleIdentityError,
    );
  });

  it('rejects garbage input, never throws an unrelated error type', async () => {
    const { keyResolver } = await makeTestKeySet();
    await assert.rejects(
      () => verifyGoogleIdentityToken('not-a-jwt-at-all', CLIENT_ID, keyResolver),
      GoogleIdentityError,
    );
  });
});
