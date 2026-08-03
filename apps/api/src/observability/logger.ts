/**
 * ENG4 Slice 3 ("structured logging"): a shared Pino factory for process entry points that
 * don't get one for free from Fastify — currently only `jobs/worker.ts`, which used raw
 * `console.log` before this slice. Same `level`/`redact` shape as `app.ts`'s Fastify-embedded
 * logger, so log output is consistent (and equally secret-safe) across every process.
 */

import pino, { type Logger } from 'pino';
import type { Env } from '../config/env.ts';

export function createLogger(env: Env, bindings: Record<string, unknown> = {}): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization'],
    // ENG7 — same release-identifier binding app.ts's Fastify-embedded logger carries, so
    // apps/api/src/jobs/worker.ts (a genuinely separate OS process, ENG4 Slice 4's own
    // documented reason it needs its own metrics port too) is identifiable by build the
    // same way HTTP-request logs already are.
    base: { ...bindings, release: env.RELEASE_VERSION },
  });
}
