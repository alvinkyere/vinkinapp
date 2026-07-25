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
