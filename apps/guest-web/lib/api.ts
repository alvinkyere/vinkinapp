import { API_BASE_URL } from './config';
import { ApiError } from './api-error';
import type { AuthorizeContributionResponse, GuestVinkView, PublicVinkSummary } from './types';

async function request<T>(
  path: string,
  init: RequestInit & { guestToken?: string } = {},
): Promise<T> {
  const { guestToken, headers, ...rest } = init;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(guestToken !== undefined ? { authorization: `Bearer ${guestToken}` } : {}),
      ...headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body as { error: string; message?: string });
  }
  return body as T;
}

export function getPublicVinkView(publicCode: string): Promise<PublicVinkSummary> {
  return request<PublicVinkSummary>(`/api/v1/join/${publicCode}`);
}

export function joinVink(
  publicCode: string,
  displayName: string,
): Promise<{
  guestToken: string;
  vink: PublicVinkSummary;
  participant: { id: string; vinkId: string; displayName: string; status: string };
}> {
  return request(`/api/v1/public/vinks/${publicCode}/participants`, {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
}

export function getGuestSession(guestToken: string): Promise<GuestVinkView> {
  return request<GuestVinkView>('/api/v1/guest/session', { guestToken });
}

export function authorizeGuestContribution(
  guestToken: string,
): Promise<AuthorizeContributionResponse> {
  return request<AuthorizeContributionResponse>('/api/v1/guest/contributions/authorize', {
    method: 'POST',
    guestToken,
    body: JSON.stringify({}),
  });
}
