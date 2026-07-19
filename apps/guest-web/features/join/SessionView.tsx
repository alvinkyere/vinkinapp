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
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Hi, {view.participant.displayName}</h1>
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

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-500">Your share</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
          {formatMoney(view.participant.allocatedAmountMinor)}
        </p>

        {view.participant.allocatedAmountMinor === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            The organizer hasn&apos;t assigned you a share yet.
          </p>
        ) : hasAuthorized ? (
          <p role="status" className="mt-3 text-sm font-medium text-emerald-700">
            You&apos;re in — your share is approved.
          </p>
        ) : canContribute ? (
          <>
            {mutation.isError ? (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {mutation.error instanceof ApiError
                  ? mutation.error.message
                  : 'Something went wrong — try again.'}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? 'Approving…' : `Approve ${formatMoney(view.participant.allocatedAmountMinor)}`}
            </button>
          </>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            This Vink is no longer accepting contributions.
          </p>
        )}
      </div>

      {showSignupConversion ? <SignupConversion /> : null}
    </div>
  );
}
