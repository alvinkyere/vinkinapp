/**
 * Application factory. Dependencies are injected so unit tests run without PostgreSQL or
 * Redis (stub checks; `sql: null` skips DB-backed routes). Transport concerns only (D13):
 * request ids, structured logging, validation error mapping, route registration.
 */

import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
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
import type { FinancialProvider } from '../../../packages/payment-provider/src/index.ts';

export interface AppDeps extends HealthChecks {
  env: Env;
  /** null only in unit tests — DB-backed routes are then not registered. */
  sql: Sql | null;
  /** Financial provider behind the neutral interface; contribution routes need it. */
  provider?: FinancialProvider;
  /** Test override for the public-surface rate limits. */
  publicRateLimits?: PublicRateLimits;
}

export function buildApp(deps: AppDeps): FastifyInstance {
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
  }

  return app;
}
