/**
 * Magic-link (passwordless login) tokens (ENG5 Slice 3): opaque, prefixed, stored only as a
 * SHA-256 hash — same shape as every other bearer secret in this codebase (D14 hard rule).
 */

import { createHash, randomBytes } from 'node:crypto';

export const MAGIC_LINK_TOKEN_PREFIX = 'mlt_';

export function newMagicLinkToken(): { token: string; tokenHash: string } {
  const token = `${MAGIC_LINK_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashMagicLinkToken(token) };
}

export function hashMagicLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
