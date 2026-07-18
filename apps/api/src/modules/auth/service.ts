/**
 * Identity service (PV1). Identity predates the financial aggregates; when the application
 * command layer lands (D13, PV3+) these functions become commands. No financial state here.
 */

import type { Sql } from '../../db/client.ts';
import { hashPassword, verifyPassword } from '../../auth/passwords.ts';
import { REFRESH_TOKEN_TTL_SECONDS, hashRefreshToken, newRefreshToken } from '../../auth/tokens.ts';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  status: string;
}

export class AuthError extends Error {
  readonly code: 'INVALID_CREDENTIALS' | 'USERNAME_TAKEN' | 'INVALID_REFRESH_TOKEN';
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
  status: string;
  password_hash: string;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
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
  input: { username: string; displayName: string; email?: string; password: string },
): Promise<{ user: PublicUser; sessionId: string; refreshToken: string }> {
  const passwordHash = await hashPassword(input.password);
  const rows = await sql`
    INSERT INTO users (username, display_name, email, password_hash)
    VALUES (${input.username}, ${input.displayName}, ${input.email ?? null}, ${passwordHash})
    ON CONFLICT (username) DO NOTHING
    RETURNING id, username, display_name, email, status, password_hash`;
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
    SELECT id, username, display_name, email, status, password_hash
    FROM users WHERE username = ${input.username} AND status = 'ACTIVE'`;
  const row = rows[0] as UserRow | undefined;
  // Uniform failure for unknown user and wrong password — no account enumeration.
  if (row === undefined || !(await verifyPassword(input.password, row.password_hash))) {
    throw new AuthError('INVALID_CREDENTIALS');
  }
  const session = await createSession(sql, row.id, null);
  return { user: toPublicUser(row), ...session };
}

/**
 * Rotation with reuse detection: presenting an already-revoked refresh token revokes every
 * session of that user (the token was either replayed or leaked).
 */
export async function refreshSession(
  sql: Sql,
  refreshToken: string,
): Promise<{ userId: string; sessionId: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(refreshToken);
  return sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, user_id, revoked_at, expires_at FROM auth_sessions
      WHERE refresh_token_hash = ${tokenHash} FOR UPDATE`;
    const session = rows[0] as
      { id: string; user_id: string; revoked_at: Date | null; expires_at: Date } | undefined;
    if (session === undefined) throw new AuthError('INVALID_REFRESH_TOKEN');
    if (session.revoked_at !== null) {
      await tx`UPDATE auth_sessions SET revoked_at = now()
               WHERE user_id = ${session.user_id} AND revoked_at IS NULL`;
      throw new AuthError('INVALID_REFRESH_TOKEN');
    }
    if (session.expires_at.getTime() <= Date.now()) throw new AuthError('INVALID_REFRESH_TOKEN');

    await tx`UPDATE auth_sessions SET revoked_at = now() WHERE id = ${session.id}`;
    const { token, tokenHash: newHash } = newRefreshToken();
    const inserted = await tx`
      INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, rotated_from)
      VALUES (${session.user_id}, ${newHash}, now() + make_interval(secs => ${REFRESH_TOKEN_TTL_SECONDS}), ${session.id})
      RETURNING id`;
    return {
      userId: session.user_id,
      sessionId: (inserted[0] as { id: string }).id,
      refreshToken: token,
    };
  }) as Promise<{ userId: string; sessionId: string; refreshToken: string }>;
}

export async function revokeSession(sql: Sql, refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  await sql`UPDATE auth_sessions SET revoked_at = now()
            WHERE refresh_token_hash = ${tokenHash} AND revoked_at IS NULL`;
}

export async function findUserById(sql: Sql, userId: string): Promise<PublicUser | null> {
  const rows = await sql`
    SELECT id, username, display_name, email, status, password_hash
    FROM users WHERE id = ${userId}`;
  const row = rows[0] as UserRow | undefined;
  return row === undefined ? null : toPublicUser(row);
}
