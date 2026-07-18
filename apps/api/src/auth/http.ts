import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env.ts';
import { verifyAccessToken, type AccessTokenClaims } from './tokens.ts';

/** Bearer-token authentication for protected routes; replies 401 and returns null on failure. */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  env: Env,
): Promise<AccessTokenClaims | null> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
  const claims = token === null ? null : await verifyAccessToken(env.JWT_SECRET, token);
  if (claims === null) {
    await reply.code(401).send({ error: 'UNAUTHENTICATED' });
    return null;
  }
  return claims;
}
