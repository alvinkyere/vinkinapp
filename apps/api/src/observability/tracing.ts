/**
 * ENG4 Slice 5 ("distributed tracing"): manual spans for the code paths that don't get one for
 * free from `otel.ts`'s auto-instrumentation — BullMQ jobs, provider adapter calls, delivery-
 * provider calls, and the WebSocket connection-setup path all run outside any incoming HTTP
 * request's own span.
 *
 * Deliberately built directly on `@opentelemetry/api`'s `trace` namespace, not a custom
 * no-op-by-default wrapper like `metrics.ts`'s `Metrics`/`NOOP_METRICS`: the OTel API package
 * is itself always safely callable — every method here is already a genuine no-op when
 * `otel.ts` hasn't started a real `NodeSDK` (`VINKIN_OTEL_ENABLED` off, the default), by the
 * OTel API's own design. No second no-op layer needed.
 *
 * `startActiveSpan`'s callback runs inside the OTel context the new span establishes, so any
 * `tracer.startActiveSpan(...)` (or a plain OTel-instrumented HTTP handler) called from
 * *within* `withSpan`'s callback automatically nests under it — this is how "propagate trace
 * context through jobs → provider calls" is achieved, without manually passing a span/context
 * object through every function signature in between.
 */

import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('vinkin-api');

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Tags the currently-active span (an auto-instrumented HTTP span, or one `withSpan` created)
 * with a stable business identifier — `vink.id`/`correlation.id` — so separate traces
 * belonging to the same Vink can be found by searching a real trace backend for that
 * attribute. Deliberately not one giant span spanning a Vink's full (up to 24h) lifecycle:
 * OTel traces are shaped for bounded operations, not multi-hour business processes: this is
 * the standard "correlate across traces via a business-id attribute" pattern instead. A no-op
 * when nothing is currently active (no span in scope, or OTel disabled). */
export function tagActiveSpan(attributes: Record<string, string>): void {
  const span = trace.getActiveSpan();
  if (span === undefined) return;
  span.setAttributes(attributes);
}
