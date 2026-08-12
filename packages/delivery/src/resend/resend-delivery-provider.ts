import { Resend } from 'resend';
import type { DeliveryProvider } from '../provider.ts';
import type { DeliveryInput, DeliveryResult } from '../types.ts';
import type { ResendAdapterConfig } from './config.ts';
import { renderEmail } from './templates.ts';

/** The minimal shape this adapter needs from the real `Resend` client — lets tests inject a
 * fake client with no network calls, the same DI pattern `StripeFinancialProvider` uses via
 * its own constructor-injected `Stripe` client. */
export interface ResendClientLike {
  emails: {
    send(params: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    }): Promise<{
      data: { id: string } | null;
      error: { name: string; message: string } | null;
    }>;
  };
}

/** Resend error names that mean the adapter itself is misconfigured (bad/missing/scope-
 * restricted API key) — never a legitimate per-message outcome. Per `DeliveryProvider`'s own
 * contract, these throw rather than resolve `{accepted: false}`; everything else Resend
 * returns (recipient rejected, sandbox-domain-restricted, rate limited) is a real per-send
 * outcome and resolves normally. */
const ADAPTER_MISCONFIGURED_ERROR_NAMES = new Set([
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
]);

export interface ResendDeliveryProviderOptions {
  /** Governs the "Test invitation — no production delivery guarantees" banner (RM4D-C). */
  isProduction?: boolean;
}

/**
 * RM4D-C — the real `DeliveryProvider` adapter, replacing `MockDeliveryProvider` wherever
 * `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are configured (`apps/api/src/server.ts`). SMS is not
 * supported by this adapter (Resend is email-only) — an SMS-method `send()` resolves
 * `{accepted: false}` rather than throwing or silently no-oping, per RM4D-H's "do not pretend
 * SMS is functional" rule.
 */
export class ResendDeliveryProvider implements DeliveryProvider {
  readonly providerName = 'resend';
  readonly #client: ResendClientLike;
  readonly #fromEmail: string;
  readonly #isProduction: boolean;

  constructor(
    config: ResendAdapterConfig,
    options: ResendDeliveryProviderOptions = {},
    client: ResendClientLike = new Resend(config.apiKey),
  ) {
    this.#client = client;
    this.#fromEmail = config.fromEmail;
    this.#isProduction = options.isProduction ?? false;
  }

  async send(input: DeliveryInput): Promise<DeliveryResult> {
    if (input.method !== 'EMAIL') {
      return { accepted: false, failureReason: 'SMS_NOT_SUPPORTED_BY_RESEND' };
    }

    const rendered = renderEmail(input.template, this.#isProduction);
    const { data, error } = await this.#client.emails.send({
      from: this.#fromEmail,
      to: input.destination,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (error !== null) {
      if (ADAPTER_MISCONFIGURED_ERROR_NAMES.has(error.name)) {
        throw new Error(`ResendDeliveryProvider misconfigured: ${error.name}: ${error.message}`);
      }
      return { accepted: false, failureReason: `${error.name}: ${error.message}` };
    }
    return { accepted: true, ...(data !== null && { providerMessageId: data.id }) };
  }
}
