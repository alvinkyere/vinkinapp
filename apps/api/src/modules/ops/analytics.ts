/**
 * PV12 exit-gate metrics (operator-facing). Four of the six named numbers come straight
 * from tables that already exist — no client instrumentation needed for those, only a
 * query. Only "top failure points" depends on the new `analytics_events` table (0008),
 * since a client-side abandonment or error before anything persists is exactly what
 * domain tables structurally cannot show.
 */

import type { Sql } from '../../db/client.ts';

export interface FunnelSummary {
  /** Exit gate: "At least 25 complete simulated Vinks". */
  completedVinks: number;
  /** Exit gate: "At least 75 participant joins" — non-organizer participants who actually
   * joined (registered members added, or guests via the public link). */
  participantJoins: number;
  /** Exit gate: "At least 80% organizer task completion" — of all Vinks ever created,
   * the share that left DRAFT (reached OPEN or further) rather than staying stuck or
   * being cancelled. */
  organizerTaskCompletionRate: number;
  vinksCreated: number;
  /** Exit gate: "Median join-to-contribution time measured" — minutes from a participant
   * joining to their contribution reaching CAPTURED. `contributions.updated_at` at the
   * moment status flips to CAPTURED is used as a proxy for "when they finished"; there is
   * no dedicated captured-at column (PV5 schema). Null if nobody has captured yet. */
  medianJoinToContributionMinutes: number | null;
  /** Exit gate: "Top five failure points documented" — the five most common event names
   * ending in `_failed` reported by either client app. */
  topFailurePoints: Array<{ eventName: string; count: number }>;
}

export async function getFunnelSummary(sql: Sql): Promise<FunnelSummary> {
  const [completedRows, joinRows, taskRows, timingRows, failureRows] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM vinks WHERE state = 'COMPLETED'`,
    sql`SELECT count(*)::int AS n FROM participants WHERE role = 'MEMBER' AND status = 'JOINED'`,
    sql`SELECT
          count(*) FILTER (WHERE state NOT IN ('DRAFT', 'CANCELLED'))::int AS completed,
          count(*)::int AS total
        FROM vinks`,
    sql`SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (c.updated_at - p.joined_at)) / 60.0
        ) AS median_minutes
        FROM contributions c
        JOIN participants p ON p.id = c.participant_id
        WHERE c.status = 'CAPTURED' AND p.role = 'MEMBER'`,
    sql`SELECT event_name, count(*)::int AS n
        FROM analytics_events
        WHERE event_name ILIKE '%\\_failed' ESCAPE '\\'
        GROUP BY event_name
        ORDER BY n DESC
        LIMIT 5`,
  ]);

  const task = taskRows[0] as { completed: number; total: number };
  const timing = timingRows[0] as { median_minutes: string | null };

  return {
    completedVinks: (completedRows[0] as { n: number }).n,
    participantJoins: (joinRows[0] as { n: number }).n,
    organizerTaskCompletionRate: task.total === 0 ? 0 : task.completed / task.total,
    vinksCreated: task.total,
    medianJoinToContributionMinutes:
      timing.median_minutes === null ? null : Number(timing.median_minutes),
    topFailurePoints: failureRows.map((row) => ({
      eventName: (row as { event_name: string }).event_name,
      count: (row as { n: number }).n,
    })),
  };
}
