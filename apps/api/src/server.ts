import { loadEnv } from './config/env.ts';
import { createDb } from './db/client.ts';
import { createRedis } from './redis/client.ts';
import { buildApp } from './app.ts';
import { startOtel } from './observability/otel.ts';
import { startMetrics } from './observability/metrics.ts';
import { startSweepScheduler } from './jobs/sweeps.ts';
import { startOutboxPublisher } from './realtime/outbox-publisher.ts';
import { RedisRealtimeHub } from './realtime/redis-hub.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';
import type { FinancialProvider } from '../../../packages/payment-provider/src/index.ts';
import {
  MockDeliveryProvider,
  ResendDeliveryProvider,
} from '../../../packages/delivery/src/index.ts';
import type { DeliveryProvider } from '../../../packages/delivery/src/index.ts';
import { startCrashReporter } from './observability/sentry.ts';
import {
  StripeFinancialProvider,
  loadStripeAdapterConfig,
} from '../../../packages/providers/src/index.ts';
import type { WebhookRouteConfig } from './modules/webhooks/routes.ts';

const env = loadEnv();
const crashReporter = startCrashReporter(env);
const stopOtel = await startOtel(env);
const { metrics, stop: stopMetrics } = await startMetrics(env);
const sql = createDb(env);
const redis = createRedis(env);
// RM4C (D49): `VINKIN_FINANCIAL_PROVIDER` selects the one provider driving every command in
// this process — defaults to `mock` (the only provider until this milestone, master plan
// §28, unchanged behavior). `stripe_sandbox` is a genuine, explicit opt-in for demonstrating
// real participant card payments through Stripe's sandbox; `loadStripeAdapterConfig` already
// enforces D46's sandbox-only guarantee (`assertSandboxModeKey` — a live-mode key fails to
// construct this at all, regardless of this flag or VINKIN_ENV). See env.ts's own doc
// comment for the disclosed trade-off: card-pool/wallet-provisioning commands (RM2/RM3B)
// will visibly throw NOT_SUPPORTED in this mode, since Stripe honestly declares
// `walletProvisioning: false` — never silently emulated (§9, §21, D7).
const provider: FinancialProvider =
  env.VINKIN_FINANCIAL_PROVIDER === 'stripe_sandbox'
    ? new StripeFinancialProvider(loadStripeAdapterConfig())
    : new MockFinancialProvider();
// RM4D — closes the "no real delivery provider is selected yet (§4)" gap Slice I4 first
// disclosed: `RESEND_API_KEY`/`RESEND_FROM_EMAIL` presence is the actual selector (same
// credential-is-the-guard discipline as `VINKIN_FINANCIAL_PROVIDER` above), not `VINKIN_ENV`.
// Absent both, this is byte-for-byte the same `MockDeliveryProvider` every prior milestone
// ran against. Threaded through regardless of the four delivery-gated flags
// (VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED et al.) — those flags (env.ts's own
// conditional boot-refusal) are the actual gate, not whether this exists.
const deliveryProvider: DeliveryProvider =
  env.RESEND_API_KEY !== undefined && env.RESEND_FROM_EMAIL !== undefined
    ? new ResendDeliveryProvider(
        { apiKey: env.RESEND_API_KEY, fromEmail: env.RESEND_FROM_EMAIL },
        { isProduction: env.VINKIN_ENV === 'production' },
      )
    : new MockDeliveryProvider();
// Redis-backed (D16): shared with the outbox publisher below, and correct across multiple
// API instances. A dedicated connection for SUBSCRIBE — ioredis locks a connection into
// subscriber-only mode the moment .subscribe() is first called.
const realtimePub = createRedis(env);
const realtimeSub = createRedis(env);
const hub = new RedisRealtimeHub(realtimePub, realtimeSub);

// ENG6 Slice 4 (D46) — a sandbox-only Stripe webhook endpoint, isolated from command
// execution: this StripeFinancialProvider instance is used only to verify/parse inbound
// webhooks, never to drive `provider` (still Mock) above. Fails loudly at boot if the flag
// is on but credentials are missing/live-mode-shaped — the same fail-fast discipline as
// every other required-when-enabled config in this file, not a silent no-op.
const webhookRoutes: WebhookRouteConfig[] = [];
if (env.VINKIN_STRIPE_WEBHOOKS_ENABLED === '1') {
  const stripeConfig = loadStripeAdapterConfig();
  webhookRoutes.push({
    routePath: '/webhooks/stripe/sandbox',
    provider: new StripeFinancialProvider(stripeConfig),
    webhookSecret: stripeConfig.webhookSecret,
    signatureHeaderName: 'stripe-signature',
  });
}

const checkDb = async (): Promise<void> => {
  await sql`SELECT 1`;
};
const checkRedis = async (): Promise<void> => {
  await redis.ping();
};

const app = await buildApp({
  env,
  sql,
  provider,
  deliveryProvider,
  hub,
  metrics,
  checkDb,
  checkRedis,
  crashReporter,
  webhookRoutes,
  // ENG8: the same connection `checkRedis` already uses — rate-limit windows are now correct
  // across multiple API instances instead of per-process only. Reusing it (not a dedicated
  // connection, unlike `realtimePub`/`realtimeSub`) because INCR/PEXPIRE/PTTL are all regular
  // commands, not SUBSCRIBE — no mode-locking concern.
  redis,
  // ENG9 — see `AppDeps.forceCloseConnections`'s own doc comment in app.ts. Only the real
  // process sets this; `shutdown()` below is the bounded-timeout wrapper that makes it safe.
  forceCloseConnections: false,
});

// ENG4 Slice 4 ("health status" metric): reuses the exact same checks `/health/ready` already
// runs, mirrored into a gauge — no new health-determination logic, just an additional way to
// observe the one that already exists.
metrics.registerObservableGauge('vinkin_health_status', async (observe) => {
  for (const [check, run] of [
    ['database', checkDb],
    ['redis', checkRedis],
  ] as const) {
    try {
      await run();
      observe(1, { check });
    } catch {
      observe(0, { check });
    }
  }
});

const stopOutboxPublisher = startOutboxPublisher(sql, hub);

let stopSweeps: (() => Promise<void>) | null = null;
try {
  stopSweeps = await startSweepScheduler(env, sql, provider, metrics);
  app.log.info('deadline sweep scheduler started');
} catch (error) {
  app.log.warn({ err: error }, 'sweep scheduler not started (Redis unavailable?)');
}

// ENG9 ("deployment during an active Vink") — `app.ts` now sets `forceCloseConnections:
// false` so a genuinely in-flight request survives shutdown (a real defect a live SIGTERM
// test caught: the default force-closed connections Node's own idle-heuristic misjudged, and
// killed, a connection that had merely finished RECEIVING its request but whose handler was
// still running — treating "no socket I/O this instant" as "idle").
//
// That fix alone reintroduces the exact problem `forceCloseConnections` exists to prevent:
// with it off, `app.close()` also stops force-closing connections that are GENUINELY idle
// (a keep-alive client, or a request that already finished) — the same live test above
// initially showed shutdown taking the full hard timeout on every run, not just slow ones,
// because Node's own `close()` has no way to distinguish "still working" from "done, but the
// client hasn't hung up yet." The standard fix (a real grace period, then force) is
// implemented explicitly here rather than left to a single all-or-nothing setting: idle
// connections get force-closed after a short, generous window — long enough for this app's
// real request latencies (single/low-double-digit ms, per this repo's own test timings) to
// finish naturally — and a longer hard deadline is still the absolute backstop.
const IDLE_CONNECTION_GRACE_MS = 500;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const idleGraceTimer = setTimeout(() => {
    app.server.closeIdleConnections();
  }, IDLE_CONNECTION_GRACE_MS);
  idleGraceTimer.unref();
  const closed = await Promise.race([
    app.close().then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), GRACEFUL_SHUTDOWN_TIMEOUT_MS).unref(),
    ),
  ]);
  clearTimeout(idleGraceTimer);
  if (!closed) {
    app.log.warn(
      { timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS },
      'graceful shutdown timed out waiting for connections to drain; forcing exit',
    );
  }
  stopOutboxPublisher();
  if (stopSweeps !== null) await stopSweeps();
  await sql.end({ timeout: 5 });
  redis.disconnect();
  realtimePub.disconnect();
  realtimeSub.disconnect();
  await stopOtel();
  await stopMetrics();
  await crashReporter.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
