/**
 * ENG6 Slice 5 — the reconciliation runner. Mirrors `realtime/outbox-publisher.ts`'s own
 * proven pattern deliberately: one `sql.begin` transaction per run, `SELECT ... FOR UPDATE
 * SKIP LOCKED` to claim a batch, process, commit. That gives the exact properties this slice
 * needs for free, not reinvented: multi-instance/concurrent-run safety (a locked row is
 * skipped by any other concurrent runner, never double-processed), and crash-safe resumption
 * (a crash mid-run rolls the whole transaction back — the lock releases, nothing was
 * half-written, and the next run simply claims the same unprocessed rows again).
 *
 * Idempotent by construction, not by an app-layer check: `reconciliation_findings.
 * webhook_event_id` is `UNIQUE` (migration 0020), and the claiming query's own `LEFT JOIN
 * ... WHERE rf.id IS NULL` only ever selects webhook_events rows with no finding yet — so
 * replaying the same underlying webhook_events rows (the actual "support replay of
 * previously stored events" requirement) can only ever produce zero additional findings on a
 * second pass, never a duplicate one.
 *
 * Only `webhook_events` rows with `status = 'received'` (Slice 4's "verified, successfully
 * parsed" outcome) are ever examined — dead-lettered rows are Slice 4's own audit trail, not
 * a verified financial event this layer should classify.
 */

import type { Sql } from '../../db/client.ts';
import { correlate } from './store.ts';
import { classify } from '../../../../../packages/reconciliation/src/index.ts';
import type {
  ProviderEvent,
  ProviderEventType,
} from '../../../../../packages/payment-provider/src/index.ts';

const DEFAULT_BATCH_SIZE = 200;

interface ClaimedEventRow {
  id: string;
  provider: string;
  provider_event_id: string;
  event_type: string;
  object_id: string | null;
  occurred_at: Date | null;
  payload: Record<string, unknown> | null;
}

export interface ReconciliationRunResult {
  runId: string;
  eventsExamined: number;
  findingsCreated: number;
}

/** One reconciliation pass. Returns after examining at most `batchSize` unprocessed,
 * verified webhook events, ordered by the PROVIDER's own `occurred_at` — never
 * `received_at`/insertion order (§28) — so a batch spanning out-of-order deliveries is
 * always interpreted in true chronological order. */
export async function runReconciliation(
  sql: Sql,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<ReconciliationRunResult> {
  return sql.begin(async (tx) => {
    const runRows = (await tx`
      INSERT INTO reconciliation_runs DEFAULT VALUES RETURNING id
    `) as unknown as { id: string }[];
    const runId = runRows[0]!.id;

    const rows = (await tx`
      SELECT we.id, we.provider, we.provider_event_id, we.event_type, we.object_id,
             we.occurred_at, we.payload
      FROM webhook_events we
      LEFT JOIN reconciliation_findings rf ON rf.webhook_event_id = we.id
      WHERE we.status = 'received' AND rf.id IS NULL
      ORDER BY we.occurred_at ASC NULLS LAST, we.received_at ASC
      LIMIT ${batchSize}
      FOR UPDATE OF we SKIP LOCKED
    `) as unknown as ClaimedEventRow[];

    let findingsCreated = 0;
    for (const row of rows) {
      // These columns are only null for a dead-lettered row, which the WHERE clause above
      // already excludes (status = 'received') — a defensive skip, not an expected path.
      if (row.object_id === null || row.occurred_at === null) continue;

      const event: ProviderEvent = {
        provider: row.provider,
        providerEventId: row.provider_event_id,
        type: row.event_type as ProviderEventType,
        occurredAt: row.occurred_at.toISOString(),
        objectId: row.object_id,
        payload: row.payload ?? {},
      };

      const correlation = await correlate(tx, event);
      const result = classify(event, correlation);

      const inserted = (await tx`
        INSERT INTO reconciliation_findings
          (run_id, webhook_event_id, provider, provider_event_id, event_type, occurred_at,
           classification, correlated_entity_type, correlated_entity_id, details)
        VALUES
          (${runId}, ${row.id}, ${event.provider}, ${event.providerEventId}, ${event.type},
           ${row.occurred_at}, ${result.classification},
           ${correlation.targetKind === 'none' ? null : correlation.targetKind},
           ${correlation.entityId ?? null},
           ${tx.json({
             reason: result.reason,
             proposedRemediation: result.proposedRemediation ?? null,
           })})
        ON CONFLICT (webhook_event_id) DO NOTHING
        RETURNING id
      `) as unknown as { id: string }[];
      if (inserted.length > 0) findingsCreated++;
    }

    await tx`
      UPDATE reconciliation_runs
      SET completed_at = now(), events_examined = ${rows.length}, findings_created = ${findingsCreated}
      WHERE id = ${runId}
    `;

    return { runId, eventsExamined: rows.length, findingsCreated };
  }) as Promise<ReconciliationRunResult>;
}
