/**
 * Deadline sweeps (Plan §10): BullMQ only SCHEDULES; PostgreSQL deadline comparisons inside
 * the commands decide whether anything happens, so duplicate or late firings are harmless.
 * `runSweeps` is the testable body; `startSweepScheduler` wires it to a repeatable job.
 *
 * The scheduler runs IN the API process: the mock provider is in-memory, so the sweep must
 * share its instance. With a real (external) adapter this moves to the worker process.
 */

import { Queue, Worker } from 'bullmq';
import {
  closeSubmissionsCommand,
  provisionCardCommand,
  resolveContributionCommand,
  resolveGraceCommand,
  type ContributionCommandContext,
} from '../../../../packages/application/src/index.ts';
import type { ContributionId, VinkId } from '../../../../packages/domain/src/index.ts';
import type { FinancialProvider } from '../../../../packages/payment-provider/src/index.ts';
import type { Env } from '../config/env.ts';
import type { Sql } from '../db/client.ts';
import { createRedis } from '../redis/client.ts';
import { PostgresVinkStore } from '../modules/vinks/store.ts';

const SWEEP_QUEUE = 'vink-sweeps';
export const SWEEP_INTERVAL_MS = 10_000;

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
): Promise<SweepResult> {
  const store = new PostgresVinkStore(sql);
  const ctx: ContributionCommandContext = {
    uow: store,
    clock: { now: () => now },
    correlationId: `sweep:${now.toISOString()}`,
    provider,
  };
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

  return result;
}

export async function startSweepScheduler(
  env: Env,
  sql: Sql,
  provider: FinancialProvider,
): Promise<() => Promise<void>> {
  const connection = createRedis(env);
  const queue = new Queue(SWEEP_QUEUE, { connection });
  await queue.upsertJobScheduler('vink-sweeps-repeat', { every: SWEEP_INTERVAL_MS });
  const worker = new Worker(
    SWEEP_QUEUE,
    async () => {
      await runSweeps(sql, provider);
    },
    { connection: createRedis(env) },
  );
  return async () => {
    await worker.close();
    await queue.close();
    connection.disconnect();
  };
}
