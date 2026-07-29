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
  /** ENG5 Slice 1 — the API's own externally-reachable origin, needed because the
   * email-verification confirm link is a plain API route a browser hits directly (no
   * client app involved), not a guest-web page. Distinct from `VINKIN_PUBLIC_BASE_URL`
   * (that one is guest-web's origin) for the same reason `OPERATIONS_CONSOLE_BASE_URL` is
   * its own separate value — three different services, three different origins. Building
   * this from the incoming request's own Host header would be fragile behind a proxy without
   * configuring Fastify's `trustProxy`; a dedicated env var matches every other base-URL
   * value in this file instead. */
  VINKIN_API_PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
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
  /** ENG5 Slice 1 (email verification) — same off-by-default, boot-refused-outside-dev/test
   * discipline as `VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED` immediately above, and for
   * the identical reason: no real email-sending provider is selected yet (§4), so a real send
   * capability can't exist outside development/test regardless of this flag. */
  VINKIN_EMAIL_VERIFICATION_ENABLED: z.enum(['0', '1']).default('0'),
  /** How long an email-verification link stays valid. Default (24h) is a plain, undisputed
   * default — no ratified decision specifies a different value (checked
   * docs/spec/decision-log.md before picking a number, same discipline ENG1's timer-semantics
   * slice established for VINK_OPEN_DURATION_SECONDS et al.). */
  EMAIL_VERIFICATION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  /** Abuse-prevention cooldown between verification-email resend attempts, per user — same
   * "real config, not a hardcoded constant" pattern as `GUEST_RESEND_COOLDOWN_SECONDS` (a
   * test needs to shrink this to exercise "resend accepted" without an actual 60s sleep). */
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /** ENG5 Slice 2 (password reset) — same off-by-default, boot-refused-outside-dev/test
   * discipline as `VINKIN_EMAIL_VERIFICATION_ENABLED`, for the identical reason (no real
   * email provider selected yet, §4). A separate flag, not a reuse of the email-verification
   * one — the two are independently rollout-able capabilities, same "one flag per feature"
   * convention `VINKIN_INVITES_ENABLED` established alongside the older delivery flag. */
  VINKIN_PASSWORD_RESET_ENABLED: z.enum(['0', '1']).default('0'),
  /** Deliberately shorter than `EMAIL_VERIFICATION_TOKEN_TTL_SECONDS` (1h vs. 24h) — a
   * password-reset link is a more security-sensitive bearer secret (it grants a full account
   * takeover, not just an email-ownership proof) and standard practice keeps its window short. */
  PASSWORD_RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  PASSWORD_RESET_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /** ENG5 Slice 3 (magic links) — same off-by-default, boot-refused-outside-dev/test
   * discipline and same reason as its two siblings; own flag, independently rollout-able. */
  VINKIN_MAGIC_LINK_ENABLED: z.enum(['0', '1']).default('0'),
  /** Shortest TTL of the three token families — a magic link grants an immediate real login
   * with no further factor (not even a password), the highest-stakes bearer secret this
   * codebase mints. 15 minutes is standard practice for that risk level. */
  MAGIC_LINK_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  MAGIC_LINK_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /** ENG5 Slice 4 — off by default like its siblings, but for a different underlying reason:
   * not "no delivery provider" (this feature sends no email) but "no real Apple Developer
   * Sign in with Apple capability configured yet" — the same class of external dependency,
   * still boot-refused outside development/test. */
  VINKIN_APPLE_SIGN_IN_ENABLED: z.enum(['0', '1']).default('0'),
  /** The expected `aud` claim on an Apple identity token (the app's own Services ID/bundle
   * ID) — required, never defaulted: accepting an unconfigured value would mean accepting a
   * token minted for a DIFFERENT app. Unset by default; the route fails closed (503) rather
   * than silently skip audience validation when this is missing. */
  APPLE_SIGN_IN_CLIENT_ID: z.string().optional(),
  /** ENG5 Slice 5 — same off-by-default, boot-refused-outside-dev/test discipline and same
   * "no real provider capability configured yet" reason as its Apple sibling; a Google Cloud
   * OAuth client, not a delivery provider. */
  VINKIN_GOOGLE_SIGN_IN_ENABLED: z.enum(['0', '1']).default('0'),
  /** The expected `aud` claim on a Google ID token (the app's own OAuth client ID) — required,
   * never defaulted, for the identical reason `APPLE_SIGN_IN_CLIENT_ID` is required. */
  GOOGLE_SIGN_IN_CLIENT_ID: z.string().optional(),
  /** ENG6 Slice 4 — mounts the sandbox Stripe webhook ingestion route (D46's own "a webhook
   * endpoint and signing secret isolated from any future live-mode endpoint" requirement).
   * Off by default like every other feature flag here, but deliberately NOT boot-refused
   * outside development/test the way `VINKIN_APPLE_SIGN_IN_ENABLED` et al. are — those flags
   * are refused elsewhere because no real provider capability exists at all yet; this one
   * guards a real, working sandbox capability (ENG6 Slice 3) that D46 explicitly permits "for
   * technical validation and demos," not scoped to any particular `VINKIN_ENV` value. The
   * actual safety mechanism is `assertSandboxModeKey` (packages/providers/src/stripe/
   * config.ts): a live-mode-shaped `STRIPE_SECRET_KEY` fails to construct the adapter at all,
   * in every environment, regardless of this flag — the credential format is the guard, not
   * the environment name. */
  VINKIN_STRIPE_WEBHOOKS_ENABLED: z.enum(['0', '1']).default('0'),
  /** ENG7 ("Observability and auditability") — a release identifier attached to every log
   * line (Pino `base` binding, `app.ts`/`observability/logger.ts`) and Sentry event
   * (`observability/sentry.ts`), so a specific deployed build can be identified in logs and
   * error reports without cross-referencing a deploy timestamp. Resolution order: an explicit
   * override, then Railway's own auto-injected commit SHA (the actual hosting platform since
   * ENG4 — real, not guessed), then `'unknown'` for local development, where neither exists. */
  RELEASE_VERSION: z.string().default('unknown'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = envSchema.parse({
    ...source,
    RELEASE_VERSION: source.RELEASE_VERSION ?? source.RAILWAY_GIT_COMMIT_SHA ?? 'unknown',
  });
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
  if (
    env.VINKIN_EMAIL_VERIFICATION_ENABLED === '1' &&
    env.VINKIN_ENV !== 'development' &&
    env.VINKIN_ENV !== 'test'
  ) {
    throw new Error(
      'VINKIN_EMAIL_VERIFICATION_ENABLED must stay off outside development/test ' +
        '— no real delivery provider is selected yet (§4)',
    );
  }
  if (
    env.VINKIN_PASSWORD_RESET_ENABLED === '1' &&
    env.VINKIN_ENV !== 'development' &&
    env.VINKIN_ENV !== 'test'
  ) {
    throw new Error(
      'VINKIN_PASSWORD_RESET_ENABLED must stay off outside development/test ' +
        '— no real delivery provider is selected yet (§4)',
    );
  }
  if (
    env.VINKIN_MAGIC_LINK_ENABLED === '1' &&
    env.VINKIN_ENV !== 'development' &&
    env.VINKIN_ENV !== 'test'
  ) {
    throw new Error(
      'VINKIN_MAGIC_LINK_ENABLED must stay off outside development/test ' +
        '— no real delivery provider is selected yet (§4)',
    );
  }
  if (
    env.VINKIN_APPLE_SIGN_IN_ENABLED === '1' &&
    env.VINKIN_ENV !== 'development' &&
    env.VINKIN_ENV !== 'test'
  ) {
    throw new Error(
      'VINKIN_APPLE_SIGN_IN_ENABLED must stay off outside development/test ' +
        '— no real Apple Developer Sign in with Apple capability is configured yet',
    );
  }
  if (
    env.VINKIN_GOOGLE_SIGN_IN_ENABLED === '1' &&
    env.VINKIN_ENV !== 'development' &&
    env.VINKIN_ENV !== 'test'
  ) {
    throw new Error(
      'VINKIN_GOOGLE_SIGN_IN_ENABLED must stay off outside development/test ' +
        '— no real Google Cloud OAuth client is configured yet',
    );
  }
  return env;
}
