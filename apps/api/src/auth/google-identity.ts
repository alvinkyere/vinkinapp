/**
 * Sign in with Google — ID token verification (ENG5 Slice 5). Same shape as
 * `apple-identity.ts`: verify against the provider's own real JWKS by default, with an
 * injectable key resolver so tests can prove the logic against a locally generated key pair —
 * no real Google credentials needed to prove this code is correct.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Google accepts either issuer value on a real ID token (documented, not a guess) — both are
 * checked, not just one, or a real token could be rejected depending on which Google happened
 * to use for a given sign-in. */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

let cachedRemoteKeySet: JWTVerifyGetKey | undefined;

function remoteGoogleKeySet(): JWTVerifyGetKey {
  cachedRemoteKeySet ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return cachedRemoteKeySet;
}

export interface GoogleIdentity {
  /** Google's stable per-user identifier — the durable key `oauth_identities` links on, never
   * the email (an account can change its Google email; `sub` never changes). */
  sub: string;
  email: string | null;
  /** Unlike Apple's identity token (which never carries a name claim at all — the client must
   * pass it separately, and only on first authorization), Google's own ID token includes
   * `name` on every sign-in. Sourced from the verified token, not a client-supplied field. */
  name: string | null;
}

export class GoogleIdentityError extends Error {}

/**
 * Verifies signature, issuer (either accepted value), audience, and expiry. `clientId` is the
 * app's own OAuth client ID — required, never defaulted, for the identical reason
 * `verifyAppleIdentityToken`'s `clientId` is required: skipping it would accept a token minted
 * for a different app.
 */
export async function verifyGoogleIdentityToken(
  idToken: string,
  clientId: string,
  keyResolver: JWTVerifyGetKey = remoteGoogleKeySet(),
): Promise<GoogleIdentity> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, keyResolver, {
      issuer: [...GOOGLE_ISSUERS],
      audience: clientId,
    }));
  } catch (error) {
    throw new GoogleIdentityError(
      `Google ID token failed verification: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new GoogleIdentityError('Google ID token missing sub');
  }
  // Only trust an email Google itself marked verified — an unverified claim (e.g. a Google
  // Workspace account with a not-yet-confirmed alias) is not a fact this codebase should ever
  // record as one, the same "don't invent verification" principle Slice 1 already applies.
  const email =
    typeof payload.email === 'string' && payload.email_verified === true ? payload.email : null;
  const name = typeof payload.name === 'string' && payload.name.length > 0 ? payload.name : null;
  return { sub: payload.sub, email, name };
}
