/**
 * RM4C-B (D49) — the provider-neutral payment-method capability contract. A pure projection,
 * same "no I/O, no provider SDK, application stays pure orchestration" discipline as every
 * other read model in this package (`guest.ts`'s `computeGuestContributionStatus`, etc.).
 *
 * The invariant this exists to enforce (RM4C's own core requirement): a visible payment
 * method must never pretend to be functional. A method is either genuinely usable right now
 * (`available`), or it is truthfully gated with a real, specific reason — never a button that
 * leads nowhere with no explanation, never a fabricated success.
 */

export type PaymentMethodType = 'card' | 'apple_pay' | 'venmo' | 'cash_app_pay';

export type PaymentMethodAvailability =
  'available' | 'unavailable' | 'requires_configuration' | 'coming_soon';

export interface PaymentMethodOption {
  type: PaymentMethodType;
  displayName: string;
  availability: PaymentMethodAvailability;
  unavailableReason?: string;
}

export type FinancialProviderMode = 'mock' | 'stripe_sandbox';

export interface PaymentModeInfo {
  mode: FinancialProviderMode;
  /** Stripe's own client-safe key, embedded in Stripe.js/PaymentSheet init — null outside
   * stripe_sandbox mode, since there's nothing for a client to initialize against. Publishable
   * keys are not secret by Stripe's own design (§35 governs raw card data, not this). */
  publishableKey: string | null;
  methods: PaymentMethodOption[];
}

export interface PaymentModeInput {
  financialProvider: FinancialProviderMode;
  stripePublishableKey: string | null;
}

/**
 * Card is always `available`: in `mock` mode the existing simulated flow handles it (today's
 * unchanged behavior); in `stripe_sandbox` mode a genuinely real Stripe-hosted card entry
 * flow handles it (RM4C-C). Apple Pay is unconditionally gated — no Apple merchant identifier,
 * developer capability, entitlements, or domain verification exist anywhere in this project
 * (confirmed by audit, RM4C-A); wiring a button that renders but cannot complete would violate
 * this milestone's own core invariant. Venmo/Cash App Pay are unconditionally gated — no
 * approved Braintree/PayPal or Square/Cash-App-Pay adapter exists, and D7's own rule
 * ("adapters only after a reviewed real-funds-flow/liability/API-behavior pass") governs
 * before either could ever move to `available`, not this milestone's UI layer.
 */
export function paymentModeInfo(input: PaymentModeInput): PaymentModeInfo {
  const methods: PaymentMethodOption[] = [
    {
      type: 'card',
      displayName: 'Debit or credit card',
      availability: 'available',
    },
    {
      type: 'apple_pay',
      displayName: 'Apple Pay',
      availability: 'requires_configuration',
      unavailableReason: 'Additional Apple merchant configuration required.',
    },
    {
      type: 'venmo',
      displayName: 'Venmo',
      availability: 'coming_soon',
      unavailableReason: 'Venmo is not available in this sandbox yet.',
    },
    {
      type: 'cash_app_pay',
      displayName: 'Cash App Pay',
      availability: 'coming_soon',
      unavailableReason: 'Cash App Pay is not available in this sandbox yet.',
    },
  ];
  return {
    mode: input.financialProvider,
    publishableKey:
      input.financialProvider === 'stripe_sandbox' ? input.stripePublishableKey : null,
    methods,
  };
}
