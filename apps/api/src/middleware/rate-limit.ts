/**
 * Fixed-window in-memory rate limiter for the public (unauthenticated) surface (Plan §21:
 * "rate-limit public join endpoints"). Per-process only — sufficient for the validation
 * build's single instance; a shared Redis window replaces this when horizontal scale
 * arrives (noted in the PV4 report).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

interface Window {
  startedAt: number;
  count: number;
}

export function makeRateLimiter(bucket: string, config: RateLimitConfig) {
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
