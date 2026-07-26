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

/** Checked-in default for local development/test only; `demo` (PV12 pilot) refuses it —
 * that's the one environment where the shared operator credential (D17) is actually used
 * by a real person, not just automated tests. */
export const DEV_OPERATOR_PASSWORD = 'dev-only-operator-password';

const envSchema = z.object({
  VINKIN_ENV: z.enum(VINKIN_ENVIRONMENTS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url().default('postgres://vinkin:vinkin@localhost:5432/vinkin'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  VINKIN_OTEL_ENABLED: z.enum(['0', '1']).default('0'),
  /** ENG4 Slice 9: optional crash-reporting endpoint. An absent DSN keeps Sentry completely
   * disabled in local/test environments; the DSN is provider-issued and never defaulted. */
  SENTRY_DSN: z.url().optional(),
  /** ENG4 Slice 4 ("metrics & observability") — a pull-based Prometheus `/metrics` endpoint
   * (own tiny HTTP server, `observability/metrics.ts`), deliberately gated by its own flag
   * rather than `VINKIN_OTEL_ENABLED`: that one is off by default because a push exporter is
   * useless without a running collector; this is scrape-based and self-contained (works with
   * nothing else running), but still opens a new port — a real behavior change that shouldn't
   * happen silently in an already-running environment, hence still default-off. */
  VINKIN_METRICS_ENABLED: z.enum(['0', '1']).default('0'),
  VINKIN_METRICS_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
  /** Slice I1 (docs/design/phase-10-implementation-readiness.md §11) — gates the D23
   * DRAFT-gate on the guest-facing views (`getPublicVinkView`/`getGuestVinkView`). The
   * additive `contributionProgress`/`vinkOutcome`/`contributionStatus` fields are always
   * present regardless of this flag (pure additions, no backward-compat risk); only the
   * genuinely breaking DRAFT-shape change is opt-in, same pattern as `VINKIN_OTEL_ENABLED`. */
  VINKIN_CONTRIBUTION_PROJECTION_ENABLED: z.enum(['0', '1']).default('0'),
  /** Slice I2B (docs/design/phase-10-implementation-readiness.md) — gates the
   * participant-inclusive transport contract: `GET /api/v1/vinks` including the caller's
   * participant-role vinks (with an additive `role` field per entry) and the new
   * `GET /api/v1/vinks/:vinkId/participant-view` route. Same static, default-off,
   * env-allowlisted pattern as `VINKIN_OTEL_ENABLED`/`VINKIN_CONTRIBUTION_PROJECTION_ENABLED`
   * — no runtime flag service. Allowlisted for development/test per Phase 10 §11; off
   * elsewhere until I6's Home/Activity consumption is proven in staging. Off preserves
   * `GET /api/v1/vinks`'s exact current organizer-only shape byte-for-byte. */
  VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL: z.enum(['0', '1']).default('0'),
  /** Invites feature (2026-07-23): gates `addParticipantCommand` inserting `INVITED` (needing
   * `acceptInviteCommand`) instead of today's immediate `JOINED`, plus the accept/decline/
   * list-invites routes themselves (404 when off, same pattern as
   * `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`). Off preserves today's exact instant-join
   * behavior byte-for-byte. */
  VINKIN_INVITES_ENABLED: z.enum(['0', '1']).default('0'),
  /** Base for share links / QR payloads — the guest web app's own origin (PV10,
   * apps/guest-web), also the allowed CORS origin for its browser fetches (app.ts). */
  VINKIN_PUBLIC_BASE_URL: z.url().default('http://localhost:3100'),
  /** Shared operator credential for the PV11 ops console (D17) — gates `/internal/ops/*`
   * alongside the existing environment allowlist (simulator-guard.ts). Not a per-operator
   * account; the operator's typed name (not this password) is what the audit log records. */
  OPERATOR_PASSWORD: z.string().min(8).default(DEV_OPERATOR_PASSWORD),
  /** Origin for the ops console's browser fetches (PV11, apps/operations-console) — a
   * second allowed CORS origin alongside VINKIN_PUBLIC_BASE_URL. */
  OPERATIONS_CONSOLE_BASE_URL: z.url().default('http://localhost:3200'),
  /** ENG1 timer semantics: one server-side source of truth for how long a Vink stays OPEN,
   * replacing the client-computed absolute deadline `apps/mobile` used to hardcode. Default
   * (86400 = 24h) is the EXACT current behavior, not a product-timing change — no decision
   * closes what the pilot's real window should be (checked docs/spec/decision-log.md and the
   * docs/design/ product-behavior docs; neither specifies a number). Revisit once one does. */
  VINK_OPEN_DURATION_SECONDS: z.coerce.number().int().positive().default(86_400),
  /** Spec §14 "Recommended initial timing": processing grace runs T to T+60s after the
   * deadline. Default (60) matches the Spec's own recommendation and the value this was
   * already hardcoded to (`PROCESSING_GRACE_SECONDS` in commands.ts) — a promotion to real
   * config, not a behavior change. "The grace duration must be configurable" (§14). */
  VINK_PROCESSING_GRACE_SECONDS: z.coerce.number().int().positive().default(60),
  /** How often the deadline-sweep job polls for OPEN/grace/stuck-contribution work
   * (apps/api/src/jobs/sweeps.ts). Default (10) matches the previous hardcoded
   * `SWEEP_INTERVAL_MS` — an operational cadence, not product timing. */
  VINK_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),
  /** Slice I4 (D19/D27) — gates automatic invitation delivery (member path only this pass;
   * see `packages/application/src/delivery.ts`'s own doc comment for why guest dispatch is
   * separately deferred). Default off. Unlike the other static flags above, this one is
   * boot-refused outside `development`/`test` (enforced in `loadEnv` below, not just
   * documented) — no real delivery provider has been selected (§4, external dependency), so
   * enabling this anywhere real traffic could reach it would either silently no-op (the mock
   * adapter is the only one that exists) or, worse, look like a real send capability that
   * isn't there. Manual sharing is always available regardless of this flag. */
  VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED: z.enum(['0', '1']).default('0'),
  /** Slice I4B (D38) — abuse-prevention cooldown between guest-invitation resend attempts,
   * per participant (`apps/api/src/modules/vinks/routes.ts`'s resend route). Same "real
   * config, not a hardcoded constant" pattern ENG1 established for the timer values below —
   * a test needs to shrink this to exercise "resend accepted" without an actual 60s sleep. */
  GUEST_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /** ENG3 ("app-version enforcement") — unset by default, meaning no enforcement at all
   * (the exact current behavior byte-for-byte, same convention as every other static flag
   * above). When set (`major.minor.patch`, e.g. `"1.0.0"`), `app.ts`'s `onRequest` hook
   * rejects a request whose `x-app-version` header is below it with `426 Upgrade Required` —
   * see `app-version.ts` for the (fail-open on anything malformed) comparison. */
  VINKIN_MINIMUM_APP_VERSION: z.string().optional(),
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
  if (env.VINKIN_ENV === 'demo' && env.OPERATOR_PASSWORD === DEV_OPERATOR_PASSWORD) {
    throw new Error(
      'OPERATOR_PASSWORD must be explicitly set in demo — the development default is refused',
    );
  }
  if (
    env.VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED === '1' &&
    env.VINKIN_ENV !== 'development' &&
    env.VINKIN_ENV !== 'test'
  ) {
    throw new Error(
      'VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED must stay off outside development/test ' +
        '— no real delivery provider is selected yet (§4)',
    );
  }
  return env;
}
