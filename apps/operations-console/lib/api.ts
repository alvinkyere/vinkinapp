import { API_BASE_URL } from './config';
import { ApiError } from './api-error';
import type {
  AuditLogEntry,
  FindingDetail,
  FindingSummary,
  FunnelSummary,
  Paginated,
  ReconciliationClassification,
  ReconciliationRunResult,
  ReconciliationRunStatus,
  ReviewStatus,
  VinkDetail,
  VinkSearchResult,
  WebhookEventDetail,
  WebhookEventStatus,
  WebhookEventSummary,
} from './types';

async function request<T>(
  path: string,
  operatorToken: string | null,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(operatorToken !== null ? { authorization: `Bearer ${operatorToken}` } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body as { error: string; message?: string });
  }
  return body as T;
}

export function login(
  operatorName: string,
  password: string,
): Promise<{ operatorToken: string; operatorName: string }> {
  return request('/internal/ops/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ operatorName, password }),
  });
}

export function searchVinks(
  operatorToken: string,
  params: { publicCode?: string; organizer?: string; state?: string },
): Promise<{ vinks: VinkSearchResult[] }> {
  const query = new URLSearchParams();
  if (params.publicCode) query.set('publicCode', params.publicCode);
  if (params.organizer) query.set('organizer', params.organizer);
  if (params.state) query.set('state', params.state);
  const qs = query.toString();
  return request(`/internal/ops/vinks${qs ? `?${qs}` : ''}`, operatorToken);
}

export function getVinkDetail(operatorToken: string, vinkId: string): Promise<VinkDetail> {
  return request(`/internal/ops/vinks/${vinkId}`, operatorToken);
}

export function getFunnelSummary(operatorToken: string): Promise<FunnelSummary> {
  return request('/internal/ops/analytics/summary', operatorToken);
}

export function getAuditLog(
  operatorToken: string,
  vinkId: string,
): Promise<{ entries: AuditLogEntry[] }> {
  return request(`/internal/ops/audit-log?vinkId=${vinkId}`, operatorToken);
}

export function createMerchantAuthorization(
  operatorToken: string,
  vinkId: string,
  body: { merchantName: string; merchantIdentifier: string; mcc: string; amountMinor: number },
): Promise<{
  outcome: string;
  authorizationId: string;
  providerAuthorizationId: string;
  vinkState: string;
}> {
  return request(`/internal/ops/vinks/${vinkId}/merchant-authorizations`, operatorToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function captureAuthorization(
  operatorToken: string,
  authorizationId: string,
  body: { vinkId: string; providerAuthorizationId?: string; settledAmountMinor: number },
): Promise<{ settlementStatus: string; varianceMinor: number; vinkState: string }> {
  return request(`/internal/ops/authorizations/${authorizationId}/capture`, operatorToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- ENG6 Slice 6: reconciliation console --------------------------------------------

export interface WebhookEventFilters {
  provider?: string;
  status?: WebhookEventStatus;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

function toQueryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value !== '') query.set(key, value);
    if (typeof value === 'number') query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export function listWebhookEvents(
  operatorToken: string,
  filters: WebhookEventFilters,
): Promise<Paginated<WebhookEventSummary>> {
  return request(
    `/internal/ops/reconciliation/webhook-events${toQueryString({ ...filters })}`,
    operatorToken,
  );
}

export function getWebhookEventDetail(
  operatorToken: string,
  webhookEventId: string,
): Promise<WebhookEventDetail> {
  return request(`/internal/ops/reconciliation/webhook-events/${webhookEventId}`, operatorToken);
}

export function replayWebhookEvent(
  operatorToken: string,
  webhookEventId: string,
): Promise<{ outcome: string; webhookEventId: string | null; deliveryCount: number | null }> {
  return request(
    `/internal/ops/reconciliation/webhook-events/${webhookEventId}/replay`,
    operatorToken,
    // A real bug this fix closes: `request()` always sets `content-type: application/json`;
    // Fastify's own JSON body parser rejects a truly EMPTY body under that header with a 500
    // (`FST_ERR_CTP_EMPTY_JSON_BODY`), not a clean 4xx — caught live in a real browser against
    // the real server, not by `app.inject()` in tests (which never sets that header itself
    // when no payload is given). Same fix `triggerReconciliationRun` already uses below.
    { method: 'POST', body: '{}' },
  );
}

export interface FindingFilters {
  classification?: ReconciliationClassification;
  reviewStatus?: ReviewStatus;
  provider?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listFindings(
  operatorToken: string,
  filters: FindingFilters,
): Promise<Paginated<FindingSummary>> {
  return request(
    `/internal/ops/reconciliation/findings${toQueryString({ ...filters })}`,
    operatorToken,
  );
}

export function getFindingDetail(operatorToken: string, findingId: string): Promise<FindingDetail> {
  return request(`/internal/ops/reconciliation/findings/${findingId}`, operatorToken);
}

export function acknowledgeFinding(
  operatorToken: string,
  findingId: string,
  notes?: string,
): Promise<FindingSummary> {
  return request(`/internal/ops/reconciliation/findings/${findingId}/acknowledge`, operatorToken, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export function resolveFinding(
  operatorToken: string,
  findingId: string,
  notes: string,
): Promise<FindingSummary> {
  return request(`/internal/ops/reconciliation/findings/${findingId}/resolve`, operatorToken, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export function getReconciliationRunStatus(
  operatorToken: string,
): Promise<ReconciliationRunStatus> {
  return request('/internal/ops/reconciliation/run-status', operatorToken);
}

export function triggerReconciliationRun(operatorToken: string): Promise<ReconciliationRunResult> {
  return request('/internal/ops/reconciliation/run', operatorToken, { method: 'POST', body: '{}' });
}
