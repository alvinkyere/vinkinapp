import { Redis, type RedisOptions } from 'ioredis';
import type { Env } from '../config/env.ts';

const ERROR_LOG_INTERVAL_MS = 30_000;

function withThrottledErrorLog(redis: Redis): Redis {
  // ioredis emits 'error' on every failed reconnect attempt; unhandled, that spams and can
  // crash. Readiness reporting owns visibility — here we just log, throttled.
  let lastLoggedAt = 0;
  redis.on('error', (error) => {
    const now = Date.now();
    if (now - lastLoggedAt >= ERROR_LOG_INTERVAL_MS) {
      lastLoggedAt = now;
      console.error(JSON.stringify({ msg: 'redis connection error', error: String(error) }));
    }
  });
  return redis;
}

export function createRedis(env: Env, overrides: RedisOptions = {}): Redis {
  return withThrottledErrorLog(
    new Redis(env.REDIS_URL, {
      lazyConnect: true,
      // Commands fail fast so readiness checks report "down" instead of hanging…
      maxRetriesPerRequest: 1,
      // …while the connection itself keeps retrying forever, so Redis coming back
      // makes the API ready again without a restart.
      retryStrategy: () => 2_000,
      ...overrides,
    }),
  );
}

/**
 * BullMQ's Queue/Worker refuse any connection where `maxRetriesPerRequest` isn't exactly
 * `null` — they issue blocking commands (BRPOPLPUSH-family) that ioredis's request-retry
 * limiting is incompatible with; the library throws at construction otherwise ("Your redis
 * options maxRetriesPerRequest must be null"). This was broken since PV1 for both
 * `jobs/sweeps.ts` and `jobs/worker.ts` — every prior test called the sweep LOGIC
 * (`runSweeps`) directly as a pure function, never through this BullMQ wrapper, so nothing
 * caught it until `server.ts` ran as a live process for PV9's end-to-end verification.
 */
export function createBullMqRedis(env: Env): Redis {
  return createRedis(env, { maxRetriesPerRequest: null });
}
