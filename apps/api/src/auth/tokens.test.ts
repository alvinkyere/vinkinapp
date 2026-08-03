import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken } from './tokens.ts';

const SECRET = 'test-secret-that-is-long-enough-0123456789';

describe('access tokens (JWT)', () => {
  it('round-trips claims', async () => {
    const token = await signAccessToken(SECRET, { userId: 'user-1', sessionId: 'session-1' });
    const claims = await verifyAccessToken(SECRET, token);
    assert.deepEqual(claims, { userId: 'user-1', sessionId: 'session-1' });
  });

  it('returns null for a tampered token and for the wrong secret', async () => {
    const token = await signAccessToken(SECRET, { userId: 'user-1', sessionId: 'session-1' });
    assert.equal(await verifyAccessToken(SECRET, `${token}x`), null);
    assert.equal(await verifyAccessToken('another-secret-that-is-long-enough-42', token), null);
    assert.equal(await verifyAccessToken(SECRET, 'garbage'), null);
  });
});

describe('refresh tokens', () => {
  it('generates distinct opaque tokens with deterministic hashes', () => {
    const first = newRefreshToken();
    const second = newRefreshToken();
    assert.notEqual(first.token, second.token);
    assert.equal(first.tokenHash, hashRefreshToken(first.token));
    assert.notEqual(first.tokenHash, second.tokenHash);
  });
});
