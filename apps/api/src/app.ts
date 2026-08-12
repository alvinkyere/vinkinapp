/**
 * Application factory. Dependencies are injected so unit tests run without PostgreSQL or
 * Redis (stub checks; `sql: null` skips DB-backed routes). Transport concerns only (D13):
 * request ids, structured logging, validation error mapping, route registration.
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import corsPlugin from '@fastify/cors';
import helmetPlugin from '@fastify/helmet';
import type { Redis } from 'ioredis';
import { ZodError } from 'zod';
import type { Env } from './config/env.ts';
import type { Sql } from './db/client.ts';
import { registerHealthRoutes, type HealthChecks } from './modules/health/routes.ts';
import { registerPaymentMethodRoutes } from './modules/payment-methods/routes.ts';
import { registerAuthRoutes, type AuthRateLimits } from './modules/auth/routes.ts';
import { registerVinkRoutes } from './modules/vinks/routes.ts';
import { registerSharingRoutes, type PublicRateLimits } from './modules/sharing/routes.ts';
import {
  registerContributionRoutes,
  processContributionPaymentEvent,
} from './modules/contributions/routes.ts';
import { registerPurchaseRoutes } from './modules/purchases/routes.ts';
import { registerRecoveryRoutes } from './modules/recovery/routes.ts';
import { registerRealtimeRoutes } from './modules/realtime/routes.ts';
import { registerOpsRoutes } from './modules/ops/routes.ts';
import { registerAnalyticsRoutes } from './modules/analytics/routes.ts';
import { registerWebhookRoutes, type WebhookRouteConfig } from './modules/webhooks/routes.ts';
import { registerReconciliationOpsRoutes } from './modules/reconciliation/routes.ts';
import { InProcessRealtimeHub, type RealtimeHub } from './realtime/hub.ts';
import { isAppVersionSupported } from './app-version.ts';
import { NOOP_METRICS, type Metrics } from './observability/metrics.ts';
import type { FinancialProvider } from '../../../packages/payment-provider/src/index.ts';
import type { DeliveryProvider } from '../../../packages/delivery/src/index.ts';
import type { CrashReporter } from './observability/sentry.ts';

export interface AppDeps extends HealthChecks {
  env: Env;
  /** null only in unit tests — DB-backed routes are then not registered. */
  sql: Sql | null;
  /** Financial provider behind the neutral interface; contribution routes need it. */
  provider?: FinancialProvider;
  /** Slice I4 (D19/D27) — invitation-delivery provider behind the neutral interface; the
   * member-only automatic-dispatch path (`addParticipantCommand`/`openVinkCommand`) needs
   * it. Optional, exactly like `provider` above — most tests never set it, and
   * `VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED` staying off is what actually keeps
   * dispatch a no-op even when this IS provided (see `registerVinkRoutes`). */
  deliveryProvider?: DeliveryProvider;
  /** Test override for the public-surface rate limits. */
  publicRateLimits?: PublicRateLimits;
  /** ENG5 Slice 2 — test override for the auth-surface rate limits (password-reset request). */
  authRateLimits?: AuthRateLimits;
  /** ENG5 Slice 4 — test-only override for Apple identity token verification; see
   * `registerAuthRoutes`'s own doc comment on the parameter this threads to. */
  appleKeyResolver?: Parameters<typeof registerAuthRoutes>[5];
  /** ENG5 Slice 5 — same test-only override, for Google's key resolver. */
  googleKeyResolver?: Parameters<typeof registerAuthRoutes>[6];
  /** Shared with the outbox publisher (server.ts) so published events reach live sockets. */
  hub?: RealtimeHub;
  /** Slice I4B (D38) — test-only hook: a writable stream Pino writes every log line to,
   * letting a test assert on the actual serialized log output (e.g. "no raw guest token or
   * contact destination ever appears in a log line") instead of trusting that no code path
   * logs one. Omitted in production — Fastify/Pino default to stdout. */
  logStream?: NodeJS.WritableStream;
  /** ENG4 Slice 4 ("metrics & observability") — defaults to a genuine no-op so every existing
   * test/caller that never sets this is unaffected. */
  metrics?: Metrics;
  /** ENG4 Slice 9: optional and no-op by default, like metrics. */
  crashReporter?: CrashReporter;
  /** ENG6 Slice 4 — sandbox provider webhook endpoints (D46), mounted only when the caller
   * supplies one (server.ts does so only when `VINKIN_STRIPE_WEBHOOKS_ENABLED === '1'`).
   * Empty/undefined preserves today's exact route surface byte-for-byte. */
  webhookRoutes?: WebhookRouteConfig[];
  /** ENG8 — threaded into every rate-limited route module so windows are correct across
   * multiple API instances (Redis-backed) rather than per-process only. Undefined preserves
   * the original in-memory behavior (all existing tests, local dev without Redis). */
  redis?: Redis;
  /** ENG9 — `server.ts` sets this `false` so a genuinely in-flight request survives a real
   * shutdown (see the constant's own doc comment below for the confirmed defect this closes).
   * Deliberately NOT the default for every caller of `buildApp`: several existing integration
   * suites open real WebSocket connections and call `app.close()` in their own `after()` hook
   * with no timeout of their own — Fastify's normal `forceCloseConnections: 'idle'` is what
   * lets THAT `close()` resolve promptly (an idle WS connection is exactly the case that
   * setting exists for). `server.ts` is the one caller with its own bounded-timeout wrapper
   * around `close()`, so it's the only one that needs and can safely use `false`. */
  forceCloseConnections?: boolean;
}

// ENG8 ("input-size limits"): Fastify's own undocumented-in-code default (1 MiB) was already
// the effective limit — this makes it an explicit, intentional value instead of an unexamined
// default. Every real request body in this app is a small JSON payload; the largest is a
// provider webhook event, which Stripe's own docs bound well under this (a few KB typically,
// low hundreds of KB in pathological cases) — 1 MiB leaves headroom without being large enough
// to be a meaningful DoS vector on its own.
const MAX_BODY_BYTES = 1_048_576;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: MAX_BODY_BYTES,
    // ENG9 ("deployment during an active Vink") — a real, confirmed defect a live SIGTERM
    // test caught: Fastify's DEFAULT (`forceCloseConnections: 'idle'`, on by default whenever
    // the Node version supports `closeIdleConnections()`) force-closes any connection Node's
    // own idle-heuristic considers inactive — and that heuristic looks at socket-level I/O,
    // not the application's handler lifecycle. A connection whose request has been fully
    // received but whose async handler is still mid-flight (e.g. inside a DB transaction) has
    // no socket I/O happening at that instant, so Node's `closeIdleConnections()` treated it
    // as idle and destroyed it — silently dropping an already-committed-or-committing request
    // on every graceful shutdown, proven with a minimal reproduction outside this app (a bare
    // Fastify instance with a `setTimeout`-delayed handler) before touching this file. Setting
    // this to `false` (only `server.ts` does — see `AppDeps.forceCloseConnections`'s own doc
    // comment for why every other caller keeps Fastify's normal default) disables that
    // automatic force-close entirely; `server.ts`'s own shutdown wraps `app.close()` in a
    // bounded timeout instead, so a shutdown can't hang forever on a connection that never
    // voluntarily closes (the risk `forceCloseConnections` exists to prevent) while still
    // letting genuinely in-flight requests finish first.
    forceCloseConnections: deps.forceCloseConnections,
    logger: {
      level: deps.env.LOG_LEVEL,
      redact: ['req.headers.authorization'],
      // ENG7 — every log line carries the deployed release identifier (Railway's own commit
      // SHA in production, 'unknown' locally), so a specific build is identifiable in logs
      // without cross-referencing a deploy timestamp. Pino's `base` option REPLACES its
      // default `{pid, hostname}` binding rather than merging with it, so both are restated
      // explicitly here — otherwise this change would silently drop them from every log line.
      base: { pid: process.pid, hostname: hostname(), release: deps.env.RELEASE_VERSION },
      ...(deps.logStream !== undefined && { stream: deps.logStream }),
    },
    genReqId: () => randomUUID(),
    logController: new LogController({
      requestIdLogLabel: 'request_id',
      disableRequestLogging: deps.env.VINKIN_ENV === 'test',
    }),
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // ENG4 Slice 4 ("API latency"): the route PATTERN (`/vinks/:vinkId`), never the resolved
  // URL — using the resolved URL would give every UUID path segment its own label value, an
  // unbounded-cardinality anti-pattern for a metrics label. `routeOptions.url` is undefined
  // only for an unmatched (404) request.
  const metrics = deps.metrics ?? NOOP_METRICS;
  app.addHook('onResponse', async (request, reply) => {
    metrics.recordApiRequest({
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
  });

  // ENG3 ("app-version enforcement"): a no-op whenever VINKIN_MINIMUM_APP_VERSION is unset
  // (the default) or a request carries no x-app-version header at all — apps/guest-web and
  // apps/operations-console never send one, so they're unaffected by construction. Only
  // apps/mobile ever sends this header (ApiClient's own interceptor).
  if (deps.env.VINKIN_MINIMUM_APP_VERSION !== undefined) {
    const minimumVersion = deps.env.VINKIN_MINIMUM_APP_VERSION;
    app.addHook('onRequest', async (request, reply) => {
      const clientVersion = request.headers['x-app-version'];
      if (typeof clientVersion !== 'string') return;
      if (!isAppVersionSupported(clientVersion, minimumVersion)) {
        return reply.code(426).send({
          error: 'APP_VERSION_UNSUPPORTED',
          message: 'This version of VinkIn is no longer supported. Please update the app.',
        });
      }
    });
  }

  // MUST be awaited before any route registers: @fastify/websocket wraps handlers via an
  // `onRoute` hook it adds inside its (deferred, avvio-queued) plugin body. Registering it
  // with a bare `app.register(...)` and continuing synchronously — the natural-looking
  // pattern every other route registration in this file uses — races that hook: routes
  // added before it resolves are never wrapped, so a `{websocket:true}` handler receives
  // Fastify's plain `(request, reply)` instead of `(socket, request)` and crashes reading
  // `request.params` off what is actually the reply object (PV8 integration defect; see
  // milestone report).
  await app.register(websocketPlugin);
  // PV10/PV11: the guest web app and the ops console (apps/guest-web, apps/operations-
  // console — both Next.js) run on their own origins — unlike the organizer Flutter app,
  // browser fetches are subject to CORS. `VINKIN_PUBLIC_BASE_URL` is already the guest web
  // app's own origin (it's what join links point at, PV4); `OPERATIONS_CONSOLE_BASE_URL`
  // is the same idea for PV11.
  await app.register(corsPlugin, {
    origin: [deps.env.VINKIN_PUBLIC_BASE_URL, deps.env.OPERATIONS_CONSOLE_BASE_URL],
  });

  // ENG8 ("secure headers"). Two deliberate deviations from @fastify/helmet's defaults, both
  // disclosed rather than silently accepted:
  //   - `contentSecurityPolicy: false` — the default policy's `script-src 'self'` would break
  //     the two real inline-`<script>` HTML pages this API serves (password-reset confirm,
  //     magic-link confirm; see auth/routes.ts). A correct CSP for those two pages (nonces or
  //     externalizing the scripts) is a real follow-up, not invented here.
  //   - `crossOriginResourcePolicy: { policy: 'cross-origin' }` — the default (`same-origin`)
  //     blocks this API's responses from being read by apps/guest-web and
  //     apps/operations-console, which run on different origins and are the entire reason
  //     `corsPlugin` above exists. This API is deliberately fetched cross-origin by two known,
  //     allowlisted first-party apps; CORP's same-origin default is for APIs that never expect
  //     that.
  await app.register(helmetPlugin, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_FAILED',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    // ENG8 real bug found via live verification (not a new regression — the implicit 1 MiB
    // default body limit already produced this same FastifyError before `bodyLimit` was made
    // explicit; nobody had exercised the path). Fastify's own framework-generated errors
    // (`FST_ERR_*` — body too large, malformed content-type, unsupported media type, etc.)
    // already carry the correct client-facing status; collapsing every one of them to a bare
    // 500 hid a real, well-formed 413/400/415 behind an "INTERNAL_ERROR" that implies a server
    // defect. Only trusted for Fastify's own tagged errors, not arbitrary thrown errors —
    // application code never sets `.code`/`.statusCode` this way.
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code.startsWith('FST_ERR_') &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    deps.crashReporter?.captureException(error, {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
    });
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  registerHealthRoutes(app, { checkDb: deps.checkDb, checkRedis: deps.checkRedis });
  // RM4C-B: no DB dependency (pure function of env) — registered unconditionally, same as
  // health routes, so it works even in the provider-less/DB-less test app shape.
  registerPaymentMethodRoutes(app, deps.env);
  if (deps.sql !== null) {
    registerAuthRoutes(
      app,
      deps.env,
      deps.sql,
      deps.deliveryProvider,
      deps.authRateLimits,
      deps.appleKeyResolver,
      deps.googleKeyResolver,
      deps.redis,
    );
    registerVinkRoutes(app, deps.env, deps.sql, deps.deliveryProvider, metrics);
    registerSharingRoutes(app, deps.env, deps.sql, deps.publicRateLimits, deps.redis);
    registerAnalyticsRoutes(app, deps.sql, undefined, deps.redis);
    if (deps.provider !== undefined) {
      registerContributionRoutes(app, deps.env, deps.sql, deps.provider, metrics);
      registerPurchaseRoutes(app, deps.env, deps.sql, deps.provider, metrics);
      registerRecoveryRoutes(app, deps.env, deps.sql, deps.provider, metrics);
      registerOpsRoutes(app, deps.env, deps.sql, deps.provider, metrics);
    }
    registerRealtimeRoutes(
      app,
      deps.env,
      deps.sql,
      deps.hub ?? new InProcessRealtimeHub(),
      metrics,
    );
    for (const webhookConfig of deps.webhookRoutes ?? []) {
      // Captured locally: TS narrowing on `deps.sql !== null` above doesn't survive into the
      // closure passed below.
      const sql = deps.sql;
      const commandProvider = deps.provider;
      registerWebhookRoutes(
        app,
        sql,
        webhookConfig,
        metrics,
        // RM4C (D49): re-enters the contribution engine (via the ALREADY-hardened
        // `resolveContributionCommand`, never a new resolver) only when a real
        // command-execution provider is wired in — `deps.provider` is undefined in the
        // provider-less test/health-only app shape some existing tests build.
        commandProvider !== undefined
          ? (event, request) =>
              processContributionPaymentEvent(sql, commandProvider, event, request.log, metrics)
          : undefined,
      );
    }
    registerReconciliationOpsRoutes(
      app,
      deps.env,
      deps.sql,
      new Map((deps.webhookRoutes ?? []).map((config) => [config.provider.providerName, config])),
    );
  }

  return app;
}
