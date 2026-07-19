/**
 * Outbox publisher (Plan §12/§14): the first real consumer of `outbox_events.published_at`,
 * which every PV3–PV7 command has been writing since PV3. Polls unpublished rows in `seq`
 * order, maps each to the client vocabulary, publishes to the realtime hub, marks
 * published_at. At-least-once delivery (Plan §12); WebSocket clients must not trust a single
 * message as complete truth (Plan §14) — true here since messages carry a snapshot of the
 * vink's current state, not just the raw event.
 *
 * Runs as a tight interval poll rather than a BullMQ job: realtime wants sub-second latency,
 * and (unlike the deadline sweeps) there is no PostgreSQL-owned "truth" to re-check — the
 * unpublished row itself is the truth. A real deployment would replace the poll with
 * LISTEN/NOTIFY or a Redis-fed fanout (flagged in the PV8 report, same shape as D10's
 * provider-calls-in-transaction flag).
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

/** One publish pass. Returns the number of events published. */
export async function runOutboxPublish(
  sql: Sql,
  hub: RealtimeHub,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<number> {
  const rows = (await sql`
    SELECT id, event_type, aggregate_type, aggregate_id, payload, occurred_at
    FROM outbox_events
    WHERE published_at IS NULL
    ORDER BY seq
    LIMIT ${batchSize}
  `) as unknown as OutboxRow[];
  if (rows.length === 0) return 0;

  for (const row of rows) {
    if (row.aggregate_type === 'vink') {
      const vinkRows = (await sql`
        SELECT state, funded_amount_minor, required_amount_minor
        FROM vinks WHERE id = ${row.aggregate_id}
      `) as unknown as VinkSummaryRow[];
      const vink = vinkRows[0];
      hub.publish(row.aggregate_id, {
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
  }

  const ids = rows.map((row) => row.id);
  await sql`UPDATE outbox_events SET published_at = now() WHERE id = ANY(${ids})`;
  return rows.length;
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
    runOutboxPublish(sql, hub)
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
