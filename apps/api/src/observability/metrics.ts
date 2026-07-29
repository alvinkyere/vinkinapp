/**
 * ENG4 Slice 4 ("metrics & observability"): a pull-based Prometheus `/metrics` endpoint,
 * extending the OTel setup `otel.ts` already established rather than introducing a separate
 * metrics library (e.g. prom-client) — same ecosystem, no new philosophy, per ENG4's own
 * "prefer extending established systems" principle.
 *
 * Deliberately NOT gated by `VINKIN_OTEL_ENABLED`: that flag stays off by default because
 * `otel.ts`'s push-based OTLP trace exporter "only produces noise" without a running
 * collector. This is pull-based and self-contained — `curl localhost:PORT/metrics` works with
 * nothing else running. It gets its own flag (`VINKIN_METRICS_ENABLED`) because it still opens
 * a new port, a real behavior change that shouldn't happen silently in an already-running
 * environment.
 *
 * "Expose metrics cleanly. Do not invent dashboards yet." (the brief's own words) — this file
 * is only the recorder API + scrape endpoint; a dashboard consuming it is explicitly out of
 * scope here.
 */

import type { Env } from '../config/env.ts';

export type MetricAttributes = Record<string, string>;

export interface Metrics {
  recordApiRequest(data: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void;
  recordProviderCall(data: { provider: string; method: string; durationMs: number }): void;
  recordWorkerFailure(data: { queue: string }): void;
  recordInvitationDelivery(data: { outcome: 'SENT' | 'FAILED'; method: 'EMAIL' | 'SMS' }): void;
  connectionOpened(): void;
  connectionClosed(): void;
  /** ENG7 — how long one job execution (a sweep tick today) actually took, by job name. */
  recordJobDuration(data: { job: string; durationMs: number }): void;
  /** ENG7 — how much later than its own configured interval a sweep tick actually started
   * (wall-clock drift), not how long the tick itself took (`recordJobDuration` covers that). */
  recordSweepDelay(data: { delayMs: number }): void;
  /** ENG7 — every webhook ingestion outcome, by provider. Filtering by `outcome: 'duplicate'`
   * is the "duplicate webhook count" the roadmap names; the same counter also gives a general
   * ingestion-volume/dead-letter-rate view for free. */
  recordWebhookIngestion(data: {
    provider: string;
    outcome: 'received' | 'duplicate' | 'dead_letter' | 'invalid_signature';
  }): void;
  /** ENG7 — a command served an idempotent replay instead of executing fresh (the roadmap's
   * "idempotency replay count"), by command name. */
  recordCommandReplay(data: { command: string }): void;
  /** ENG7 — "contribution success rate": every contribution outcome the resolver/authorize
   * path reaches, by status. A rate is `rate(...{status="CAPTURED"}) / rate(...)` in Prometheus
   * itself — no separate ratio needs computing in application code. */
  recordContributionOutcome(data: { outcome: string }): void;
  /** ENG7 — "authorization success rate": every §17 merchant-authorization decision. */
  recordAuthorizationOutcome(data: { outcome: string }): void;
  /** ENG7 — "refund status": every refund attempt's terminal outcome. */
  recordRefundOutcome(data: { outcome: string }): void;
  /** Registers a callback invoked on every scrape — the async-gauge pattern (BullMQ queue
   * depth, health-check status) needs, since both are polled facts, not events. `observe` may
   * be called any number of times per invocation (once per label combination). */
  registerObservableGauge(
    name: string,
    callback: (
      observe: (value: number, attributes?: MetricAttributes) => void,
    ) => Promise<void> | void,
  ): void;
}

export const NOOP_METRICS: Metrics = {
  recordApiRequest: () => {},
  recordProviderCall: () => {},
  recordWorkerFailure: () => {},
  recordInvitationDelivery: () => {},
  connectionOpened: () => {},
  connectionClosed: () => {},
  registerObservableGauge: () => {},
  recordJobDuration: () => {},
  recordSweepDelay: () => {},
  recordWebhookIngestion: () => {},
  recordCommandReplay: () => {},
  recordContributionOutcome: () => {},
  recordAuthorizationOutcome: () => {},
  recordRefundOutcome: () => {},
};

export async function startMetrics(
  env: Env,
): Promise<{ metrics: Metrics; stop: () => Promise<void> }> {
  if (env.VINKIN_METRICS_ENABLED !== '1') {
    return { metrics: NOOP_METRICS, stop: async () => {} };
  }
  const { PrometheusExporter } = await import('@opentelemetry/exporter-prometheus');
  const { MeterProvider } = await import('@opentelemetry/sdk-metrics');

  const exporter = new PrometheusExporter({ port: env.VINKIN_METRICS_PORT });
  const provider = new MeterProvider({ readers: [exporter] });
  const meter = provider.getMeter('vinkin-api');

  const apiLatency = meter.createHistogram('vinkin_api_request_duration_ms', {
    unit: 'ms',
    description: 'HTTP request duration, by method/route pattern/status code',
  });
  const providerLatency = meter.createHistogram('vinkin_provider_call_duration_ms', {
    unit: 'ms',
    description: 'FinancialProvider call duration, by provider/method',
  });
  const workerFailures = meter.createCounter('vinkin_worker_job_failures_total', {
    description: 'BullMQ job failures, by queue',
  });
  const invitationDeliveries = meter.createCounter('vinkin_invitation_delivery_total', {
    description: 'Invitation delivery attempts, by outcome/method',
  });
  const realtimeConnections = meter.createUpDownCounter('vinkin_realtime_connections', {
    description: 'Currently-open realtime WebSocket connections',
  });
  const jobDuration = meter.createHistogram('vinkin_job_duration_ms', {
    unit: 'ms',
    description: 'Background job execution duration, by job name',
  });
  const sweepDelay = meter.createHistogram('vinkin_sweep_delay_ms', {
    unit: 'ms',
    description: 'Wall-clock drift between a sweep tick’s configured interval and its actual start',
  });
  const webhookIngestion = meter.createCounter('vinkin_webhook_events_total', {
    description: 'Webhook ingestion outcomes, by provider/outcome',
  });
  const commandReplays = meter.createCounter('vinkin_command_replay_total', {
    description: 'Commands served as an idempotent replay instead of executing fresh, by command',
  });
  const contributionOutcomes = meter.createCounter('vinkin_contribution_outcome_total', {
    description: 'Contribution terminal/observed outcomes, by status',
  });
  const authorizationOutcomes = meter.createCounter('vinkin_merchant_authorization_outcome_total', {
    description: 'Merchant-authorization decisions (§17), by outcome',
  });
  const refundOutcomes = meter.createCounter('vinkin_refund_outcome_total', {
    description: 'Refund attempt terminal outcomes, by status',
  });

  const metrics: Metrics = {
    recordApiRequest: ({ method, route, statusCode, durationMs }) =>
      apiLatency.record(durationMs, { method, route, status_code: String(statusCode) }),
    recordProviderCall: ({ provider: providerName, method, durationMs }) =>
      providerLatency.record(durationMs, { provider: providerName, method }),
    recordWorkerFailure: ({ queue }) => workerFailures.add(1, { queue }),
    recordInvitationDelivery: ({ outcome, method }) =>
      invitationDeliveries.add(1, { outcome, method }),
    connectionOpened: () => realtimeConnections.add(1),
    connectionClosed: () => realtimeConnections.add(-1),
    recordJobDuration: ({ job, durationMs }) => jobDuration.record(durationMs, { job }),
    recordSweepDelay: ({ delayMs }) => sweepDelay.record(delayMs),
    recordWebhookIngestion: ({ provider: providerName, outcome }) =>
      webhookIngestion.add(1, { provider: providerName, outcome }),
    recordCommandReplay: ({ command }) => commandReplays.add(1, { command }),
    recordContributionOutcome: ({ outcome }) => contributionOutcomes.add(1, { outcome }),
    recordAuthorizationOutcome: ({ outcome }) => authorizationOutcomes.add(1, { outcome }),
    recordRefundOutcome: ({ outcome }) => refundOutcomes.add(1, { outcome }),
    registerObservableGauge: (name, callback) => {
      meter.createObservableGauge(name).addCallback(async (result) => {
        await callback((value, attributes) => result.observe(value, attributes));
      });
    },
  };

  return {
    metrics,
    stop: async () => {
      await provider.shutdown();
    },
  };
}
