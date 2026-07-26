import * as Sentry from '@sentry/node';
import type { Env } from '../config/env.ts';

export interface CrashReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
  flush(timeoutMs?: number): Promise<boolean>;
}

const NOOP_CRASH_REPORTER: CrashReporter = {
  captureException: () => {},
  flush: async () => true,
};

export function startCrashReporter(env: Env): CrashReporter {
  if (env.SENTRY_DSN === undefined) return NOOP_CRASH_REPORTER;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.VINKIN_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });

  return {
    captureException: (error, context) => {
      Sentry.withScope((scope) => {
        if (context !== undefined) scope.setContext('vinkin', context);
        Sentry.captureException(error);
      });
    },
    flush: (timeoutMs = 2_000) => Sentry.flush(timeoutMs),
  };
}
