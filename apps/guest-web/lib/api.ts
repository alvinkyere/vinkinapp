import { API_BASE_URL } from './config';
import { ApiError } from './api-error';
import type {
  AuthorizeContributionResponse,
  CreatePaymentSessionResponse,
  GuestVinkViewResult,
  PaymentModeInfo,
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

// RM4C-B — public, unauthenticated: nothing returned is sensitive (a Stripe publishable key
// is designed to be embedded in client code; the method list is static configuration).
export function getPaymentMethods(): Promise<PaymentModeInfo> {
  return request<PaymentModeInfo>('/api/v1/payment-methods');
}

// RM4C-C — real hosted card collection. Returns a client-safe secret only in stripe_sandbox
// mode (null in mock mode, where the existing `authorizeGuestContribution` flow is used
// instead) — never a payment method, never raw card data.
export function createGuestContributionPaymentSession(
  guestToken: string,
): Promise<CreatePaymentSessionResponse> {
  return request<CreatePaymentSessionResponse>('/api/v1/guest/contributions/payment-session', {
    method: 'POST',
    guestToken,
    body: JSON.stringify({}),
  });
}
