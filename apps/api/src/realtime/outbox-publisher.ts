/**
 * Outbox publisher (Plan §12/§14): the first real consumer of `outbox_events.published_at`,
 * which every PV3–PV7 command has been writing since PV3. Polls unpublished rows in `seq`
 * order, maps each to the client vocabulary, publishes to the realtime hub, marks
 * published_at. At-least-once delivery (Plan §12); WebSocket clients must not trust a single
 * message as complete truth (Plan §14) — true here since messages carry a snapshot of the
 * vink's current state, not just the raw event.
 *
 * Multi-instance safety (D16): `SELECT … FOR UPDATE SKIP LOCKED` lets any number of API
 * instances poll concurrently without double-claiming the same rows — a locked row is
 * simply skipped by every other poller, not blocked on. Ordering inside the held
 * transaction is deliberate: publish to the hub FIRST, mark `published_at` and commit
 * SECOND. A crash between them leaves the row unpublished (lock released on rollback), so
 * the next poll re-publishes it — a harmless duplicate under Plan §12's at-least-once
 * contract. The reverse order (commit first) could mark an event published that a crash
 * then prevented from ever reaching the hub — an actual loss, which At-least-once forbids.
 *
 * Runs as a tight interval poll rather than a BullMQ job: realtime wants sub-second latency,
 * and (unlike the deadline sweeps) there is no PostgreSQL-owned "truth" to re-check — the
 * unpublished row itself is the truth. A real deployment might replace the poll with
 * LISTEN/NOTIFY (D16 considered and deferred it — no reference-counted subscription
 * primitive, payload-size limits).
 */

import type { Sql } from '../db/client.ts';
import type { DomainEventName } from '../../../../packages/domain/src/index.ts';
import { clientMessageType } from './message-mapping.ts';
import type { RealtimeHub } from './hub.ts';

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_POLL_INTERVAL_MS = 250;

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

interface VinkSummaryRow {
  state: string;
  funded_amount_minor: string;
  required_amount_minor: string;
}

/** One publish pass. Returns the number of events published (0 if another poller had the lead). */
export async function runOutboxPublish(
  sql: Sql,
  hub: RealtimeHub,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT id, event_type, aggregate_type, aggregate_id, payload, occurred_at
      FROM outbox_events
      WHERE published_at IS NULL
      ORDER BY seq
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `) as unknown as OutboxRow[];
    if (rows.length === 0) return 0;

    for (const row of rows) {
      if (row.aggregate_type !== 'vink') continue;
      const vinkRows = (await tx`
        SELECT state, funded_amount_minor, required_amount_minor
        FROM vinks WHERE id = ${row.aggregate_id}
      `) as unknown as VinkSummaryRow[];
      const vink = vinkRows[0];
      await hub.publish(row.aggregate_id, {
        type: clientMessageType(row.event_type as DomainEventName),
        vinkId: row.aggregate_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at.toISOString(),
        state: vink?.state ?? null,
        fundedAmountMinor: vink !== undefined ? Number(vink.funded_amount_minor) : null,
        requiredAmountMinor: vink !== undefined ? Number(vink.required_amount_minor) : null,
        payload: row.payload,
      });
    }

    const ids = rows.map((row) => row.id);
    await tx`UPDATE outbox_events SET published_at = now() WHERE id = ANY(${ids})`;
    return rows.length;
  }) as Promise<number>;
}

export function startOutboxPublisher(
  sql: Sql,
  hub: RealtimeHub,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    runOutboxPublish(sql, hub, DEFAULT_BATCH_SIZE)
      .catch((error: unknown) => {
        console.error(JSON.stringify({ msg: 'outbox publish failed', error: String(error) }));
      })
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  timer.unref(); // never keeps the process alive on its own
  return () => clearInterval(timer);
}
