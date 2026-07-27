// Mirrors apps/api/src/modules/ops/store.ts. Detail rows are raw DB rows (snake_case
// columns) on purpose — this is an inspection tool, not a second domain model; showing the
// operator the actual stored shape is the point.

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

export type Row = Record<string, unknown>;

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

export interface AuditLogEntry {
  id: string;
  operatorName: string;
  action: string;
  vinkId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Mirrors apps/api/src/modules/ops/analytics.ts's FunnelSummary — the six numbers the
 * PV12 exit gate names. */
export interface FunnelSummary {
  completedVinks: number;
  participantJoins: number;
  organizerTaskCompletionRate: number;
  vinksCreated: number;
  medianJoinToContributionMinutes: number | null;
  topFailurePoints: Array<{ eventName: string; count: number }>;
}

// --- ENG6 Slice 6: reconciliation console ---------------------------------------------
// Mirrors apps/api/src/modules/reconciliation/ops-queries.ts exactly. Deliberately never
// includes signature_header (Security: "never expose webhook signatures") — no field for it
// exists anywhere in this file.

export type ReconciliationClassification =
  'EXPECTED' | 'PENDING' | 'MISMATCHED' | 'ORPHANED' | 'UNRECOGNIZED';
export type ReviewStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type WebhookEventStatus = 'received' | 'dead_letter';

export interface WebhookEventSummary {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  objectId: string | null;
  occurredAt: string | null;
  receivedAt: string;
  status: WebhookEventStatus;
  deliveryCount: number;
  lastError: string | null;
  findingId: string | null;
  classification: ReconciliationClassification | null;
}

export interface WebhookEventDetail extends WebhookEventSummary {
  payload: Record<string, unknown> | null;
  rawBody: string;
}

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
  auditHistory: AuditLogEntry[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface ReconciliationRunResult {
  runId: string;
  eventsExamined: number;
  findingsCreated: number;
  completedAt: string;
}

export interface ReconciliationRunStatus {
  inProgress: boolean;
  lastRun: ReconciliationRunResult | null;
}
