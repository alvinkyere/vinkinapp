/**
 * Email verification tokens (ENG5 Slice 1): opaque, prefixed, stored only as a SHA-256 hash —
 * same shape as `guest-tokens.ts` (D14 hard rule applied to every bearer secret in this
 * codebase). The prefix lets a confirm-link handler recognize the token family on sight.
 */

import { createHash, randomBytes } from 'node:crypto';

export const EMAIL_VERIFICATION_TOKEN_PREFIX = 'evt_';

export function newEmailVerificationToken(): { token: string; tokenHash: string } {
  const token = `${EMAIL_VERIFICATION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashEmailVerificationToken(token) };
}

export function hashEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
