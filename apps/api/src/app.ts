/**
 * Application factory. Dependencies are injected so unit tests run without PostgreSQL or
 * Redis (stub checks; `sql: null` skips DB-backed routes). Transport concerns only (D13):
 * request ids, structured logging, validation error mapping, route registration.
 */

import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
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
import { RealtimeHub } from './realtime/hub.ts';
import type { FinancialProvider } from '../../../packages/payment-provider/src/index.ts';

export interface AppDeps extends HealthChecks {
  env: Env;
  /** null only in unit tests — DB-backed routes are then not registered. */
  sql: Sql | null;
  /** Financial provider behind the neutral interface; contribution routes need it. */
  provider?: FinancialProvider;
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
    registerVinkRoutes(app, deps.env, deps.sql);
    registerSharingRoutes(app, deps.env, deps.sql, deps.publicRateLimits);
    if (deps.provider !== undefined) {
      registerContributionRoutes(app, deps.env, deps.sql, deps.provider);
      registerPurchaseRoutes(app, deps.env, deps.sql, deps.provider);
      registerRecoveryRoutes(app, deps.env, deps.sql, deps.provider);
    }
    registerRealtimeRoutes(app, deps.env, deps.sql, deps.hub ?? new RealtimeHub());
  }

  return app;
}
