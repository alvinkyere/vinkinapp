import type postgres from 'postgres';
import type { Sql } from '../../db/client.ts';

export interface AnalyticsEventInput {
  clientId: string;
  app: 'organizer_mobile' | 'guest_web';
  eventName: string;
  vinkId?: string;
  properties: Record<string, unknown>;
  occurredAt: string;
}

export async function insertAnalyticsEvents(
  sql: Sql,
  events: AnalyticsEventInput[],
): Promise<void> {
  // One row at a time (matches every other insert in this codebase, e.g.
  // vinks/store.ts's insertLedgerPosting) rather than the bulk `sql(array, ...)` helper —
  // that helper doesn't serialize a JSONB column correctly without per-row `sql.json()`,
  // which the array form doesn't support. Batches here are capped at 50 events by the
  // route's own schema, so this is cheap.
  for (const event of events) {
    await sql`INSERT INTO analytics_events (client_id, app, event_name, vink_id, properties, occurred_at)
      VALUES (${event.clientId}, ${event.app}, ${event.eventName}, ${event.vinkId ?? null},
              ${sql.json(event.properties as postgres.JSONValue)}, ${event.occurredAt})`;
  }
}
