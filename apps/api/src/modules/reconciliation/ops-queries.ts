/**
 * ENG6 Slice 6 — read-only console query layer over the webhook inbox and reconciliation
 * findings. Every function here is a SELECT except `setFindingReviewStatus`, which updates
 * only `reconciliation_findings.review_status` — an operator-workflow annotation Slice 5's
 * own migration comment already scopes as "never auto-advanced by any reconciliation code
 * path." Nothing here ever touches `contributions`/`settlements`/`purchase_authorizations`/
 * `temporary_cards`/any ledger table — this module is diagnostic, not transactional, by
 * construction: it has no write path to any of them.
 *
 * `signature_header` is selected nowhere in this file, on purpose (Security: "never expose
 * webhook signatures") — it is read only by the replay code path in `routes.ts`, never
 * serialized into any response this module produces.
 */

import type { Sql } from '../../db/client.ts';

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

// --- webhook inbox -----------------------------------------------------------------------

export interface WebhookEventSummary {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  objectId: string | null;
  occurredAt: string | null;
  receivedAt: string;
  status: 'received' | 'dead_letter';
  deliveryCount: number;
  lastError: string | null;
  findingId: string | null;
  classification: string | null;
}

export interface ListWebhookEventsParams {
  provider?: string;
  status?: 'received' | 'dead_letter';
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

function pageBounds(page?: number, pageSize?: number): { limit: number; offset: number } {
  const limit = Math.min(Math.max(pageSize ?? 50, 1), 200);
  const offset = Math.max((page ?? 1) - 1, 0) * limit;
  return { limit, offset };
}

function summarizeWebhookRow(row: Row): WebhookEventSummary {
  return {
    id: row.id as string,
    provider: row.provider as string,
    providerEventId: row.provider_event_id as string,
    eventType: row.event_type as string,
    objectId: (row.object_id as string | null) ?? null,
    occurredAt: row.occurred_at !== null ? toIso(row.occurred_at) : null,
    receivedAt: toIso(row.received_at),
    status: row.status as 'received' | 'dead_letter',
    deliveryCount: Number(row.delivery_count),
    lastError: (row.last_error as string | null) ?? null,
    findingId: (row.finding_id as string | null) ?? null,
    classification: (row.classification as string | null) ?? null,
  };
}

export async function listWebhookEvents(
  sql: Sql,
  params: ListWebhookEventsParams,
): Promise<{ items: WebhookEventSummary[]; total: number }> {
  const { limit, offset } = pageBounds(params.page, params.pageSize);
  const search =
    params.search !== undefined && params.search.length > 0 ? `%${params.search}%` : null;

  const rows = (await sql`
    SELECT we.id, we.provider, we.provider_event_id, we.event_type, we.object_id,
           we.occurred_at, we.received_at, we.status, we.delivery_count, we.last_error,
           rf.id AS finding_id, rf.classification
    FROM webhook_events we
    LEFT JOIN reconciliation_findings rf ON rf.webhook_event_id = we.id
    WHERE 1 = 1
      ${params.provider !== undefined ? sql`AND we.provider = ${params.provider}` : sql``}
      ${params.status !== undefined ? sql`AND we.status = ${params.status}` : sql``}
      ${search !== null ? sql`AND (we.provider_event_id ILIKE ${search} OR we.object_id ILIKE ${search})` : sql``}
      ${params.from !== undefined ? sql`AND we.received_at >= ${params.from}` : sql``}
      ${params.to !== undefined ? sql`AND we.received_at <= ${params.to}` : sql``}
    ORDER BY we.received_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as unknown as Row[];

  const countRows = (await sql`
    SELECT count(*)::int AS n
    FROM webhook_events we
    WHERE 1 = 1
      ${params.provider !== undefined ? sql`AND we.provider = ${params.provider}` : sql``}
      ${params.status !== undefined ? sql`AND we.status = ${params.status}` : sql``}
      ${search !== null ? sql`AND (we.provider_event_id ILIKE ${search} OR we.object_id ILIKE ${search})` : sql``}
      ${params.from !== undefined ? sql`AND we.received_at >= ${params.from}` : sql``}
      ${params.to !== undefined ? sql`AND we.received_at <= ${params.to}` : sql``}
  `) as unknown as { n: number }[];

  return { items: rows.map(summarizeWebhookRow), total: countRows[0]!.n };
}

export interface WebhookEventDetail extends WebhookEventSummary {
  payload: Record<string, unknown> | null;
  rawBody: string;
}

export async function getWebhookEventDetail(
  sql: Sql,
  id: string,
): Promise<WebhookEventDetail | null> {
  const rows = (await sql`
    SELECT we.id, we.provider, we.provider_event_id, we.event_type, we.object_id,
           we.occurred_at, we.received_at, we.status, we.delivery_count, we.last_error,
           we.payload, we.raw_body, rf.id AS finding_id, rf.classification
    FROM webhook_events we
    LEFT JOIN reconciliation_findings rf ON rf.webhook_event_id = we.id
    WHERE we.id = ${id}
  `) as unknown as Row[];
  const row = rows[0];
  if (row === undefined) return null;
  return {
    ...summarizeWebhookRow(row),
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    rawBody: row.raw_body as string,
  };
}

// --- reconciliation findings ---------------------------------------------------------------

export type ReconciliationClassification =
  'EXPECTED' | 'PENDING' | 'MISMATCHED' | 'ORPHANED' | 'UNRECOGNIZED';
export type ReviewStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface FindingSummary {
  id: string;
  webhookEventId: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  occurredAt: string;
  classification: ReconciliationClassification;
  correlatedEntityType: string | null;
  correlatedEntityId: string | null;
  reviewStatus: ReviewStatus;
  reason: string;
  proposedRemediation: string | null;
  createdAt: string;
}

export interface ListFindingsParams {
  classification?: ReconciliationClassification;
  reviewStatus?: ReviewStatus;
  provider?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

function summarizeFindingRow(row: Row): FindingSummary {
  const details = row.details as { reason: string; proposedRemediation: string | null };
  return {
    id: row.id as string,
    webhookEventId: row.webhook_event_id as string,
    provider: row.provider as string,
    providerEventId: row.provider_event_id as string,
    eventType: row.event_type as string,
    occurredAt: toIso(row.occurred_at),
    classification: row.classification as ReconciliationClassification,
    correlatedEntityType: (row.correlated_entity_type as string | null) ?? null,
    correlatedEntityId: (row.correlated_entity_id as string | null) ?? null,
    reviewStatus: row.review_status as ReviewStatus,
    reason: details.reason,
    proposedRemediation: details.proposedRemediation ?? null,
    createdAt: toIso(row.created_at),
  };
}

export async function listFindings(
  sql: Sql,
  params: ListFindingsParams,
): Promise<{ items: FindingSummary[]; total: number }> {
  const { limit, offset } = pageBounds(params.page, params.pageSize);
  const search =
    params.search !== undefined && params.search.length > 0 ? `%${params.search}%` : null;

  const rows = (await sql`
    SELECT * FROM reconciliation_findings
    WHERE 1 = 1
      ${params.classification !== undefined ? sql`AND classification = ${params.classification}` : sql``}
      ${params.reviewStatus !== undefined ? sql`AND review_status = ${params.reviewStatus}` : sql``}
      ${params.provider !== undefined ? sql`AND provider = ${params.provider}` : sql``}
      ${search !== null ? sql`AND (provider_event_id ILIKE ${search} OR correlated_entity_id::text ILIKE ${search})` : sql``}
      ${params.from !== undefined ? sql`AND occurred_at >= ${params.from}` : sql``}
      ${params.to !== undefined ? sql`AND occurred_at <= ${params.to}` : sql``}
    ORDER BY seq DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as unknown as Row[];

  const countRows = (await sql`
    SELECT count(*)::int AS n FROM reconciliation_findings
    WHERE 1 = 1
      ${params.classification !== undefined ? sql`AND classification = ${params.classification}` : sql``}
      ${params.reviewStatus !== undefined ? sql`AND review_status = ${params.reviewStatus}` : sql``}
      ${params.provider !== undefined ? sql`AND provider = ${params.provider}` : sql``}
      ${search !== null ? sql`AND (provider_event_id ILIKE ${search} OR correlated_entity_id::text ILIKE ${search})` : sql``}
      ${params.from !== undefined ? sql`AND occurred_at >= ${params.from}` : sql``}
      ${params.to !== undefined ? sql`AND occurred_at <= ${params.to}` : sql``}
  `) as unknown as { n: number }[];

  return { items: rows.map(summarizeFindingRow), total: countRows[0]!.n };
}

/** Resolves the finding's correlated entity back to a Vink id — the one join every
 * correlated_entity_type needs, since purchase_authorizations/settlements aren't
 * vink-identified any other way from the finding row alone. */
async function resolveLinkedVinkId(
  sql: Sql,
  correlatedEntityType: string | null,
  correlatedEntityId: string | null,
): Promise<string | null> {
  if (correlatedEntityType === null || correlatedEntityId === null) return null;
  if (correlatedEntityType === 'contribution') {
    const rows =
      (await sql`SELECT vink_id FROM contributions WHERE id = ${correlatedEntityId}`) as unknown as {
        vink_id: string;
      }[];
    return rows[0]?.vink_id ?? null;
  }
  if (correlatedEntityType === 'purchase_authorization') {
    const rows = (await sql`
      SELECT vink_id FROM purchase_authorizations WHERE id = ${correlatedEntityId}
    `) as unknown as { vink_id: string }[];
    return rows[0]?.vink_id ?? null;
  }
  if (correlatedEntityType === 'settlement') {
    const rows =
      (await sql`SELECT vink_id FROM settlements WHERE id = ${correlatedEntityId}`) as unknown as {
        vink_id: string;
      }[];
    return rows[0]?.vink_id ?? null;
  }
  return null;
}

export interface AuditEntry {
  id: string;
  operatorName: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface FindingDetail extends FindingSummary {
  webhookEvent: {
    payload: Record<string, unknown> | null;
    rawBody: string;
    deliveryCount: number;
    status: string;
  };
  linkedVinkId: string | null;
  ledgerEntries: Row[];
  reconciliationHistory: FindingSummary[];
  auditHistory: AuditEntry[];
}

export async function getFindingDetail(sql: Sql, id: string): Promise<FindingDetail | null> {
  const rows =
    (await sql`SELECT * FROM reconciliation_findings WHERE id = ${id}`) as unknown as Row[];
  const row = rows[0];
  if (row === undefined) return null;
  const finding = summarizeFindingRow(row);

  const webhookRows = (await sql`
    SELECT payload, raw_body, delivery_count, status FROM webhook_events WHERE id = ${finding.webhookEventId}
  `) as unknown as Row[];
  const webhookRow = webhookRows[0];

  const linkedVinkId = await resolveLinkedVinkId(
    sql,
    finding.correlatedEntityType,
    finding.correlatedEntityId,
  );

  const ledgerRows: Row[] =
    finding.correlatedEntityType !== null && finding.correlatedEntityId !== null
      ? ((await sql`
          SELECT le.* FROM ledger_entries le
          JOIN ledger_transactions lt ON lt.id = le.transaction_id
          WHERE (lt.reference_type = ${finding.correlatedEntityType} AND lt.reference_id = ${finding.correlatedEntityId})
             ${linkedVinkId !== null ? sql`OR (lt.reference_type = 'vink' AND lt.reference_id = ${linkedVinkId})` : sql``}
          ORDER BY le.seq ASC
        `) as unknown as Row[])
      : [];

  const historyRows = (await sql`
    SELECT * FROM reconciliation_findings
    WHERE correlated_entity_type = ${finding.correlatedEntityType}
      AND correlated_entity_id = ${finding.correlatedEntityId}
      AND id != ${finding.id}
    ORDER BY seq DESC
  `) as unknown as Row[];

  const auditRows = (await sql`
    SELECT id, operator_name, action, details, created_at FROM operator_audit_log
    WHERE details->>'findingId' = ${finding.id}
    ORDER BY seq DESC
  `) as unknown as Row[];

  return {
    ...finding,
    webhookEvent: {
      payload: (webhookRow?.payload as Record<string, unknown> | null) ?? null,
      rawBody: (webhookRow?.raw_body as string) ?? '',
      deliveryCount: Number(webhookRow?.delivery_count ?? 1),
      status: (webhookRow?.status as string) ?? 'received',
    },
    linkedVinkId,
    ledgerEntries: ledgerRows,
    reconciliationHistory: historyRows.map(summarizeFindingRow),
    auditHistory: auditRows.map((r) => ({
      id: r.id as string,
      operatorName: r.operator_name as string,
      action: r.action as string,
      details: r.details as Record<string, unknown>,
      createdAt: toIso(r.created_at),
    })),
  };
}

/** The only write in this file — an operator-workflow annotation, never a financial mutation
 * (Slice 5's own migration comment: "never auto-advanced by any reconciliation code path").
 * Returns null if the finding doesn't exist, so the route can 404 rather than silently no-op. */
export async function setFindingReviewStatus(
  sql: Sql,
  id: string,
  reviewStatus: ReviewStatus,
): Promise<FindingSummary | null> {
  const rows = (await sql`
    UPDATE reconciliation_findings SET review_status = ${reviewStatus} WHERE id = ${id}
    RETURNING *
  `) as unknown as Row[];
  const row = rows[0];
  return row !== undefined ? summarizeFindingRow(row) : null;
}
