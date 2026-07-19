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
