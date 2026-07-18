/**
 * Token primitives: short-lived JWT access tokens (jose, HS256) and opaque rotating refresh
 * tokens. Only the SHA-256 hash of a refresh token is stored (Plan §21 "hash guest access
 * tokens" applied to all bearer secrets); the raw value exists once, in the response body.
 */

import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

function keyFor(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(secret: string, claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer('vinkin-api')
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(keyFor(secret));
}

/** Returns the claims or null — never throws on an invalid/expired token. */
export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), { issuer: 'vinkin-api' });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export function newRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
