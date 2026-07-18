/**
 * Environment configuration — Zod-validated at boot; the process refuses to start on an
 * invalid environment rather than limping (Spec §4.14). `VINKIN_ENV` values are the
 * governance §5 set; simulator gating uses the allowlist in `simulator-guard.ts`.
 */

import { z } from 'zod';

export const VINKIN_ENVIRONMENTS = [
  'development',
  'test',
  'demo',
  'staging',
  'production',
] as const;
export type VinkinEnvironment = (typeof VINKIN_ENVIRONMENTS)[number];

/** Checked-in default for local development only; staging/production refuse it. */
export const DEV_JWT_SECRET = 'dev-only-secret-change-me-0123456789ab';

const envSchema = z.object({
  VINKIN_ENV: z.enum(VINKIN_ENVIRONMENTS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url().default('postgres://vinkin:vinkin@localhost:5432/vinkin'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  VINKIN_OTEL_ENABLED: z.enum(['0', '1']).default('0'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = envSchema.parse(source);
  if (
    (env.VINKIN_ENV === 'production' || env.VINKIN_ENV === 'staging') &&
    env.JWT_SECRET === DEV_JWT_SECRET
  ) {
    throw new Error(
      `JWT_SECRET must be explicitly set in ${env.VINKIN_ENV} — the development default is refused`,
    );
  }
  return env;
}
