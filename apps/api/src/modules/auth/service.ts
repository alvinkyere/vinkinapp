/**
 * Identity service (PV1). Identity predates the financial aggregates; when the application
 * command layer lands (D13, PV3+) these functions become commands. No financial state here.
 */

import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { Sql } from '../../db/client.ts';
import { hashPassword, verifyPassword } from '../../auth/passwords.ts';
import { REFRESH_TOKEN_TTL_SECONDS, hashRefreshToken, newRefreshToken } from '../../auth/tokens.ts';
import {
  hashEmailVerificationToken,
  newEmailVerificationToken,
} from '../../auth/email-verification-tokens.ts';
import { hashPasswordResetToken, newPasswordResetToken } from '../../auth/password-reset-tokens.ts';
import { hashMagicLinkToken, newMagicLinkToken } from '../../auth/magic-link-tokens.ts';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  /** Slice I4 (D19/D27) — `users.phone` has existed since migration 0001 (PV1) but was never
   * wired into any application code until now (verified by reading this whole module before
   * changing anything, per the I4 prompt's own instruction). */
  phone: string | null;
  status: string;
  /** ENG5 Slice 1 — always `false` when `email` is null (nothing to verify); derived from
   * `users.email_verified_at IS NOT NULL`, never a client-settable field. */
  emailVerified: boolean;
}

export class AuthError extends Error {
  readonly code:
    | 'INVALID_CREDENTIALS'
    | 'USERNAME_TAKEN'
    | 'INVALID_REFRESH_TOKEN'
    | 'NO_EMAIL_ON_FILE'
    | 'EMAIL_ALREADY_VERIFIED'
    | 'INVALID_VERIFICATION_TOKEN'
    | 'INVALID_RESET_TOKEN'
    | 'INVALID_MAGIC_LINK_TOKEN'
    | 'EMAIL_ALREADY_REGISTERED';
  constructor(code: AuthError['code']) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
  }
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  password_hash: string;
  email_verified_at: Date | null;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    emailVerified: row.email_verified_at !== null,
  };
}

async function createSession(
  sql: Sql,
  userId: string,
  rotatedFrom: string | null,
): Promise<{ sessionId: string; refreshToken: string }> {
  const { token, tokenHash } = newRefreshToken();
  const [session] = await sql`
    INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, rotated_from)
    VALUES (${userId}, ${tokenHash}, now() + make_interval(secs => ${REFRESH_TOKEN_TTL_SECONDS}), ${rotatedFrom})
    RETURNING id`;
  return { sessionId: (session as { id: string }).id, refreshToken: token };
}

export async function registerUser(
  sql: Sql,
  input: {
    username: string;
    displayName: string;
    email?: string;
    phone?: string;
    password: string;
  },
): Promise<{ user: PublicUser; sessionId: string; refreshToken: string }> {
  const passwordHash = await hashPassword(input.password);
  const rows = await sql`
    INSERT INTO users (username, display_name, email, phone, password_hash)
    VALUES (${input.username}, ${input.displayName}, ${input.email ?? null},
            ${input.phone ?? null}, ${passwordHash})
    ON CONFLICT (username) DO NOTHING
    RETURNING id, username, display_name, email, phone, status, password_hash, email_verified_at`;
  const row = rows[0] as UserRow | undefined;
  if (row === undefined) throw new AuthError('USERNAME_TAKEN');
  const session = await createSession(sql, row.id, null);
  return { user: toPublicUser(row), ...session };
}

export async function loginUser(
  sql: Sql,
  input: { username: string; password: string },
): Promise<{ user: PublicUser; sessionId: string; refreshToken: string }> {
  const rows = await sql`
    SELECT id, username, display_name, email, phone, status, password_hash, email_verified_at
    FROM users WHERE username = ${input.username} AND status = 'ACTIVE'`;
  const row = rows[0] as UserRow | undefined;
  // Uniform failure for unknown user and wrong password — no account enumeration.
  if (row === undefined || !(await verifyPassword(input.password, row.password_hash))) {
    throw new AuthError('INVALID_CREDENTIALS');
  }
  const session = await createSession(sql, row.id, null);
  return { user: toPublicUser(row), ...session };
}

type RefreshOutcome =
  | { kind: 'ROTATED'; userId: string; sessionId: string; refreshToken: string }
  | { kind: 'REUSE_DETECTED'; userId: string }
  | { kind: 'INVALID' };

/**
 * Rotation with reuse detection: presenting an already-revoked refresh token revokes every
 * session of that user (the token was either replayed or leaked).
 *
 * The transaction RETURNS an outcome instead of throwing — a throw inside `sql.begin` rolls
 * the transaction back, which previously undid the reuse-response revocation and left the
 * rotated successor token alive (PV3 integration defect #1; see milestone report). The
 * family revocation commits in its own statement before the caller-visible 401 is raised.
 */
export async function refreshSession(
  sql: Sql,
  refreshToken: string,
): Promise<{ userId: string; sessionId: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(refreshToken);
  const outcome = (await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, user_id, revoked_at, expires_at FROM auth_sessions
      WHERE refresh_token_hash = ${tokenHash} FOR UPDATE`;
    const session = rows[0] as
      { id: string; user_id: string; revoked_at: Date | null; expires_at: Date } | undefined;
    if (session === undefined) return { kind: 'INVALID' };
    if (session.revoked_at !== null) return { kind: 'REUSE_DETECTED', userId: session.user_id };
    if (session.expires_at.getTime() <= Date.now()) return { kind: 'INVALID' };

    await tx`UPDATE auth_sessions SET revoked_at = now() WHERE id = ${session.id}`;
    const { token, tokenHash: newHash } = newRefreshToken();
    const inserted = await tx`
      INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, rotated_from)
      VALUES (${session.user_id}, ${newHash}, now() + make_interval(secs => ${REFRESH_TOKEN_TTL_SECONDS}), ${session.id})
      RETURNING id`;
    return {
      kind: 'ROTATED',
      userId: session.user_id,
      sessionId: (inserted[0] as { id: string }).id,
      refreshToken: token,
    };
  })) as RefreshOutcome;

  if (outcome.kind === 'REUSE_DETECTED') {
    // Committed independently of the 401 below — the entire session family dies.
    await sql`UPDATE auth_sessions SET revoked_at = now()
              WHERE user_id = ${outcome.userId} AND revoked_at IS NULL`;
    throw new AuthError('INVALID_REFRESH_TOKEN');
  }
  if (outcome.kind === 'INVALID') throw new AuthError('INVALID_REFRESH_TOKEN');
  return {
    userId: outcome.userId,
    sessionId: outcome.sessionId,
    refreshToken: outcome.refreshToken,
  };
}

export async function revokeSession(sql: Sql, refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  await sql`UPDATE auth_sessions SET revoked_at = now()
            WHERE refresh_token_hash = ${tokenHash} AND revoked_at IS NULL`;
}

export async function findUserById(sql: Sql, userId: string): Promise<PublicUser | null> {
  const rows = await sql`
    SELECT id, username, display_name, email, phone, status, password_hash, email_verified_at
    FROM users WHERE id = ${userId}`;
  const row = rows[0] as UserRow | undefined;
  return row === undefined ? null : toPublicUser(row);
}

/** Slice I4 (D19/D27) — lets a user set/change the contact destination automatic invitation
 * delivery would use, after registration (Register only captures it once, at signup;
 * Profile is where it's ever revisited). `undefined` on either field leaves that column
 * unchanged; `null` (an explicit clear) removes it — distinguished at the route layer via
 * Zod's `.nullable().optional()`, not here. */
export async function updateContactInfo(
  sql: Sql,
  userId: string,
  input: { email?: string | null; phone?: string | null },
): Promise<PublicUser> {
  const rows = await sql`
    UPDATE users SET
      email = CASE WHEN ${input.email !== undefined} THEN ${input.email ?? null} ELSE email END,
      phone = CASE WHEN ${input.phone !== undefined} THEN ${input.phone ?? null} ELSE phone END,
      -- ENG5 Slice 1: an unverified new address must never inherit the old address's verified
      -- state. Only resets when the address is actually changing (re-submitting the same
      -- already-verified value is a no-op, not a re-verification demand).
      email_verified_at = CASE
        WHEN ${input.email !== undefined} AND ${input.email ?? null} IS DISTINCT FROM email
          THEN NULL
        ELSE email_verified_at
      END,
      updated_at = now()
    WHERE id = ${userId}
    RETURNING id, username, display_name, email, phone, status, password_hash, email_verified_at`;
  const row = rows[0] as UserRow | undefined;
  // Unreachable for a real authenticated caller (their own id came from a verified access
  // token) — not an AuthError code, since this isn't a credentials problem.
  if (row === undefined) throw new Error(`updateContactInfo: user ${userId} not found`);
  return toPublicUser(row);
}

/**
 * ENG5 Slice 1 — mints a fresh verification token for the user's CURRENT email, invalidating
 * any prior unconsumed token for this user first (avoids a stale earlier token remaining
 * independently valid after a resend, and keeps "most recent token" the only one that ever
 * needs checking). Throws `NO_EMAIL_ON_FILE` / `EMAIL_ALREADY_VERIFIED` rather than silently
 * minting a token nothing will ever be sent to, or that verifies nothing.
 */
export async function createEmailVerificationToken(
  sql: Sql,
  userId: string,
  ttlSeconds: number,
): Promise<{ token: string; email: string }> {
  const user = await findUserById(sql, userId);
  if (user === null) throw new Error(`createEmailVerificationToken: user ${userId} not found`);
  if (user.email === null) throw new AuthError('NO_EMAIL_ON_FILE');
  if (user.emailVerified) throw new AuthError('EMAIL_ALREADY_VERIFIED');

  const { token, tokenHash } = newEmailVerificationToken();
  await sql.begin(async (tx) => {
    await tx`UPDATE email_verification_tokens SET consumed_at = now()
             WHERE user_id = ${userId} AND consumed_at IS NULL`;
    await tx`
      INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
      VALUES (${userId}, ${user.email}, ${tokenHash}, now() + make_interval(secs => ${ttlSeconds}))`;
  });
  return { token, email: user.email };
}

/** Most recent verification-token attempt for this user, if any — the route layer's own
 * resend-cooldown check (same shape as `GUEST_RESEND_COOLDOWN_SECONDS`'s check in
 * `vinks/routes.ts`, computed at the transport, not here). */
export async function lastEmailVerificationAttempt(
  sql: Sql,
  userId: string,
): Promise<{ createdAt: Date } | null> {
  const rows = await sql`
    SELECT created_at FROM email_verification_tokens
    WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 1`;
  const row = rows[0] as { created_at: Date } | undefined;
  return row === undefined ? null : { createdAt: row.created_at };
}

/**
 * ENG5 Slice 1 — consumes a verification token. Guards, in order: token exists, not already
 * consumed, not expired, and its snapshotted email still matches the account's CURRENT email
 * (a changed-since-issuance email must never be verified by an in-flight token minted for the
 * old address — the same guard `updateContactInfo`'s reset above exists to make necessary).
 * All four failure shapes collapse to the same `INVALID_VERIFICATION_TOKEN` — distinguishing
 * "expired" from "wrong"/"stale" from a browser's plain confirm-page GET buys the caller
 * nothing actionable and would cost a token-guessing oracle.
 */
export async function confirmEmailVerification(sql: Sql, token: string): Promise<PublicUser> {
  const tokenHash = hashEmailVerificationToken(token);
  const user = await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, user_id, email, expires_at, consumed_at FROM email_verification_tokens
      WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const row = rows[0] as
      | { id: string; user_id: string; email: string; expires_at: Date; consumed_at: Date | null }
      | undefined;
    if (row === undefined) throw new AuthError('INVALID_VERIFICATION_TOKEN');
    if (row.consumed_at !== null) throw new AuthError('INVALID_VERIFICATION_TOKEN');
    if (row.expires_at.getTime() <= Date.now()) throw new AuthError('INVALID_VERIFICATION_TOKEN');

    const userRows = await tx`
      SELECT id, username, display_name, email, phone, status, password_hash, email_verified_at
      FROM users WHERE id = ${row.user_id} FOR UPDATE`;
    const userRow = userRows[0] as UserRow | undefined;
    if (userRow === undefined || userRow.email !== row.email) {
      throw new AuthError('INVALID_VERIFICATION_TOKEN');
    }

    await tx`UPDATE email_verification_tokens SET consumed_at = now() WHERE id = ${row.id}`;
    const updated = await tx`
      UPDATE users SET email_verified_at = now()
      WHERE id = ${row.user_id}
      RETURNING id, username, display_name, email, phone, status, password_hash, email_verified_at`;
    return toPublicUser(updated[0] as UserRow);
  });
  return user;
}

/**
 * ENG5 Slice 2 — starts a password reset for whoever owns `email`, or does nothing.
 * Deliberately returns `null` for EVERY reason nothing should be sent (no such account, no
 * email on that account, account not ACTIVE, or still within the resend cooldown) — the route
 * layer sends the exact same generic response regardless, so this function's return value can
 * never become an account-enumeration side channel (existing codebase discipline; see
 * `loginUser`'s own "no account enumeration" comment above). Invalidates any prior unconsumed
 * token first, same "at most one live token" rule `createEmailVerificationToken` follows.
 */
export async function requestPasswordReset(
  sql: Sql,
  email: string,
  ttlSeconds: number,
  cooldownSeconds: number,
): Promise<{ token: string; userId: string } | null> {
  const rows = await sql`
    SELECT id FROM users WHERE email = ${email} AND status = 'ACTIVE'`;
  const row = rows[0] as { id: string } | undefined;
  if (row === undefined) return null;

  const lastAttempt = await sql`
    SELECT created_at FROM password_reset_tokens
    WHERE user_id = ${row.id}
    ORDER BY created_at DESC LIMIT 1`;
  const last = lastAttempt[0] as { created_at: Date } | undefined;
  if (last !== undefined && Date.now() - last.created_at.getTime() < cooldownSeconds * 1000) {
    return null;
  }

  const { token, tokenHash } = newPasswordResetToken();
  await sql.begin(async (tx) => {
    await tx`UPDATE password_reset_tokens SET consumed_at = now()
             WHERE user_id = ${row.id} AND consumed_at IS NULL`;
    await tx`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${row.id}, ${tokenHash}, now() + make_interval(secs => ${ttlSeconds}))`;
  });
  return { token, userId: row.id };
}

/**
 * ENG5 Slice 2 — consumes a reset token and sets a new password. Same guard order and same
 * collapsed-to-one-code failure shape as `confirmEmailVerification`: existence, single-use,
 * expiry. On success, revokes every existing session for the account (`auth_sessions`, same
 * table `refreshSession`'s reuse-detection family-revocation already writes to) — a password
 * reset is exactly the moment any possibly-compromised prior session should die, mirroring the
 * "kill the whole family" precedent already established there rather than inventing a new
 * session-termination rule.
 */
export async function confirmPasswordReset(
  sql: Sql,
  token: string,
  newPassword: string,
): Promise<PublicUser> {
  const tokenHash = hashPasswordResetToken(token);
  const passwordHash = await hashPassword(newPassword);
  const user = await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, user_id, expires_at, consumed_at FROM password_reset_tokens
      WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const row = rows[0] as
      { id: string; user_id: string; expires_at: Date; consumed_at: Date | null } | undefined;
    if (row === undefined) throw new AuthError('INVALID_RESET_TOKEN');
    if (row.consumed_at !== null) throw new AuthError('INVALID_RESET_TOKEN');
    if (row.expires_at.getTime() <= Date.now()) throw new AuthError('INVALID_RESET_TOKEN');

    await tx`UPDATE password_reset_tokens SET consumed_at = now() WHERE id = ${row.id}`;
    const updated = await tx`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id = ${row.user_id}
      RETURNING id, username, display_name, email, phone, status, password_hash, email_verified_at`;
    await tx`UPDATE auth_sessions SET revoked_at = now()
             WHERE user_id = ${row.user_id} AND revoked_at IS NULL`;
    return toPublicUser(updated[0] as UserRow);
  });
  return user;
}

/**
 * ENG5 Slice 3 — starts a magic-link login for whoever owns `email`, or does nothing. Same
 * enumeration-safe `null`-collapse shape as `requestPasswordReset` (unknown account, inactive,
 * or still within cooldown all collapse to `null`; the route layer never learns which).
 */
export async function requestMagicLink(
  sql: Sql,
  email: string,
  ttlSeconds: number,
  cooldownSeconds: number,
): Promise<{ token: string; userId: string } | null> {
  const rows = await sql`
    SELECT id FROM users WHERE email = ${email} AND status = 'ACTIVE'`;
  const row = rows[0] as { id: string } | undefined;
  if (row === undefined) return null;

  const lastAttempt = await sql`
    SELECT created_at FROM magic_link_tokens
    WHERE user_id = ${row.id}
    ORDER BY created_at DESC LIMIT 1`;
  const last = lastAttempt[0] as { created_at: Date } | undefined;
  if (last !== undefined && Date.now() - last.created_at.getTime() < cooldownSeconds * 1000) {
    return null;
  }

  const { token, tokenHash } = newMagicLinkToken();
  await sql.begin(async (tx) => {
    await tx`UPDATE magic_link_tokens SET consumed_at = now()
             WHERE user_id = ${row.id} AND consumed_at IS NULL`;
    await tx`
      INSERT INTO magic_link_tokens (user_id, token_hash, expires_at)
      VALUES (${row.id}, ${tokenHash}, now() + make_interval(secs => ${ttlSeconds}))`;
  });
  return { token, userId: row.id };
}

/**
 * ENG5 Slice 3 — consumes a magic-link token and issues a real session, identical in shape to
 * a successful `loginUser`/`registerUser` (same `createSession` call, same return shape) —
 * from the caller's point of view this IS a login, just via a different credential. Same
 * guard order/collapsed-error-code pattern as `confirmPasswordReset`/`confirmEmailVerification`.
 */
export async function confirmMagicLink(
  sql: Sql,
  token: string,
): Promise<{ user: PublicUser; sessionId: string; refreshToken: string }> {
  const tokenHash = hashMagicLinkToken(token);
  return sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, user_id, expires_at, consumed_at FROM magic_link_tokens
      WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const row = rows[0] as
      { id: string; user_id: string; expires_at: Date; consumed_at: Date | null } | undefined;
    if (row === undefined) throw new AuthError('INVALID_MAGIC_LINK_TOKEN');
    if (row.consumed_at !== null) throw new AuthError('INVALID_MAGIC_LINK_TOKEN');
    if (row.expires_at.getTime() <= Date.now()) throw new AuthError('INVALID_MAGIC_LINK_TOKEN');

    const userRows = await tx`
      SELECT id, username, display_name, email, phone, status, password_hash, email_verified_at
      FROM users WHERE id = ${row.user_id} AND status = 'ACTIVE'`;
    const userRow = userRows[0] as UserRow | undefined;
    if (userRow === undefined) throw new AuthError('INVALID_MAGIC_LINK_TOKEN');

    await tx`UPDATE magic_link_tokens SET consumed_at = now() WHERE id = ${row.id}`;
    // Inlined rather than reusing `createSession` — that helper is typed for `Sql`, and
    // `tx` here is `TransactionSql`, a distinct (non-assignable) type in this driver.
    // `confirmEmailVerification`/`confirmPasswordReset` inline their own tx queries for the
    // same reason; this follows that established pattern rather than widening the helper.
    const { token: refreshToken, tokenHash: refreshTokenHash } = newRefreshToken();
    const [session] = await tx`
      INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, rotated_from)
      VALUES (${row.user_id}, ${refreshTokenHash},
              now() + make_interval(secs => ${REFRESH_TOKEN_TTL_SECONDS}), NULL)
      RETURNING id`;
    return {
      user: toPublicUser(userRow),
      sessionId: (session as { id: string }).id,
      refreshToken,
    };
  });
}

export type OAuthProvider = 'apple' | 'google';

/**
 * ENG5 Slice 4 — signs in via a verified external identity (`providerUserId` is that
 * provider's own stable subject id, never an email). Links to an existing account if this
 * exact `(provider, providerUserId)` pair has signed in before; otherwise creates a new
 * account. Provider-generic (built for Apple now, Google's Slice 5 reuses this verbatim — the
 * account-linking logic doesn't care which provider produced the identity, only the token
 * verification step, which lives in each provider's own module, does).
 *
 * A newly created account gets a random, unguessable, never-shown password hash — there is no
 * password to log in with until the account owner explicitly sets one (no route does that yet;
 * a real, disclosed gap, not silently worked around). Its email, if the provider gave one, is
 * marked verified immediately: Apple/Google both already proved the user controls that address
 * before ever handing it to us, so re-demanding Slice 1's own verification round trip for an
 * address a trusted provider just vouched for would be redundant, not more secure.
 */
export async function signInWithOAuth(
  sql: Sql,
  provider: OAuthProvider,
  providerUserId: string,
  email: string | null,
  displayName: string,
): Promise<{
  user: PublicUser;
  sessionId: string;
  refreshToken: string;
  isNewUser: boolean;
}> {
  return sql.begin(async (tx) => {
    const existing = await tx`
      SELECT user_id FROM oauth_identities
      WHERE provider = ${provider} AND provider_user_id = ${providerUserId} FOR UPDATE`;
    const existingRow = existing[0] as { user_id: string } | undefined;

    let userId: string;
    let isNewUser = false;
    if (existingRow !== undefined) {
      userId = existingRow.user_id;
    } else {
      isNewUser = true;
      // Inlined rather than a separately `Sql`-typed helper — `tx` here is `TransactionSql`,
      // a distinct (non-assignable) type in this driver; same reason
      // `confirmMagicLink`/`confirmPasswordReset`/`confirmEmailVerification` all inline their
      // own tx queries instead of calling out to a helper.
      let username: string | undefined;
      for (let attempt = 0; attempt < 5 && username === undefined; attempt++) {
        const candidate = `${provider}_${randomBytes(4).toString('hex')}`;
        const existingUsername = await tx`SELECT 1 FROM users WHERE username = ${candidate}`;
        if (existingUsername.length === 0) username = candidate;
      }
      if (username === undefined) {
        throw new Error(`signInWithOAuth: exhausted username attempts for provider ${provider}`);
      }
      const placeholderPasswordHash = await hashPassword(randomBytes(32).toString('hex'));
      let created: readonly unknown[];
      try {
        created = await tx`
          INSERT INTO users (username, display_name, email, password_hash, email_verified_at)
          VALUES (${username}, ${displayName}, ${email}, ${placeholderPasswordHash},
                  ${email !== null ? new Date() : null})
          RETURNING id`;
      } catch (error) {
        // Deliberately conservative, not auto-linking: Apple verified this email belongs to
        // *an* Apple account, but an existing VinkIn account with the same email may have
        // been created via password signup, a different Apple identity, or Google (Slice 5) —
        // silently merging identities on email match is a real access-control decision this
        // codebase hasn't made (flagged, not decided here). PostgreSQL's own uniqueness
        // constraint is the final guard (hard rule) catching the true concurrent-race shape of
        // this, not just an app-layer pre-check.
        if (error instanceof postgres.PostgresError && error.code === '23505') {
          throw new AuthError('EMAIL_ALREADY_REGISTERED');
        }
        throw error;
      }
      userId = (created[0] as { id: string }).id;
      await tx`
        INSERT INTO oauth_identities (user_id, provider, provider_user_id, email)
        VALUES (${userId}, ${provider}, ${providerUserId}, ${email})`;
    }

    const userRows = await tx`
      SELECT id, username, display_name, email, phone, status, password_hash, email_verified_at
      FROM users WHERE id = ${userId} AND status = 'ACTIVE'`;
    const userRow = userRows[0] as UserRow | undefined;
    // Only reachable if the linked account was suspended/closed after linking — the identity
    // itself verified fine, so this is a real account-state problem, not a credentials one; no
    // dedicated code exists for it yet (real, disclosed gap) so it collapses to the closest
    // existing meaning.
    if (userRow === undefined) throw new AuthError('INVALID_CREDENTIALS');

    const { token: refreshToken, tokenHash: refreshTokenHash } = newRefreshToken();
    const [session] = await tx`
      INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, rotated_from)
      VALUES (${userId}, ${refreshTokenHash},
              now() + make_interval(secs => ${REFRESH_TOKEN_TTL_SECONDS}), NULL)
      RETURNING id`;
    return {
      user: toPublicUser(userRow),
      sessionId: (session as { id: string }).id,
      refreshToken,
      isNewUser,
    };
  });
}
