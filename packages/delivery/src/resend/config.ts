/**
 * RM4D — real email delivery provider selection (§4's long-open external dependency,
 * finally resolved: Resend). Mirrors `packages/providers/src/stripe/config.ts`'s own
 * fail-fast discipline (`loadStripeAdapterConfig`) — construction itself must fail on
 * anything missing, never a silent default.
 *
 * Unlike Stripe, Resend has no live/test-mode key format to reject (`assertSandboxModeKey`'s
 * own reason for existing) — every Resend API key is shaped `re_...` regardless of what it's
 * authorized to send from. The real safety boundary is domain verification, enforced
 * provider-side: an unverified `fromEmail` domain can only deliver to the Resend account's
 * own registered address, not arbitrary recipients — Resend rejects that at send time, not
 * here, so `ResendDeliveryProvider.send()` surfaces it as an ordinary `{accepted: false}`
 * failure per this package's own contract (`provider.ts`), never a thrown construction error.
 */
export interface ResendAdapterConfig {
  apiKey: string;
  /** e.g. "VinkIn <hello@vinkin.org>" or a bare address — passed through to Resend verbatim. */
  fromEmail: string;
}

export function loadResendAdapterConfig(
  source: Record<string, string | undefined> = process.env,
): ResendAdapterConfig {
  const apiKey = source.RESEND_API_KEY;
  const fromEmail = source.RESEND_FROM_EMAIL;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('RESEND_API_KEY is required to construct ResendDeliveryProvider');
  }
  if (fromEmail === undefined || fromEmail.length === 0) {
    throw new Error('RESEND_FROM_EMAIL is required to construct ResendDeliveryProvider');
  }
  return { apiKey, fromEmail };
}
