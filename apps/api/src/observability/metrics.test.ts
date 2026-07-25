/**
 * ENG4 Slice 4: proves the metrics pipeline end-to-end against a real (ephemeral-port)
 * Prometheus HTTP server — not just that the recorder functions don't throw, but that a real
 * `curl`-equivalent scrape returns real Prometheus text exposition format with the values
 * actually recorded.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../config/env.ts';
import { startMetrics, NOOP_METRICS } from './metrics.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

async function scrape(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/metrics`);
  assert.equal(res.status, 200);
  return res.text();
}

describe('startMetrics (ENG4 Slice 4)', () => {
  it('NOOP_METRICS accepts every call as a genuine no-op (flag-off default behavior)', () => {
    NOOP_METRICS.recordApiRequest({ method: 'GET', route: '/x', statusCode: 200, durationMs: 1 });
    NOOP_METRICS.recordProviderCall({ provider: 'mock', method: 'x', durationMs: 1 });
    NOOP_METRICS.recordWorkerFailure({ queue: 'x' });
    NOOP_METRICS.recordInvitationDelivery({ outcome: 'SENT', method: 'EMAIL' });
    NOOP_METRICS.connectionOpened();
    NOOP_METRICS.connectionClosed();
    NOOP_METRICS.registerObservableGauge('x', () => {});
  });

  it('VINKIN_METRICS_ENABLED=0 (default) never opens a port', async () => {
    const env = loadEnv({ VINKIN_METRICS_ENABLED: '0' });
    const { metrics, stop } = await startMetrics(env);
    assert.equal(metrics, NOOP_METRICS);
    await stop();
  });

  describe('with the flag on (real HTTP server)', { skip: !RUN }, () => {
    it('serves recorded histogram/counter/updowncounter values as real Prometheus text', async () => {
      const port = 9564;
      const env = loadEnv({ VINKIN_METRICS_ENABLED: '1', VINKIN_METRICS_PORT: String(port) });
      const { metrics, stop } = await startMetrics(env);
      after(() => stop());

      metrics.recordApiRequest({
        method: 'GET',
        route: '/api/v1/vinks/:vinkId',
        statusCode: 200,
        durationMs: 42,
      });
      metrics.recordProviderCall({
        provider: 'mock',
        method: 'authorizeContribution',
        durationMs: 7,
      });
      metrics.recordWorkerFailure({ queue: 'vink-sweeps' });
      metrics.recordInvitationDelivery({ outcome: 'SENT', method: 'EMAIL' });
      metrics.connectionOpened();
      metrics.connectionOpened();
      metrics.connectionClosed();
      metrics.registerObservableGauge('vinkin_test_gauge', (observe) => {
        observe(3, { label: 'a' });
        observe(5, { label: 'b' });
      });

      const body = await scrape(port);

      assert.match(body, /vinkin_api_request_duration_ms/);
      assert.match(body, /route="\/api\/v1\/vinks\/:vinkId"/);
      assert.match(body, /vinkin_provider_call_duration_ms/);
      assert.match(body, /provider="mock"/);
      assert.match(body, /vinkin_worker_job_failures_total\{[^}]*queue="vink-sweeps"[^}]*\}\s+1/);
      assert.match(body, /vinkin_invitation_delivery_total\{[^}]*outcome="SENT"[^}]*\}\s+1/);
      // Net of two opens and one close.
      assert.match(body, /vinkin_realtime_connections\{[^}]*\}\s+1/);
      assert.match(body, /vinkin_test_gauge\{[^}]*label="a"[^}]*\}\s+3/);
      assert.match(body, /vinkin_test_gauge\{[^}]*label="b"[^}]*\}\s+5/);

      await stop();
    });

    it('stop() actually closes the port (no lingering server)', async () => {
      const port = 9565;
      const env = loadEnv({ VINKIN_METRICS_ENABLED: '1', VINKIN_METRICS_PORT: String(port) });
      const { stop } = await startMetrics(env);
      await scrape(port);
      await stop();
      await assert.rejects(() => fetch(`http://127.0.0.1:${port}/metrics`));
    });
  });
});
