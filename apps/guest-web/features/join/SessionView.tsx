'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authorizeGuestContribution } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { track } from '../../lib/analytics';
import { formatMoney } from '../../lib/money';
import { StatusBadge } from '../../components/StatusBadge';
import { ProgressBar } from '../../components/ProgressBar';
import { SimulationBanner } from '../../components/SimulationBanner';
import { SignupConversion } from '../../components/SignupConversion';
import { useGuestRealtime } from './use-guest-realtime';
import type { GuestVinkView } from '../../lib/types';

// Any outcome except a definitive decline means this guest doesn't need to click again —
// AUTHORIZED/CAPTURED succeeded, PENDING states resolve on their own via the deadline sweep
// (Plan §10) and the guest will see the vink's state move on live regardless.
const SETTLED_CONTRIBUTION_STATUSES = new Set([
  'AUTHORIZED',
  'CAPTURED',
  'SETTLED',
  'AUTHORIZATION_PENDING',
  'RESOLUTION_PENDING',
]);

const SIMULATED_STATES = new Set([
  'FUNDED',
  'CARD_PROVISIONING',
  'CARD_READY',
  'PURCHASE_AUTHORIZED',
  'SETTLING',
  'COMPLETED',
]);

export function SessionView({
  vinkId,
  guestToken,
  initial,
}: {
  vinkId: string;
  guestToken: string;
  initial: GuestVinkView;
}) {
  const view = useGuestRealtime(vinkId, guestToken, initial) ?? initial;
  const [hasAuthorized, setHasAuthorized] = useState(false);

  // Idempotent server-side guarantee (D-established): if this guest already authorized in
  // a prior session (e.g. after a reload), a second click just confirms the same outcome
  // (`replayed: true`, same settled status) rather than double-charging — safe to always
  // offer the button while OPEN and let the response settle whether to hide it.
  const mutation = useMutation({
    mutationFn: () => authorizeGuestContribution(guestToken),
    onSuccess: (result) => {
      if (SETTLED_CONTRIBUTION_STATUSES.has(result.contribution.status)) {
        track('guest_contribution_approved', { status: result.contribution.status }, vinkId);
        setHasAuthorized(true);
      } else {
        track('guest_contribution_failed', { status: result.contribution.status }, vinkId);
      }
    },
    onError: (error) => {
      track(
        'guest_contribution_failed',
        { errorCode: error instanceof ApiError ? error.code : 'UNKNOWN' },
        vinkId,
      );
    },
  });

  const canContribute =
    view.vink.state === 'OPEN' && view.participant.allocatedAmountMinor > 0 && !hasAuthorized;
  const showSimulationBanner = SIMULATED_STATES.has(view.vink.state);
  const showSignupConversion = hasAuthorized || view.vink.state !== 'OPEN';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-6 font-sans">
      <div className="rounded-[2rem] bg-white p-7 shadow-[0_20px_60px_-15px_rgba(10,10,11,0.15)]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-lg font-bold text-ink">Hi, {view.participant.displayName}</h1>
          <div aria-live="polite">
            <StatusBadge state={view.vink.state} />
          </div>
        </div>
        <div className="mt-4">
          <ProgressBar
            fundedAmountMinor={view.vink.fundedAmountMinor}
            requiredAmountMinor={view.vink.requiredAmountMinor}
          />
        </div>
      </div>

      {showSimulationBanner ? <SimulationBanner /> : null}

      <div className="rounded-[2rem] bg-white p-7 shadow-[0_1px_2px_rgba(10,10,11,0.04),0_8px_24px_-8px_rgba(10,10,11,0.08)]">
        <p className="text-sm text-smoke">Your share</p>
        <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-ink">
          {formatMoney(view.participant.allocatedAmountMinor)}
        </p>

        {view.participant.allocatedAmountMinor === 0 ? (
          <p className="mt-3 text-sm text-smoke">
            The organizer hasn&apos;t assigned you a share yet.
          </p>
        ) : hasAuthorized ? (
          <p role="status" className="mt-3 text-sm font-medium text-blue">
            You&apos;re in — your share is approved.
          </p>
        ) : canContribute ? (
          <>
            {mutation.isError ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {mutation.error instanceof ApiError
                  ? mutation.error.message
                  : 'Something went wrong — try again.'}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="mt-4 w-full rounded-full bg-blue px-9 py-4 font-display text-sm font-bold tracking-wide text-white uppercase transition hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mutation.isPending ? 'Approving…' : `Approve ${formatMoney(view.participant.allocatedAmountMinor)}`}
            </button>
          </>
        ) : (
          <p className="mt-3 text-sm text-smoke">
            This Vink is no longer accepting contributions.
          </p>
        )}
      </div>

      {showSignupConversion ? <SignupConversion /> : null}
    </div>
  );
}
