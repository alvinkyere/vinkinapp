/**
 * Guest access tokens (PV4, D14): opaque, prefixed, minted once at join, stored only as a
 * SHA-256 hash. The prefix lets transports distinguish guest tokens from JWTs on sight
 * without attempting verification.
 */

import { createHash, randomBytes } from 'node:crypto';

export const GUEST_TOKEN_PREFIX = 'vgt_';

export function newGuestToken(): { token: string; tokenHash: string } {
  const token = `${GUEST_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashGuestToken(token) };
}

export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
