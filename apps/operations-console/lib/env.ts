/**
 * ENG4 Slice 1: server-side fail-fast environment validation, mirroring the pattern
 * `apps/api/src/config/env.ts` already established (Zod-validated, refuses known-unsafe
 * defaults outside development/test). This module is deliberately NOT what `lib/config.ts`'s
 * client-bundled `API_BASE_URL` reads from — Next.js inlines `process.env.NEXT_PUBLIC_*`
 * into the browser bundle only when referenced as a literal `process.env.NEXT_PUBLIC_X`
 * expression at build time; routing that value through a dynamically-parsed Zod schema would
 * silently break it in the browser. `config.ts`'s literal read stays exactly as it is. This
 * module exists purely as a server-side (Node process boot) validation and refusal layer —
 * see `scripts/validate-env.ts`, run before `next start`.
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

/** The exact default `lib/config.ts` falls back to — refused outside development/test, same
 * shape as `apps/api/src/config/env.ts`'s `DEV_JWT_SECRET` refusal. */
export const DEV_API_BASE_URL = 'http://127.0.0.1:3000';

const envSchema = z.object({
  VINKIN_ENV: z.enum(VINKIN_ENVIRONMENTS).default('development'),
  NEXT_PUBLIC_API_BASE_URL: z.url().default(DEV_API_BASE_URL),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = envSchema.parse(source);
  if (
    (env.VINKIN_ENV === 'staging' || env.VINKIN_ENV === 'production') &&
    env.NEXT_PUBLIC_API_BASE_URL === DEV_API_BASE_URL
  ) {
    throw new Error(
      `NEXT_PUBLIC_API_BASE_URL must be explicitly set in ${env.VINKIN_ENV} — the ` +
        'development default (a loopback address) is refused',
    );
  }
  return env;
}
