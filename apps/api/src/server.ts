import { loadEnv } from './config/env.ts';
import { createDb } from './db/client.ts';
import { createRedis } from './redis/client.ts';
import { buildApp } from './app.ts';
import { startOtel } from './observability/otel.ts';
import { startMetrics } from './observability/metrics.ts';
import { startSweepScheduler } from './jobs/sweeps.ts';
import { startOutboxPublisher } from './realtime/outbox-publisher.ts';
import { RedisRealtimeHub } from './realtime/redis-hub.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';
import { MockDeliveryProvider } from '../../../packages/delivery/src/index.ts';
import { startCrashReporter } from './observability/sentry.ts';

const env = loadEnv();
const crashReporter = startCrashReporter(env);
const stopOtel = await startOtel(env);
const { metrics, stop: stopMetrics } = await startMetrics(env);
const sql = createDb(env);
const redis = createRedis(env);
// The only provider until the M0 gate admits a real adapter (master plan §28).
const provider = new MockFinancialProvider();
// Slice I4 — the only delivery provider until a real one is selected (§4); threaded through
// regardless of VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED — that flag (env-boot-refused
// outside development/test) is the actual gate, not whether this exists.
const deliveryProvider = new MockDeliveryProvider();
// Redis-backed (D16): shared with the outbox publisher below, and correct across multiple
// API instances. A dedicated connection for SUBSCRIBE — ioredis locks a connection into
// subscriber-only mode the moment .subscribe() is first called.
const realtimePub = createRedis(env);
const realtimeSub = createRedis(env);
const hub = new RedisRealtimeHub(realtimePub, realtimeSub);

const checkDb = async (): Promise<void> => {
  await sql`SELECT 1`;
};
const checkRedis = async (): Promise<void> => {
  await redis.ping();
};

const app = await buildApp({
  env,
  sql,
  provider,
  deliveryProvider,
  hub,
  metrics,
  checkDb,
  checkRedis,
  crashReporter,
});

// ENG4 Slice 4 ("health status" metric): reuses the exact same checks `/health/ready` already
// runs, mirrored into a gauge — no new health-determination logic, just an additional way to
// observe the one that already exists.
metrics.registerObservableGauge('vinkin_health_status', async (observe) => {
  for (const [check, run] of [
    ['database', checkDb],
    ['redis', checkRedis],
  ] as const) {
    try {
      await run();
      observe(1, { check });
    } catch {
      observe(0, { check });
    }
  }
});

const stopOutboxPublisher = startOutboxPublisher(sql, hub);

let stopSweeps: (() => Promise<void>) | null = null;
try {
  stopSweeps = await startSweepScheduler(env, sql, provider, metrics);
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
  stopOutboxPublisher();
  if (stopSweeps !== null) await stopSweeps();
  await sql.end({ timeout: 5 });
  redis.disconnect();
  realtimePub.disconnect();
  realtimeSub.disconnect();
  await stopOtel();
  await stopMetrics();
  await crashReporter.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
