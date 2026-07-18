import { Redis } from 'ioredis';
import type { Env } from '../config/env.ts';

const ERROR_LOG_INTERVAL_MS = 30_000;

export function createRedis(env: Env): Redis {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    // Commands fail fast so readiness checks report "down" instead of hanging…
    maxRetriesPerRequest: 1,
    // …while the connection itself keeps retrying forever, so Redis coming back
    // makes the API ready again without a restart.
    retryStrategy: () => 2_000,
  });

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
