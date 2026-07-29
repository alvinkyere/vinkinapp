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
    NOOP_METRICS.recordJobDuration({ job: 'sweep', durationMs: 1 });
    NOOP_METRICS.recordSweepDelay({ delayMs: 1 });
    NOOP_METRICS.recordWebhookIngestion({ provider: 'stripe', outcome: 'received' });
    NOOP_METRICS.recordCommandReplay({ command: 'createVink' });
    NOOP_METRICS.recordContributionOutcome({ outcome: 'CAPTURED' });
    NOOP_METRICS.recordAuthorizationOutcome({ outcome: 'APPROVED' });
    NOOP_METRICS.recordRefundOutcome({ outcome: 'REFUNDED' });
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
      // ENG7 ("Observability and auditability") — the roadmap's own named metrics that were
      // genuinely missing before this pass.
      metrics.recordJobDuration({ job: 'sweep', durationMs: 12 });
      metrics.recordSweepDelay({ delayMs: 250 });
      metrics.recordWebhookIngestion({ provider: 'stripe', outcome: 'duplicate' });
      metrics.recordCommandReplay({ command: 'createVink' });
      metrics.recordContributionOutcome({ outcome: 'CAPTURED' });
      metrics.recordAuthorizationOutcome({ outcome: 'DECLINED' });
      metrics.recordRefundOutcome({ outcome: 'REFUNDED' });

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
      assert.match(body, /vinkin_job_duration_ms/);
      assert.match(body, /job="sweep"/);
      assert.match(body, /vinkin_sweep_delay_ms/);
      assert.match(
        body,
        /vinkin_webhook_events_total\{provider="stripe",outcome="duplicate"[^}]*\}\s+1/,
      );
      assert.match(body, /vinkin_command_replay_total\{command="createVink"[^}]*\}\s+1/);
      assert.match(body, /vinkin_contribution_outcome_total\{outcome="CAPTURED"[^}]*\}\s+1/);
      assert.match(
        body,
        /vinkin_merchant_authorization_outcome_total\{outcome="DECLINED"[^}]*\}\s+1/,
      );
      assert.match(body, /vinkin_refund_outcome_total\{[^}]*outcome="REFUNDED"[^}]*\}\s+1/);

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
