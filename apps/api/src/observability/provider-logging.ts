/**
 * ENG4 Slice 3 ("every provider interaction carries a correlation ID"): a logging decorator
 * around `FinancialProvider`, not a change to the interface itself — the interface is a
 * spec-verbatim contract (§43) shared with the adapter-conformance suite (D7); adding a
 * parameter to every method there would be a breaking change to a locked contract, exactly
 * what ENG4's own principles say to avoid ("respect the provider abstraction… do not bypass
 * existing architecture"). Wrapping the instance at construction time is purely additive: the
 * real provider is unaware it's wrapped, and every existing caller keeps working unchanged.
 *
 * Deliberately logs method name + provider name + correlation ID only — never the raw
 * input/output payloads, which can carry card numbers, payment-method tokens, or other
 * financial PII the brief's own "never log payment credentials" rule forbids.
 *
 * ENG4 Slice 4: the same choke point also records `vinkin_provider_call_duration_ms`
 * (provider + authorization latency, per the brief's metrics list) — one wrapper serving both
 * concerns, since both fire around the exact same call. `metrics` defaults to `NOOP_METRICS`
 * so every pre-existing call site/test is unaffected if it doesn't pass one.
 *
 * ENG4 Slice 5 ("propagate trace context through… provider adapters"): the same choke point
 * now also wraps each call in a real span (`withSpan`) — nested under whatever HTTP-request
 * auto-span or job span is active when the call happens, giving genuine parent→child trace
 * propagation without threading a span/context object through every command function in
 * between. Tagged with `vink.id` when the caller can supply one (not every provider call is
 * tied to a single vink — e.g. `createCustomer` during onboarding isn't), enabling
 * cross-trace correlation in a real trace backend.
 */

import type { CommandLogger } from '../../../../packages/application/src/index.ts';
import type { FinancialProvider } from '../../../../packages/payment-provider/src/index.ts';
import { NOOP_METRICS, type Metrics } from './metrics.ts';
import { withSpan } from './tracing.ts';

export function withProviderLogging(
  provider: FinancialProvider,
  correlationId: string,
  logger: CommandLogger,
  metrics: Metrics = NOOP_METRICS,
): FinancialProvider {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const method = String(prop);
      // parseWebhookEvent is the one synchronous method on the interface — preserve that
      // (a wrapper that always returns a Promise would silently change its call contract).
      if (method === 'parseWebhookEvent') {
        return value.bind(target);
      }
      return async (...args: unknown[]) =>
        withSpan(
          `provider.${method}`,
          { 'provider.name': target.providerName, 'correlation.id': correlationId },
          async () => {
            logger.info('provider_call_start', {
              correlationId,
              provider: target.providerName,
              method,
            });
            const startedAt = performance.now();
            try {
              const result = await (value as (...a: unknown[]) => unknown).apply(target, args);
              logger.info('provider_call_end', {
                correlationId,
                provider: target.providerName,
                method,
              });
              metrics.recordProviderCall({
                provider: target.providerName,
                method,
                durationMs: performance.now() - startedAt,
              });
              return result;
            } catch (error) {
              logger.error('provider_call_error', {
                correlationId,
                provider: target.providerName,
                method,
                error: error instanceof Error ? error.message : String(error),
              });
              metrics.recordProviderCall({
                provider: target.providerName,
                method,
                durationMs: performance.now() - startedAt,
              });
              throw error;
            }
          },
        );
    },
  });
}
