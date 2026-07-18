import { loadEnv } from './config/env.ts';
import { createDb } from './db/client.ts';
import { createRedis } from './redis/client.ts';
import { buildApp } from './app.ts';
import { startOtel } from './observability/otel.ts';

const env = loadEnv();
const stopOtel = await startOtel(env);
const sql = createDb(env);
const redis = createRedis(env);

const app = buildApp({
  env,
  sql,
  checkDb: async () => {
    await sql`SELECT 1`;
  },
  checkRedis: async () => {
    await redis.ping();
  },
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await sql.end({ timeout: 5 });
  redis.disconnect();
  await stopOtel();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
