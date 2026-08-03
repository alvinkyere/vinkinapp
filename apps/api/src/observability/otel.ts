/**
 * OpenTelemetry bootstrap — env-gated (VINKIN_OTEL_ENABLED=1). Off by default: without a
 * collector the exporter only produces noise. The SDK modules are imported lazily so the
 * disabled path costs nothing.
 */

import type { Env } from '../config/env.ts';

export async function startOtel(env: Env): Promise<() => Promise<void>> {
  if (env.VINKIN_OTEL_ENABLED !== '1') {
    return async () => {};
  }
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const sdk = new NodeSDK({
    serviceName: 'vinkin-api',
    traceExporter: new OTLPTraceExporter(),
  });
  sdk.start();
  return () => sdk.shutdown();
}
