'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createGuestContributionPaymentSession, getPaymentMethods } from '../../lib/api';
import { humanErrorMessage } from '../../lib/human-errors';
import { PaymentMethodList } from '../../components/PaymentMethodList';
import { SandboxModeBanner } from '../../components/SandboxModeBanner';
import { CardPaymentForm, type CardPaymentOutcome } from './CardPaymentForm';
import type { PaymentMethodType } from '../../lib/types';

type Phase =
  | { kind: 'choose' }
  | { kind: 'creating_session' }
  | { kind: 'collecting'; clientSecret: string; publishableKey: string }
  | { kind: 'processing' }
  | { kind: 'declined'; message: string }
  | { kind: 'error'; message: string };

/**
 * RM4C-C/F/G — the real payment-method selection + Stripe-hosted card entry experience.
 * `mock` mode renders `legacyButton` completely unchanged (mock mode stays fully supported,
 * byte-for-byte today's existing behavior) — only `stripe_sandbox` mode reaches any of the
 * new UI below. The client never marks a contribution paid itself: every terminal state here
 * ("Processing…") is provisional, and `onProcessing` hands control back to the parent's own
 * realtime subscription, which reflects the server's authoritative state once the signed
 * webhook resolves it (RM4C-C's own core invariant).
 */
export function PaymentPanel({
  guestToken,
  amountLabel,
  legacyButton,
  onProcessing,
  onSessionStarted,
}: {
  guestToken: string;
  amountLabel: string;
  legacyButton: React.ReactNode;
  onProcessing: () => void;
  /** RM4C-C: called the instant a session is genuinely created (a fresh, non-replayed
   * attempt) — before the realtime subscription's own "contribution now AUTHORIZATION_PENDING"
   * update can arrive and unmount this panel out from under the guest mid-card-entry. See
   * `SessionView`'s own `paymentInProgress` doc comment for the real bug this closes. */
  onSessionStarted: () => void;
}) {
  const methodsQuery = useQuery({
    queryKey: ['payment-methods'],
    queryFn: getPaymentMethods,
    staleTime: 60_000,
  });
  const [selected, setSelected] = useState<PaymentMethodType | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });

  const sessionMutation = useMutation({
    mutationFn: () => createGuestContributionPaymentSession(guestToken),
    onSuccess: (result) => {
      if (result.clientSecret === null) {
        setPhase({
          kind: 'error',
          message: 'A payment is already in progress for your share. Refresh to check its status.',
        });
        return;
      }
      onSessionStarted();
      setPhase({
        kind: 'collecting',
        clientSecret: result.clientSecret,
        publishableKey: methodsQuery.data?.publishableKey ?? '',
      });
    },
    onError: (error) => {
      setPhase({ kind: 'error', message: humanErrorMessage(error) });
    },
  });

  if (methodsQuery.isPending) {
    return <p className="text-sm text-smoke">Loading payment options…</p>;
  }
  if (methodsQuery.data === undefined) {
    return (
      <p role="alert" className="text-sm text-ink">
        Couldn&apos;t load payment options. Refresh to try again.
      </p>
    );
  }

  // Today's exact existing behavior, unchanged — mock mode has no card-entry UI at all.
  if (methodsQuery.data.mode === 'mock') {
    return <>{legacyButton}</>;
  }

  function handleOutcome(outcome: CardPaymentOutcome): void {
    if (outcome.kind === 'declined') {
      setPhase({ kind: 'declined', message: outcome.message });
    } else if (outcome.kind === 'error') {
      setPhase({ kind: 'error', message: outcome.message });
    } else {
      // 'processing' and 'requires_action' both mean the same thing from here: the client's
      // part is done, and only the signed webhook decides what happens next.
      setPhase({ kind: 'processing' });
      onProcessing();
    }
  }

  function startCardEntry(): void {
    setSelected('card');
    setPhase({ kind: 'creating_session' });
    sessionMutation.mutate();
  }

  return (
    <div className="flex flex-col gap-4">
      <SandboxModeBanner />
      <PaymentMethodList
        methods={methodsQuery.data.methods}
        selected={selected}
        onSelect={(type) => {
          if (type === 'card' && phase.kind === 'choose') startCardEntry();
        }}
      />
      {phase.kind === 'creating_session' ? (
        <p className="text-sm text-smoke">Preparing secure card entry…</p>
      ) : null}
      {phase.kind === 'collecting' ? (
        <CardPaymentForm
          publishableKey={phase.publishableKey}
          clientSecret={phase.clientSecret}
          amountLabel={amountLabel}
          onOutcome={handleOutcome}
        />
      ) : null}
      {phase.kind === 'processing' ? (
        <p role="status" className="text-sm font-medium text-blue">
          Processing your payment…
        </p>
      ) : null}
      {phase.kind === 'declined' ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-ink">
            {phase.message}
          </p>
          <button
            type="button"
            className="text-left text-sm font-bold text-blue underline"
            onClick={startCardEntry}
          >
            Try again
          </button>
        </div>
      ) : null}
      {phase.kind === 'error' ? (
        <p role="alert" className="text-sm text-ink">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
