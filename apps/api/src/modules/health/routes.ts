import type { FastifyInstance } from 'fastify';

export interface HealthChecks {
  checkDb: () => Promise<void>;
  checkRedis: () => Promise<void>;
}

const CHECK_TIMEOUT_MS = 2_000;

async function runCheck(check: () => Promise<void>): Promise<'ok' | 'down'> {
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('health check timed out')), CHECK_TIMEOUT_MS).unref(),
      ),
    ]);
    return 'ok';
  } catch {
    return 'down';
  }
}

export function registerHealthRoutes(app: FastifyInstance, checks: HealthChecks): void {
  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    const [database, redis] = await Promise.all([
      runCheck(checks.checkDb),
      runCheck(checks.checkRedis),
    ]);
    const ready = database === 'ok' && redis === 'ok';
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'unavailable',
      checks: { database, redis },
    });
  });
}
