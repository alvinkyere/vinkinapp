/**
 * Deadline sweeps (Plan §10): BullMQ only SCHEDULES; PostgreSQL deadline comparisons inside
 * the commands decide whether anything happens, so duplicate or late firings are harmless.
 * `runSweeps` is the testable body; `startSweepScheduler` wires it to a repeatable job.
 *
 * The scheduler runs IN the API process: the mock provider is in-memory, so the sweep must
 * share its instance. With a real (external) adapter this moves to the worker process.
 */

import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import {
  closeSubmissionsCommand,
  provisionCardCommand,
  resolveContributionCommand,
  resolveGraceCommand,
  type CommandLogger,
  type ContributionCommandContext,
} from '../../../../packages/application/src/index.ts';
import type { ContributionId, VinkId } from '../../../../packages/domain/src/index.ts';
import type { FinancialProvider } from '../../../../packages/payment-provider/src/index.ts';
import type { Env } from '../config/env.ts';
import type { Sql } from '../db/client.ts';
import { createBullMqRedis } from '../redis/client.ts';
import { createLogger } from '../observability/logger.ts';
import { toCommandLogger, type PinoLike } from '../observability/command-logger.ts';
import { toCommandMetrics } from '../observability/command-metrics.ts';
import { withProviderLogging } from '../observability/provider-logging.ts';
import { NOOP_METRICS, type Metrics } from '../observability/metrics.ts';
import { withSpan } from '../observability/tracing.ts';
import { PostgresVinkStore } from '../modules/vinks/store.ts';

const SWEEP_QUEUE = 'vink-sweeps';

const NOOP_LOGGER: CommandLogger = { info: () => {}, error: () => {} };

export interface SweepResult {
  closed: number;
  graceResolved: number;
  contributionsResolved: number;
  cardsProvisioned: number;
}

export async function runSweeps(
  sql: Sql,
  provider: FinancialProvider,
  now: Date = new Date(),
  log?: PinoLike,
  metrics: Metrics = NOOP_METRICS,
): Promise<SweepResult> {
  const startedAt = Date.now();
  // ENG4 Slice 3 ("every worker job carries a correlation id"): one id per sweep tick,
  // distinct from a request id since no HTTP request triggered this — same idea, same shape
  // (VinkStateHistoryRow/ContributionStatusHistoryRow already store whatever correlationId is
  // threaded in, so a sweep-triggered transition is attributable in the DB exactly like an
  // HTTP-triggered one).
  const correlationId = `sweep:${now.toISOString()}:${randomUUID().slice(0, 8)}`;
  const logger = log !== undefined ? toCommandLogger(log) : NOOP_LOGGER;
  const store = new PostgresVinkStore(sql);
  const ctx: ContributionCommandContext = {
    uow: store,
    clock: { now: () => now },
    correlationId,
    provider: withProviderLogging(provider, correlationId, logger),
    logger,
    metrics: toCommandMetrics(metrics),
  };

  // ENG4 Slice 5 ("propagate trace context through… background jobs"): no HTTP request
  // triggers a sweep, so it gets no auto-instrumented span for free — this manual one is the
  // root of everything nested under it (each command's own provider calls, via
  // `withProviderLogging`'s own `withSpan`).
  return withSpan('vink.sweep', { 'correlation.id': correlationId }, async () => {
    logger.info('sweep_start', { correlationId });
    const result: SweepResult = {
      closed: 0,
      graceResolved: 0,
      contributionsResolved: 0,
      cardsProvisioned: 0,
    };

    const due = await sql`SELECT id FROM vinks
    WHERE state = 'OPEN' AND submission_deadline <= ${now.toISOString()}`;
    for (const row of due) {
      await closeSubmissionsCommand(ctx, { vinkId: (row as { id: string }).id as VinkId, now });
      result.closed += 1;
    }

    const graceDue = await sql`SELECT id FROM vinks
    WHERE state IN ('SUBMISSIONS_CLOSED', 'PROCESSING_GRACE')
      AND processing_grace_deadline <= ${now.toISOString()}`;
    for (const row of graceDue) {
      await resolveGraceCommand(ctx, { vinkId: (row as { id: string }).id as VinkId, now });
      result.graceResolved += 1;
    }

    // FUNDED vinks with no card yet enter the card pipeline (§16). Provisioning failure moves
    // the vink to reversal itself; the sweep just kicks it off.
    const toProvision = await sql`SELECT v.id FROM vinks v
    WHERE v.state = 'FUNDED'
      AND NOT EXISTS (SELECT 1 FROM temporary_cards c WHERE c.vink_id = v.id)`;
    for (const row of toProvision) {
      try {
        await provisionCardCommand(ctx, { vinkId: (row as { id: string }).id as VinkId });
        result.cardsProvisioned += 1;
      } catch {
        // Provisioning failure is recorded by the command (→ FUNDING_REVERSAL); keep sweeping.
      }
    }

    const stuck = await sql`SELECT id, vink_id FROM contributions
    WHERE status = 'RESOLUTION_PENDING'
       OR (status = 'AUTHORIZATION_PENDING' AND created_at <= ${new Date(now.getTime() - 30_000).toISOString()})`;
    for (const row of stuck) {
      const typed = row as { id: string; vink_id: string };
      await resolveContributionCommand(ctx, {
        contributionId: typed.id as ContributionId,
        vinkId: typed.vink_id as VinkId,
        now,
      });
      result.contributionsResolved += 1;
    }

    logger.info('sweep_end', { correlationId, ...result });
    metrics.recordJobDuration({ job: 'sweep', durationMs: Date.now() - startedAt });
    return result;
  });
}

export async function startSweepScheduler(
  env: Env,
  sql: Sql,
  provider: FinancialProvider,
  metrics: Metrics = NOOP_METRICS,
): Promise<() => Promise<void>> {
  const log = createLogger(env, { component: 'sweep-scheduler' });
  const connection = createBullMqRedis(env);
  const queue = new Queue(SWEEP_QUEUE, { connection });
  await queue.upsertJobScheduler('vink-sweeps-repeat', {
    every: env.VINK_SWEEP_INTERVAL_SECONDS * 1000,
  });
  const intervalMs = env.VINK_SWEEP_INTERVAL_SECONDS * 1000;
  // ENG7 ("deadline sweep delay") — the wall-clock gap between when a tick was due (the
  // previous tick's own start time plus the configured interval) and when it actually
  // started. `undefined` on the very first tick — there is no prior tick to measure drift
  // against yet, and recording a fabricated baseline would misrepresent real drift.
  let previousTickStartedAt: number | undefined;
  const worker = new Worker(
    SWEEP_QUEUE,
    async () => {
      const tickStartedAt = Date.now();
      if (previousTickStartedAt !== undefined) {
        const expectedAt = previousTickStartedAt + intervalMs;
        metrics.recordSweepDelay({ delayMs: Math.max(tickStartedAt - expectedAt, 0) });
      }
      previousTickStartedAt = tickStartedAt;
      await runSweeps(sql, provider, new Date(), log, metrics);
    },
    { connection: createBullMqRedis(env) },
  );
  // ENG4 Slice 4 ("worker failures" / "queue depth" metrics).
  worker.on('failed', () => metrics.recordWorkerFailure({ queue: SWEEP_QUEUE }));
  metrics.registerObservableGauge('vinkin_queue_depth', async (observe) => {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    for (const [state, value] of Object.entries(counts)) {
      observe(value, { queue: SWEEP_QUEUE, state });
    }
  });
  return async () => {
    await worker.close();
    await queue.close();
    connection.disconnect();
  };
}
