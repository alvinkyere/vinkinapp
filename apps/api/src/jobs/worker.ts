/**
 * Job worker process (PV1): proves the BullMQ path with a repeatable heartbeat. Real timer
 * jobs (close-submissions, resolve-processing-grace, … — Plan §10) land from PV5, each
 * re-checking PostgreSQL deadline truth before acting; Redis only schedules.
 *
 * Run: pnpm --filter @vinkin/api worker
 */

import { Queue, Worker } from 'bullmq';
import { loadEnv } from '../config/env.ts';
import { createBullMqRedis } from '../redis/client.ts';
import { createLogger } from '../observability/logger.ts';
import { startMetrics } from '../observability/metrics.ts';
import { withSpan } from '../observability/tracing.ts';

const HEARTBEAT_QUEUE = 'heartbeat';

const env = loadEnv();
const log = createLogger(env, { component: 'worker' });
const connection = createBullMqRedis(env);

// ENG4 Slice 4: a separate OS process from the main API server (this is the whole point of
// `jobs/worker.ts` — a standalone worker), so it needs its own Prometheus HTTP server, not a
// shared one — offset by one port from the main process's to avoid a bind conflict when both
// run at once, the normal deployment topology.
const { metrics: workerMetrics, stop: stopMetrics } = await startMetrics({
  ...env,
  VINKIN_METRICS_PORT: env.VINKIN_METRICS_PORT + 1,
});

const queue = new Queue(HEARTBEAT_QUEUE, { connection });
await queue.upsertJobScheduler('heartbeat-every-30s', { every: 30_000 });

const worker = new Worker(
  HEARTBEAT_QUEUE,
  async (job) => {
    // ENG4 Slice 3 ("every worker job carries a correlation id"): BullMQ's own job id is
    // already a stable, unique per-job identifier — reused as the correlation id rather than
    // minting a separate one, same principle as sweeps.ts's own per-tick id.
    const correlationId = `heartbeat:${job.id}`;
    // ENG4 Slice 5: same reasoning as sweeps.ts — no HTTP request triggers this job.
    await withSpan('vink.heartbeat', { 'correlation.id': correlationId }, async () => {
      log.info({ correlationId, jobId: job.id }, 'heartbeat');
    });
  },
  { connection: createBullMqRedis(env) },
);
worker.on('failed', () => workerMetrics.recordWorkerFailure({ queue: HEARTBEAT_QUEUE }));

async function shutdown(): Promise<void> {
  await worker.close();
  await queue.close();
  connection.disconnect();
  await stopMetrics();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

log.info({ queue: HEARTBEAT_QUEUE }, 'worker started');
