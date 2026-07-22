/**
 * Application factory. Dependencies are injected so unit tests run without PostgreSQL or
 * Redis (stub checks; `sql: null` skips DB-backed routes). Transport concerns only (D13):
 * request ids, structured logging, validation error mapping, route registration.
 */

import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import corsPlugin from '@fastify/cors';
import { ZodError } from 'zod';
import type { Env } from './config/env.ts';
import type { Sql } from './db/client.ts';
import { registerHealthRoutes, type HealthChecks } from './modules/health/routes.ts';
import { registerAuthRoutes } from './modules/auth/routes.ts';
import { registerVinkRoutes } from './modules/vinks/routes.ts';
import { registerSharingRoutes, type PublicRateLimits } from './modules/sharing/routes.ts';
import { registerContributionRoutes } from './modules/contributions/routes.ts';
import { registerPurchaseRoutes } from './modules/purchases/routes.ts';
import { registerRecoveryRoutes } from './modules/recovery/routes.ts';
import { registerRealtimeRoutes } from './modules/realtime/routes.ts';
import { registerOpsRoutes } from './modules/ops/routes.ts';
import { registerAnalyticsRoutes } from './modules/analytics/routes.ts';
import { InProcessRealtimeHub, type RealtimeHub } from './realtime/hub.ts';
import type { FinancialProvider } from '../../../packages/payment-provider/src/index.ts';
import type { DeliveryProvider } from '../../../packages/delivery/src/index.ts';

export interface AppDeps extends HealthChecks {
  env: Env;
  /** null only in unit tests — DB-backed routes are then not registered. */
  sql: Sql | null;
  /** Financial provider behind the neutral interface; contribution routes need it. */
  provider?: FinancialProvider;
  /** Slice I4 (D19/D27) — invitation-delivery provider behind the neutral interface; the
   * member-only automatic-dispatch path (`addParticipantCommand`/`openVinkCommand`) needs
   * it. Optional, exactly like `provider` above — most tests never set it, and
   * `VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED` staying off is what actually keeps
   * dispatch a no-op even when this IS provided (see `registerVinkRoutes`). */
  deliveryProvider?: DeliveryProvider;
  /** Test override for the public-surface rate limits. */
  publicRateLimits?: PublicRateLimits;
  /** Shared with the outbox publisher (server.ts) so published events reach live sockets. */
  hub?: RealtimeHub;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      redact: ['req.headers.authorization'],
    },
    genReqId: () => randomUUID(),
    logController: new LogController({
      requestIdLogLabel: 'request_id',
      disableRequestLogging: deps.env.VINKIN_ENV === 'test',
    }),
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // MUST be awaited before any route registers: @fastify/websocket wraps handlers via an
  // `onRoute` hook it adds inside its (deferred, avvio-queued) plugin body. Registering it
  // with a bare `app.register(...)` and continuing synchronously — the natural-looking
  // pattern every other route registration in this file uses — races that hook: routes
  // added before it resolves are never wrapped, so a `{websocket:true}` handler receives
  // Fastify's plain `(request, reply)` instead of `(socket, request)` and crashes reading
  // `request.params` off what is actually the reply object (PV8 integration defect; see
  // milestone report).
  await app.register(websocketPlugin);
  // PV10/PV11: the guest web app and the ops console (apps/guest-web, apps/operations-
  // console — both Next.js) run on their own origins — unlike the organizer Flutter app,
  // browser fetches are subject to CORS. `VINKIN_PUBLIC_BASE_URL` is already the guest web
  // app's own origin (it's what join links point at, PV4); `OPERATIONS_CONSOLE_BASE_URL`
  // is the same idea for PV11.
  await app.register(corsPlugin, {
    origin: [deps.env.VINKIN_PUBLIC_BASE_URL, deps.env.OPERATIONS_CONSOLE_BASE_URL],
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_FAILED',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  registerHealthRoutes(app, { checkDb: deps.checkDb, checkRedis: deps.checkRedis });
  if (deps.sql !== null) {
    registerAuthRoutes(app, deps.env, deps.sql);
    registerVinkRoutes(app, deps.env, deps.sql, deps.deliveryProvider);
    registerSharingRoutes(app, deps.env, deps.sql, deps.publicRateLimits);
    registerAnalyticsRoutes(app, deps.sql);
    if (deps.provider !== undefined) {
      registerContributionRoutes(app, deps.env, deps.sql, deps.provider);
      registerPurchaseRoutes(app, deps.env, deps.sql, deps.provider);
      registerRecoveryRoutes(app, deps.env, deps.sql, deps.provider);
      registerOpsRoutes(app, deps.env, deps.sql, deps.provider);
    }
    registerRealtimeRoutes(app, deps.env, deps.sql, deps.hub ?? new InProcessRealtimeHub());
  }

  return app;
}
