/**
 * Auth transport (PV1). Routes validate with Zod, call the service, and map typed errors to
 * status codes — no business logic in handlers (D13).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Sql } from '../../db/client.ts';
import type { Env } from '../../config/env.ts';
import { requireUser } from '../../auth/http.ts';
import { signAccessToken, verifyAccessToken } from '../../auth/tokens.ts';
import {
  AuthError,
  findUserById,
  loginUser,
  refreshSession,
  registerUser,
  revokeSession,
  updateContactInfo,
} from './service.ts';

// Slice I4 (D19/D27): a US-only, digits-and-punctuation-tolerant phone check — deliberately
// loose (no carrier/format validation, that's a provider/legal-dependent concern, §27/§29 of
// the copy system, out of this slice's scope). Phase 6 §20's own field-level error copy
// ("That doesn't look like a valid phone number") is the route's job to surface, not this
// schema's.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9()\-.\s]{7,20}$/);

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_]+$/i),
  displayName: z.string().min(1).max(80),
  email: z.email().optional(),
  phone: phoneSchema.optional(),
  password: z.string().min(10).max(200),
});

// Slice I4: every field optional/nullable — Profile only ever changes what the user actually
// edits (Register already captured whatever was provided at signup).
const updateContactSchema = z.object({
  email: z.union([z.email(), z.null()]).optional(),
  phone: z.union([phoneSchema, z.null()]).optional(),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

function authErrorStatus(code: AuthError['code']): number {
  return code === 'USERNAME_TAKEN' ? 409 : 401;
}

export function registerAuthRoutes(app: FastifyInstance, env: Env, sql: Sql): void {
  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    try {
      const { user, sessionId, refreshToken } = await registerUser(sql, body);
      const accessToken = await signAccessToken(env.JWT_SECRET, { userId: user.id, sessionId });
      return reply.code(201).send({ user, accessToken, refreshToken });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    try {
      const { user, sessionId, refreshToken } = await loginUser(sql, body);
      const accessToken = await signAccessToken(env.JWT_SECRET, { userId: user.id, sessionId });
      return reply.send({ user, accessToken, refreshToken });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    try {
      const rotated = await refreshSession(sql, body.refreshToken);
      const accessToken = await signAccessToken(env.JWT_SECRET, {
        userId: rotated.userId,
        sessionId: rotated.sessionId,
      });
      return reply.send({ accessToken, refreshToken: rotated.refreshToken });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    await revokeSession(sql, body.refreshToken);
    return reply.code(204).send();
  });

  app.get('/api/v1/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
    const claims = token === null ? null : await verifyAccessToken(env.JWT_SECRET, token);
    if (claims === null) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const user = await findUserById(sql, claims.userId);
    if (user === null || user.status !== 'ACTIVE') {
      return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    }
    return reply.send({ user });
  });

  // Slice I4 (D19/D27) — Profile's own contact-editing surface. No PATCH /profile route
  // existed anywhere before this; verified by reading this module in full first.
  app.patch('/api/v1/me', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const body = updateContactSchema.parse(request.body);
    const user = await updateContactInfo(sql, claims.userId, body);
    return reply.send({ user });
  });
}
