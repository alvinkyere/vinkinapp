/**
 * Sharing + guest transport (PV4). Organizer share-link/QR endpoints require auth; the
 * join surface is public and rate-limited (Plan §21). Thin bindings over the application
 * layer (D13) — the raw guest token is minted HERE and only its hash crosses inward.
 */

import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import {
  ApplicationError,
  getGuestVinkView,
  getPublicVinkView,
  getVinkSnapshot,
  guestJoinVinkCommand,
} from '../../../../../packages/application/src/index.ts';
import type { VinkId } from '../../../../../packages/domain/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { requireUser } from '../../auth/http.ts';
import { GUEST_TOKEN_PREFIX, hashGuestToken, newGuestToken } from '../../auth/guest-tokens.ts';
import { makeRateLimiter, type RateLimitConfig } from '../../middleware/rate-limit.ts';
import { publicCodeParams, vinkIdParams } from '../../middleware/params.ts';
import { PostgresVinkStore } from '../vinks/store.ts';
import { toCommandLogger } from '../../observability/command-logger.ts';
import { tagActiveSpan } from '../../observability/tracing.ts';

export interface PublicRateLimits {
  publicView: RateLimitConfig;
  publicJoin: RateLimitConfig;
}

export const DEFAULT_PUBLIC_RATE_LIMITS: PublicRateLimits = {
  publicView: { windowMs: 60_000, max: 120 },
  publicJoin: { windowMs: 60_000, max: 30 },
};

const joinSchema = z.object({
  displayName: z.string().min(1).max(80),
});

function guestError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (!(error instanceof ApplicationError)) return null;
  const status =
    error.code === 'VINK_NOT_FOUND'
      ? 404
      : error.code === 'VINK_NOT_JOINABLE'
        ? 410
        : error.code === 'GUEST_UNAUTHENTICATED'
          ? 401
          : error.code === 'FORBIDDEN'
            ? 403
            : 422;
  return { status, body: { error: error.code, message: error.message } };
}

export function registerSharingRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  limits: PublicRateLimits = DEFAULT_PUBLIC_RATE_LIMITS,
  /** ENG8 — Redis-backed rate-limit windows; undefined falls back to in-memory. */
  redis?: Redis,
): void {
  const store = new PostgresVinkStore(sql);
  const viewLimiter = makeRateLimiter('public-view', limits.publicView, redis);
  const joinLimiter = makeRateLimiter('public-join', limits.publicJoin, redis);

  function joinUrl(publicCode: string): string {
    return `${env.VINKIN_PUBLIC_BASE_URL.replace(/\/$/, '')}/join/${publicCode}`;
  }

  // --- Organizer sharing surface (authenticated) ---------------------------

  // ENG2: these were POST — the handler's own comment already said "this is a query, not a
  // command"; no client calls either route yet, so correcting the verb to GET has zero
  // client impact.
  for (const path of ['share-links', 'qr'] as const) {
    app.get(`/api/v1/vinks/:vinkId/${path}`, async (request, reply) => {
      const claims = await requireUser(request, reply, env);
      if (claims === null) return;
      const { vinkId } = vinkIdParams.parse(request.params);
      try {
        // Snapshot re-checks ownership; sharing needs no state change (the code is minted
        // at creation), so this is a query, not a command.
        const snapshot = await getVinkSnapshot(store, vinkId as VinkId, claims.userId);
        const publicCode = snapshot.vink.publicCode;
        if (path === 'share-links') {
          return reply.send({
            publicCode,
            url: joinUrl(publicCode),
            submissionDeadline: snapshot.vink.submissionDeadline,
          });
        }
        // QR payload contract v1: clients render this as a QR image (no server-side image).
        return reply.send({
          format: 'vinkin.join.v1',
          publicCode,
          url: joinUrl(publicCode),
        });
      } catch (error) {
        const mapped = guestError(error);
        if (mapped === null) throw error;
        return reply.code(mapped.status).send(mapped.body);
      }
    });
  }

  // --- Public surface (anonymous, rate-limited) ----------------------------

  app.get('/api/v1/join/:publicCode', { preHandler: viewLimiter }, async (request, reply) => {
    const { publicCode } = publicCodeParams.parse(request.params);
    try {
      // D23 (Slice I1) — the DRAFT-gate is opt-in behind the flag; additive fields
      // (contributionProgress/vinkOutcome) are always present regardless.
      return reply.send(
        await getPublicVinkView(store, publicCode, new Date(), {
          gateDraft: env.VINKIN_CONTRIBUTION_PROJECTION_ENABLED === '1',
        }),
      );
    } catch (error) {
      const mapped = guestError(error);
      if (mapped === null) throw error;
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post(
    '/api/v1/public/vinks/:publicCode/participants',
    { preHandler: joinLimiter },
    async (request, reply) => {
      const { publicCode } = publicCodeParams.parse(request.params);
      const body = joinSchema.parse(request.body);
      const { token, tokenHash } = newGuestToken();
      tagActiveSpan({ 'correlation.id': String(request.id) });
      try {
        const joined = await guestJoinVinkCommand(
          {
            uow: store,
            clock: { now: () => new Date() },
            correlationId: String(request.id),
            logger: toCommandLogger(request.log),
          },
          { publicCode, displayName: body.displayName, accessTokenHash: tokenHash },
        );
        // The raw token appears exactly once, here, in the join response. vinkId (not part
        // of the anonymous pre-join PublicVinkSummary) is included now that this guest has
        // genuinely joined — PV10's guest web client needs it to open the realtime channel,
        // the same vinkId-keyed route the organizer app uses.
        return reply.code(201).send({
          guestToken: token,
          vink: joined.vink,
          participant: {
            id: joined.participant.id,
            vinkId: joined.participant.vinkId,
            displayName: joined.participant.displayName,
            status: joined.participant.status,
          },
        });
      } catch (error) {
        const mapped = guestError(error);
        if (mapped === null) throw error;
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get('/api/v1/guest/session', async (request, reply) => {
    const header = request.headers.authorization;
    const token =
      header?.startsWith(`Bearer ${GUEST_TOKEN_PREFIX}`) === true
        ? header.slice('Bearer '.length)
        : null;
    if (token === null) return reply.code(401).send({ error: 'GUEST_UNAUTHENTICATED' });
    try {
      return reply.send(
        await getGuestVinkView(store, hashGuestToken(token), new Date(), {
          gateDraft: env.VINKIN_CONTRIBUTION_PROJECTION_ENABLED === '1',
        }),
      );
    } catch (error) {
      const mapped = guestError(error);
      if (mapped === null) throw error;
      return reply.code(mapped.status).send(mapped.body);
    }
  });
}
