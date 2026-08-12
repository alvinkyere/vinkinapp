'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

/**
 * RM4C-C — real Stripe-hosted card entry. `loadStripe` is memoized at module scope (Stripe's
 * own documented pattern — calling it once, not per-render) and only ever constructed with
 * the publishable key the SERVER handed back (never hardcoded, never a secret key — §35).
 */
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe(publishableKey: string) {
  stripePromise ??= loadStripe(publishableKey);
  return stripePromise;
}

export type CardPaymentOutcome =
  | { kind: 'processing' }
  | { kind: 'requires_action' }
  | { kind: 'declined'; message: string }
  | { kind: 'error'; message: string };

function InnerForm({
  amountLabel,
  onOutcome,
}: {
  amountLabel: string;
  onOutcome: (outcome: CardPaymentOutcome) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (stripe === null || elements === null || submitting) return;
    setSubmitting(true);
    // `redirect: 'if_required'` keeps the guest on this page for the common case (a card, even
    // one requiring an in-page 3DS challenge) — VinkIn has no return-URL page built for a full
    // redirect flow, and a real return_url is still required by the API even when unused.
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    setSubmitting(false);
    if (error) {
      // A card error (decline, validation) is normal expected data, never a thrown exception —
      // Stripe's own distinction, mirrored here. This is what the CLIENT observed; it is never
      // treated as the source of truth for whether the contribution is paid (that's the signed
      // webhook, server-side) — only used to render an honest, immediate status to the guest.
      onOutcome({ kind: 'declined', message: error.message ?? 'Your card was declined.' });
      return;
    }
    if (paymentIntent?.status === 'requires_action') {
      onOutcome({ kind: 'requires_action' });
      return;
    }
    // requires_capture / processing / succeeded (an account default we never request, per
    // StripeFinancialProvider's own doc comment) all mean "the client's part is done" — never
    // marked paid locally; the authoritative state comes from the signed webhook.
    onOutcome({ kind: 'processing' });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      <button
        type="submit"
        disabled={stripe === null || submitting}
        className="w-full rounded-full bg-blue px-9 py-4 font-display text-sm font-bold tracking-wide text-white uppercase transition hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? 'Processing…' : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}

export function CardPaymentForm({
  publishableKey,
  clientSecret,
  amountLabel,
  onOutcome,
}: {
  publishableKey: string;
  clientSecret: string;
  amountLabel: string;
  onOutcome: (outcome: CardPaymentOutcome) => void;
}) {
  return (
    <Elements stripe={getStripe(publishableKey)} options={{ clientSecret }}>
      <InnerForm amountLabel={amountLabel} onOutcome={onOutcome} />
    </Elements>
  );
}
