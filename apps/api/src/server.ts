import { loadEnv } from './config/env.ts';
import { createDb } from './db/client.ts';
import { createRedis } from './redis/client.ts';
import { buildApp } from './app.ts';
import { startOtel } from './observability/otel.ts';
import { startSweepScheduler } from './jobs/sweeps.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const env = loadEnv();
const stopOtel = await startOtel(env);
const sql = createDb(env);
const redis = createRedis(env);
// The only provider until the M0 gate admits a real adapter (master plan §28).
const provider = new MockFinancialProvider();

const app = buildApp({
  env,
  sql,
  provider,
  checkDb: async () => {
    await sql`SELECT 1`;
  },
  checkRedis: async () => {
    await redis.ping();
  },
});

let stopSweeps: (() => Promise<void>) | null = null;
try {
  stopSweeps = await startSweepScheduler(env, sql, provider);
  app.log.info('deadline sweep scheduler started');
} catch (error) {
  app.log.warn({ err: error }, 'sweep scheduler not started (Redis unavailable?)');
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  if (stopSweeps !== null) await stopSweeps();
  await sql.end({ timeout: 5 });
  redis.disconnect();
  await stopOtel();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
