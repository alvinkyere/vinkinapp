/**
 * Password reset tokens (ENG5 Slice 2): opaque, prefixed, stored only as a SHA-256 hash —
 * same shape as `email-verification-tokens.ts`/`guest-tokens.ts` (D14 hard rule applied to
 * every bearer secret in this codebase).
 */

import { createHash, randomBytes } from 'node:crypto';

export const PASSWORD_RESET_TOKEN_PREFIX = 'prt_';

export function newPasswordResetToken(): { token: string; tokenHash: string } {
  const token = `${PASSWORD_RESET_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashPasswordResetToken(token) };
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
