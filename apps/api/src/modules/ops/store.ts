/**
 * Ops query layer (PV11): read-only views over data every other module already owns.
 * Deliberately NOT routed through `VinkReader`/`VinkTx` (packages/application/src/ports.ts)
 * — those are shaped for command preconditions and organizer/guest-scoped snapshots; the
 * console needs a different, wider (but still read-only) shape across every table a vink
 * touches. No row here is ever written by this module except `operator_audit_log`.
 */

import type postgres from 'postgres';
import type { Sql } from '../../db/client.ts';

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export interface VinkSearchResult {
  id: string;
  publicCode: string;
  organizerUsername: string;
  purchaseCategory: string;
  state: string;
  requiredAmountMinor: number;
  fundedAmountMinor: number;
  createdAt: string;
}

export interface SearchVinksParams {
  publicCode?: string;
  organizerUsername?: string;
  state?: string;
  limit?: number;
}

export async function searchVinks(
  sql: Sql,
  params: SearchVinksParams,
): Promise<VinkSearchResult[]> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 200);
  const rows = await sql`
    SELECT v.id, v.public_code, u.username AS organizer_username, v.purchase_category,
           v.state, v.required_amount_minor, v.funded_amount_minor, v.created_at
    FROM vinks v
    JOIN users u ON u.id = v.organizer_user_id
    WHERE 1 = 1
      ${params.publicCode !== undefined ? sql`AND v.public_code ILIKE ${'%' + params.publicCode + '%'}` : sql``}
      ${params.organizerUsername !== undefined ? sql`AND u.username ILIKE ${'%' + params.organizerUsername + '%'}` : sql``}
      ${params.state !== undefined ? sql`AND v.state = ${params.state}` : sql``}
    ORDER BY v.created_at DESC
    LIMIT ${limit}`;
  return rows.map((row: Row) => ({
    id: row.id as string,
    publicCode: row.public_code as string,
    organizerUsername: row.organizer_username as string,
    purchaseCategory: row.purchase_category as string,
    state: row.state as string,
    requiredAmountMinor: Number(row.required_amount_minor),
    fundedAmountMinor: Number(row.funded_amount_minor),
    createdAt: toIso(row.created_at),
  }));
}

export interface VinkDetail {
  vink: Row | null;
  organizer: { id: string; username: string; displayName: string } | null;
  participants: Row[];
  contributions: Row[];
  card: Row | null;
  purchaseAuthorizations: Row[];
  settlements: Row[];
  recoveryObligations: Row[];
  ledgerEntries: Row[];
  outboxEvents: Row[];
  stateHistory: Row[];
}

/** Everything known about one Vink, across every table it touches — the "explain this
 * mock financial event" view the PV11 exit gate names. One vink, several small queries
 * (mirrors PostgresVinkStore's own per-entity fetch style) rather than one sprawling join. */
export async function getVinkDetail(sql: Sql, vinkId: string): Promise<VinkDetail> {
  const [
    vinkRows,
    participants,
    contributions,
    cardRows,
    purchaseAuthorizations,
    settlements,
    recoveryObligations,
    stateHistory,
    outboxEvents,
  ] = await Promise.all([
    sql`SELECT v.*, u.id AS organizer_id, u.username AS organizer_username,
               u.display_name AS organizer_display_name
        FROM vinks v JOIN users u ON u.id = v.organizer_user_id WHERE v.id = ${vinkId}`,
    sql`SELECT * FROM participants WHERE vink_id = ${vinkId} ORDER BY joined_at`,
    sql`SELECT * FROM contributions WHERE vink_id = ${vinkId} ORDER BY created_at`,
    sql`SELECT * FROM temporary_cards WHERE vink_id = ${vinkId}`,
    sql`SELECT * FROM purchase_authorizations WHERE vink_id = ${vinkId} ORDER BY created_at`,
    sql`SELECT * FROM settlements WHERE vink_id = ${vinkId} ORDER BY created_at`,
    sql`SELECT * FROM recovery_obligations WHERE vink_id = ${vinkId} ORDER BY created_at`,
    sql`SELECT * FROM vink_state_history WHERE vink_id = ${vinkId} ORDER BY seq`,
    sql`SELECT * FROM outbox_events WHERE aggregate_type = 'vink' AND aggregate_id = ${vinkId}
        ORDER BY seq`,
  ]);

  const contributionIds = contributions.map((row: Row) => row.id as string);
  const settlementIds = settlements.map((row: Row) => row.id as string);

  const ledgerEntries =
    contributionIds.length === 0 && settlementIds.length === 0
      ? await sql`
          SELECT e.*, t.reference_type, t.reference_id
          FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
          WHERE t.reference_type = 'vink' AND t.reference_id = ${vinkId}
          ORDER BY e.seq`
      : await sql`
          SELECT e.*, t.reference_type, t.reference_id
          FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
          WHERE (t.reference_type = 'vink' AND t.reference_id = ${vinkId})
             OR (t.reference_type = 'contribution' AND t.reference_id = ANY(${contributionIds}))
             OR (t.reference_type = 'settlement' AND t.reference_id = ANY(${settlementIds}))
          ORDER BY e.seq`;

  const vinkRow = vinkRows[0] as Row | undefined;
  return {
    vink: vinkRow ?? null,
    organizer:
      vinkRow === undefined
        ? null
        : {
            id: vinkRow.organizer_id as string,
            username: vinkRow.organizer_username as string,
            displayName: vinkRow.organizer_display_name as string,
          },
    participants,
    contributions,
    card: (cardRows[0] as Row | undefined) ?? null,
    purchaseAuthorizations,
    settlements,
    recoveryObligations,
    ledgerEntries,
    outboxEvents,
    stateHistory,
  };
}

export interface AuditLogEntry {
  id: string;
  operatorName: string;
  action: string;
  vinkId: string | null;
  /** ENG7 — the roadmap's own audit-trail field template names this; without it, an operator
   * action couldn't be correlated back to the request/trace id every log line and history row
   * already carries. Nullable — rows written before this column existed have none. */
  correlationId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export async function insertAuditEntry(
  sql: Sql,
  entry: {
    operatorName: string;
    action: string;
    vinkId?: string;
    correlationId: string;
    details: Record<string, unknown>;
  },
): Promise<void> {
  await sql`INSERT INTO operator_audit_log (operator_name, action, vink_id, correlation_id, details)
    VALUES (${entry.operatorName}, ${entry.action}, ${entry.vinkId ?? null}, ${entry.correlationId},
            ${sql.json(entry.details as postgres.JSONValue)})`;
}

export async function listAuditLog(
  sql: Sql,
  params: { vinkId?: string; limit?: number },
): Promise<AuditLogEntry[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const rows = await sql`
    SELECT * FROM operator_audit_log
    WHERE 1 = 1 ${params.vinkId !== undefined ? sql`AND vink_id = ${params.vinkId}` : sql``}
    ORDER BY seq DESC
    LIMIT ${limit}`;
  return rows.map((row: Row) => ({
    id: row.id as string,
    operatorName: row.operator_name as string,
    action: row.action as string,
    vinkId: (row.vink_id as string | null) ?? null,
    correlationId: (row.correlation_id as string | null) ?? null,
    details: row.details as Record<string, unknown>,
    createdAt: toIso(row.created_at),
  }));
}
