/**
 * Operator tokens (PV11, D17): a shared-credential login (not a `users` row — see the
 * decision log) mints a short-lived signed token naming the operator, checked on every
 * `/internal/ops/*` route. `typ: 'operator'` keeps this token type from being usable
 * anywhere a regular user access token is expected, and vice versa.
 */

import { SignJWT, jwtVerify } from 'jose';

export const OPERATOR_TOKEN_TTL_SECONDS = 8 * 60 * 60; // one shift

export interface OperatorTokenClaims {
  operatorName: string;
}

function keyFor(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signOperatorToken(secret: string, operatorName: string): Promise<string> {
  return new SignJWT({ typ: 'operator', operatorName })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('vinkin-api')
    .setIssuedAt()
    .setExpirationTime(`${OPERATOR_TOKEN_TTL_SECONDS}s`)
    .sign(keyFor(secret));
}

/** Returns the claims or null — never throws on an invalid/expired/wrong-type token. */
export async function verifyOperatorToken(
  secret: string,
  token: string,
): Promise<OperatorTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), { issuer: 'vinkin-api' });
    if (payload.typ !== 'operator' || typeof payload.operatorName !== 'string') return null;
    return { operatorName: payload.operatorName };
  } catch {
    return null;
  }
}
