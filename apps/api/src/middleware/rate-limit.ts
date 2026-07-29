/**
 * Fixed-window rate limiter for the public (unauthenticated) surface (Plan §21: "rate-limit
 * public join endpoints"). ENG8: Redis-backed when a client is supplied — correct across
 * multiple API instances, the gap the original in-memory-only version disclosed since PV4
 * ("a shared Redis window replaces this when horizontal scale arrives"). Falls back to the
 * original per-process in-memory window when no Redis client is given (unit tests, local dev
 * without Redis) — same optional-port pattern as `metrics`/`logger` elsewhere in this app.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

interface Window {
  startedAt: number;
  count: number;
}

function inMemoryRateLimiter(bucket: string, config: RateLimitConfig) {
  const windows = new Map<string, Window>();

  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const now = Date.now();
    const key = `${bucket}:${request.ip}`;
    const current = windows.get(key);
    if (current === undefined || now - current.startedAt >= config.windowMs) {
      // Lazy sweep: drop stale windows so the map cannot grow unboundedly.
      if (windows.size > 10_000) {
        for (const [entryKey, entry] of windows) {
          if (now - entry.startedAt >= config.windowMs) windows.delete(entryKey);
        }
      }
      windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > config.max) {
      const retryAfterSeconds = Math.ceil((current.startedAt + config.windowMs - now) / 1000);
      reply.header('retry-after', String(Math.max(retryAfterSeconds, 1)));
      await reply.code(429).send({ error: 'RATE_LIMITED' });
    }
  };
}

function redisRateLimiter(bucket: string, config: RateLimitConfig, redis: Redis) {
  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = `ratelimit:${bucket}:${request.ip}`;
    let count: number;
    try {
      // INCR-then-PEXPIRE (not a single atomic op): a rate limiter's own worst case on a rare
      // race is one window running slightly long, which is the correct trade-off here —
      // unlike the ledger/idempotency paths, this is not a financial-correctness boundary
      // (D-rules scope), so a Lua script/MULTI isn't warranted for it.
      count = await redis.incr(key);
      if (count === 1) {
        await redis.pexpire(key, config.windowMs);
      }
    } catch (error) {
      // Fail OPEN, not closed: a transient Redis outage should degrade rate limiting, not
      // turn every password-reset/magic-link/join request into a 500. This mirrors
      // `createRedis`'s own fast-fail-then-keep-retrying design — the connection itself
      // recovers on its own; this middleware just shouldn't block real traffic meanwhile.
      request.log.warn({ err: error, bucket }, 'rate limiter Redis call failed; allowing request');
      return;
    }
    if (count > config.max) {
      const ttlMs = await redis.pttl(key);
      const retryAfterSeconds = Math.ceil(Math.max(ttlMs, 0) / 1000);
      reply.header('retry-after', String(Math.max(retryAfterSeconds, 1)));
      await reply.code(429).send({ error: 'RATE_LIMITED' });
    }
  };
}

export function makeRateLimiter(bucket: string, config: RateLimitConfig, redis?: Redis) {
  return redis === undefined
    ? inMemoryRateLimiter(bucket, config)
    : redisRateLimiter(bucket, config, redis);
}
