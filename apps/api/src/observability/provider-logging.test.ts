import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFinancialProvider } from '../../../../packages/payment-provider/src/index.ts';
import type { CommandLogger } from '../../../../packages/application/src/index.ts';
import { withProviderLogging } from './provider-logging.ts';

function recordingLogger(): { logger: CommandLogger; calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    logger: {
      info: (event, data) => calls.push(['info', event, data]),
      error: (event, data) => calls.push(['error', event, data]),
    },
  };
}

describe('withProviderLogging (ENG4 Slice 3)', () => {
  it('passes readonly properties through untouched', () => {
    const provider = new MockFinancialProvider();
    const { logger } = recordingLogger();
    const wrapped = withProviderLogging(provider, 'corr-1', logger);
    assert.equal(wrapped.providerName, 'mock');
    assert.deepEqual(wrapped.capabilities, provider.capabilities);
  });

  it('logs a start/end pair around a successful call, tagged with the correlation id', async () => {
    const provider = new MockFinancialProvider();
    const { logger, calls } = recordingLogger();
    const wrapped = withProviderLogging(provider, 'corr-2', logger);

    await wrapped.createCustomer({ idempotencyKey: 'idem-1', externalUserId: 'u1' });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], [
      'info',
      'provider_call_start',
      { correlationId: 'corr-2', provider: 'mock', method: 'createCustomer' },
    ]);
    assert.deepEqual(calls[1], [
      'info',
      'provider_call_end',
      { correlationId: 'corr-2', provider: 'mock', method: 'createCustomer' },
    ]);
  });

  it('never logs the raw input or output payload of a call', async () => {
    const provider = new MockFinancialProvider();
    const { logger, calls } = recordingLogger();
    const wrapped = withProviderLogging(provider, 'corr-3', logger);

    await wrapped.createCustomer({
      idempotencyKey: 'idem-2',
      externalUserId: 'super-secret-user-id-should-not-leak',
    });

    const serialized = JSON.stringify(calls);
    assert.ok(!serialized.includes('super-secret-user-id-should-not-leak'));
  });

  it('logs provider_call_error and still rethrows on failure', async () => {
    const provider = new MockFinancialProvider();
    const { logger, calls } = recordingLogger();
    const wrapped = withProviderLogging(provider, 'corr-4', logger);

    await assert.rejects(() => wrapped.retrievePaymentStatus('nonexistent-payment-id'));

    const errorCall = calls.find(([level]) => level === 'error');
    assert.ok(errorCall, 'expected a provider_call_error log line');
    assert.equal(errorCall![1], 'provider_call_error');
    const data = errorCall![2] as Record<string, unknown>;
    assert.equal(data.correlationId, 'corr-4');
    assert.equal(data.method, 'retrievePaymentStatus');
  });

  it('preserves parseWebhookEvent as a synchronous call (not wrapped in a Promise)', () => {
    const provider = new MockFinancialProvider();
    const { logger, calls } = recordingLogger();
    const wrapped = withProviderLogging(provider, 'corr-5', logger);

    // A mismatched signature throws synchronously in the real implementation. If the wrapper
    // wrongly forced this method through the async path, this would surface as an unhandled
    // promise rejection instead of a synchronous throw catchable here.
    assert.throws(() =>
      wrapped.parseWebhookEvent({
        rawBody: '{}',
        signatureHeader: 'wrong-signature',
        webhookSecret: 'secret',
      }),
    );
    // Not part of the logged call/response flow (no correlation-bearing command invokes it
    // today) — confirmed no log lines were produced for it.
    assert.equal(calls.length, 0);
  });
});
