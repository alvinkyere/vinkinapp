import { API_BASE_URL } from './config';
import { ApiError } from './api-error';
import type {
  AuthorizeContributionResponse,
  GuestVinkViewResult,
  PublicVinkSummary,
  PublicVinkView,
} from './types';

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

// The backend (`apps/api/src/modules/sharing/routes.ts`) always calls the additive-fields
// overload — `vinkOutcome`/`contributionProgress` are always present on the wire regardless
// of `VINKIN_CONTRIBUTION_PROJECTION_ENABLED`; only whether a DRAFT vink collapses to
// `NotOpenYetView` depends on that (backend-owned) flag. The response type reflects what the
// wire can actually send, independent of this app's own `guest_contribution_status_ui` flag.
export function getPublicVinkView(publicCode: string): Promise<PublicVinkView> {
  return request<PublicVinkView>(`/api/v1/join/${publicCode}`);
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

export function getGuestSession(guestToken: string): Promise<GuestVinkViewResult> {
  return request<GuestVinkViewResult>('/api/v1/guest/session', { guestToken });
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
