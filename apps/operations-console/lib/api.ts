import { API_BASE_URL } from './config';
import { ApiError } from './api-error';
import type { AuditLogEntry, FunnelSummary, VinkDetail, VinkSearchResult } from './types';

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
