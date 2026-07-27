/**
 * ENG5 Slice 4 — real cryptographic verification of `verifyAppleIdentityToken`. No network
 * call, no dependency on Apple's own servers: a locally generated key pair signs test tokens,
 * and a local JWKS built from its public half is injected as the key resolver — the same
 * "real, not simulated" bar every other test in this repo holds to, just without needing
 * Apple's infrastructure to prove this code's own logic is correct.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { APPLE_ISSUER, AppleIdentityError, verifyAppleIdentityToken } from './apple-identity.ts';

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
  claims: {
    sub?: string;
    email?: string;
    issuer?: string;
    audience?: string;
    expiresInSeconds?: number;
  },
): Promise<string> {
  let builder = new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(claims.issuer ?? APPLE_ISSUER)
    .setAudience(claims.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(`${claims.expiresInSeconds ?? 3600}s`);
  if (claims.sub !== undefined) builder = builder.setSubject(claims.sub);
  return builder.sign(privateKey);
}

describe('verifyAppleIdentityToken (ENG5 Slice 4)', () => {
  it('accepts a genuinely valid token and extracts sub/email', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'apple-user-abc123',
      email: 'someone@privaterelay.appleid.com',
    });

    const identity = await verifyAppleIdentityToken(token, CLIENT_ID, keyResolver);
    assert.equal(identity.sub, 'apple-user-abc123');
    assert.equal(identity.email, 'someone@privaterelay.appleid.com');
  });

  it('accepts a token with no email claim (a repeat sign-in) — email is null, not an error', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, { sub: 'apple-user-abc123' });

    const identity = await verifyAppleIdentityToken(token, CLIENT_ID, keyResolver);
    assert.equal(identity.email, null);
  });

  it('rejects a token signed by a DIFFERENT key (forged signature)', async () => {
    const { privateKey: attackerKey } = await makeTestKeySet();
    const { keyResolver: realKeyResolver } = await makeTestKeySet();
    const forged = await signTestToken(attackerKey, { sub: 'apple-user-abc123' });

    await assert.rejects(
      () => verifyAppleIdentityToken(forged, CLIENT_ID, realKeyResolver),
      AppleIdentityError,
    );
  });

  it('rejects a token with the wrong issuer', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'apple-user-abc123',
      issuer: 'https://evil.example.com',
    });

    await assert.rejects(
      () => verifyAppleIdentityToken(token, CLIENT_ID, keyResolver),
      AppleIdentityError,
    );
  });

  it('rejects a token minted for a DIFFERENT app (wrong audience)', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'apple-user-abc123',
      audience: 'com.someone.else.app',
    });

    await assert.rejects(
      () => verifyAppleIdentityToken(token, CLIENT_ID, keyResolver),
      AppleIdentityError,
    );
  });

  it('rejects an expired token', async () => {
    const { keyResolver, privateKey } = await makeTestKeySet();
    const token = await signTestToken(privateKey, {
      sub: 'apple-user-abc123',
      expiresInSeconds: -10,
    });

    await assert.rejects(
      () => verifyAppleIdentityToken(token, CLIENT_ID, keyResolver),
      AppleIdentityError,
    );
  });

  it('rejects a well-formed but sub-less token', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const keyResolver = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] });
    const token = await new SignJWT({ email: 'someone@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(APPLE_ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('3600s')
      .sign(privateKey);

    await assert.rejects(
      () => verifyAppleIdentityToken(token, CLIENT_ID, keyResolver),
      AppleIdentityError,
    );
  });

  it('rejects garbage input, never throws an unrelated error type', async () => {
    const { keyResolver } = await makeTestKeySet();
    await assert.rejects(
      () => verifyAppleIdentityToken('not-a-jwt-at-all', CLIENT_ID, keyResolver),
      AppleIdentityError,
    );
  });
});
