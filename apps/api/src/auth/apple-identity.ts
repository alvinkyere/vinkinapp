/**
 * Sign in with Apple — identity token verification (ENG5 Slice 4).
 *
 * Apple's `identityToken` is a JWT the device signs with, verified against Apple's own public
 * JWKS (never a shared secret — this is OIDC, not a bearer token this codebase mints). The key
 * resolver is injectable so tests can verify the real signature/issuer/audience/expiry logic
 * against a locally generated key pair — no network call, no dependency on Apple's servers to
 * prove this code is correct, same "real, not simulated" bar as every other test in this repo.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

let cachedRemoteKeySet: JWTVerifyGetKey | undefined;

/** Lazily created and cached — never fetched unless a real verification actually happens with
 * no override supplied (i.e., never during tests, which always inject a local key set). */
function remoteAppleKeySet(): JWTVerifyGetKey {
  cachedRemoteKeySet ??= createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return cachedRemoteKeySet;
}

export interface AppleIdentity {
  /** Apple's stable, per-(app-group) user identifier — the durable key `oauth_identities`
   * links on. Never the email: Apple's email can be a rotating private-relay address or
   * absent entirely on a repeat sign-in. */
  sub: string;
  email: string | null;
}

export class AppleIdentityError extends Error {}

/**
 * Verifies signature, issuer, audience, and expiry. `clientId` is the app's own Services ID /
 * bundle ID — the expected `aud` claim; passing the wrong one here would let a token minted
 * for a *different* app through, so this is a required parameter, never defaulted or skipped.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  clientId: string,
  keyResolver: JWTVerifyGetKey = remoteAppleKeySet(),
): Promise<AppleIdentity> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(identityToken, keyResolver, {
      issuer: APPLE_ISSUER,
      audience: clientId,
    }));
  } catch (error) {
    throw new AppleIdentityError(
      `Apple identity token failed verification: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new AppleIdentityError('Apple identity token missing sub');
  }
  const email = typeof payload.email === 'string' ? payload.email : null;
  return { sub: payload.sub, email };
}
