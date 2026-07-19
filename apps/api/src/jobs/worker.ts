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

const HEARTBEAT_QUEUE = 'heartbeat';

const env = loadEnv();
const connection = createBullMqRedis(env);

const queue = new Queue(HEARTBEAT_QUEUE, { connection });
await queue.upsertJobScheduler('heartbeat-every-30s', { every: 30_000 });

const worker = new Worker(
  HEARTBEAT_QUEUE,
  async (job) => {
    console.log(JSON.stringify({ msg: 'heartbeat', jobId: job.id, at: new Date().toISOString() }));
  },
  { connection: createBullMqRedis(env) },
);

async function shutdown(): Promise<void> {
  await worker.close();
  await queue.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

console.log(JSON.stringify({ msg: 'worker started', queue: HEARTBEAT_QUEUE }));
