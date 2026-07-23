/**
 * Public funnel-event ingestion (PV12 prep). Anonymous by design — guest-web events happen
 * before a guest has joined anything, and even organizer-app events are cheaper to send
 * unauthenticated than to thread a JWT through a fire-and-forget analytics client. Rate-
 * limited per Plan §21's "rate-limit public join endpoints" spirit; nothing here mutates
 * any domain aggregate (D13 untouched — this is observation, not business behavior).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Sql } from '../../db/client.ts';
import { makeRateLimiter, type RateLimitConfig } from '../../middleware/rate-limit.ts';
import { insertAnalyticsEvents } from './store.ts';

const DEFAULT_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 120 };

// Exported so ENG2's client-contract tests (apps/api/src/analytics-contract.test.ts) can
// Zod-parse real @vinkin/client-contracts event literals against this exact wire schema —
// the same schema this route enforces, not a hand-mirrored copy that could drift.
export const eventSchema = z.object({
  eventName: z.string().min(1).max(120),
  vinkId: z.uuid().optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.iso.datetime(),
});

export const batchSchema = z.object({
  clientId: z.string().min(1).max(120),
  app: z.enum(['organizer_mobile', 'guest_web']),
  events: z.array(eventSchema).min(1).max(50),
});

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  sql: Sql,
  limit: RateLimitConfig = DEFAULT_LIMIT,
): void {
  const limiter = makeRateLimiter('analytics-events', limit);

  app.post('/api/v1/analytics/events', { preHandler: limiter }, async (request, reply) => {
    const body = batchSchema.parse(request.body);
    await insertAnalyticsEvents(
      sql,
      body.events.map((event) => ({
        clientId: body.clientId,
        app: body.app,
        eventName: event.eventName,
        vinkId: event.vinkId,
        properties: event.properties,
        occurredAt: event.occurredAt,
      })),
    );
    return reply.code(202).send({ accepted: body.events.length });
  });
}
