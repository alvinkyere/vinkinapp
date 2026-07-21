'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authorizeGuestContribution } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { track } from '../../lib/analytics';
import { GUEST_CONTRIBUTION_STATUS_UI_ENABLED } from '../../lib/config';
import {
  contributionStatusSentence,
  contributionStatusWord,
  terminalOutcomeSentence,
} from '../../lib/guest-copy';
import { humanErrorMessage } from '../../lib/human-errors';
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
  const { view: liveView, refetch } = useGuestRealtime(vinkId, guestToken, initial);
  const view = liveView ?? initial;
  // Flag-off path only (P0-2's known, deliberately-preserved defect — see lib/config.ts):
  // a local flag that resets on reload and re-offers the action even after a genuine
  // success. Flag-on path never reads this — it reads `view.participant.contributionStatus`,
  // the server truth, instead.
  const [hasAuthorizedLocally, setHasAuthorizedLocally] = useState(false);

  // Idempotent server-side guarantee (D-established): if this guest already authorized in
  // a prior session (e.g. after a reload), a second click just confirms the same outcome
  // (`replayed: true`, same settled status) rather than double-charging — safe to always
  // offer the button while OPEN and let the response settle whether to hide it.
  const mutation = useMutation({
    mutationFn: () => authorizeGuestContribution(guestToken),
    onSuccess: async (result) => {
      if (SETTLED_CONTRIBUTION_STATUSES.has(result.contribution.status)) {
        track('guest_contribution_approved', { status: result.contribution.status }, vinkId);
        setHasAuthorizedLocally(true);
      } else {
        track('guest_contribution_failed', { status: result.contribution.status }, vinkId);
      }
      // Slice I3: read server truth immediately rather than waiting on the next WS event —
      // the direct fix for D25's "never re-offer the action" guarantee. A no-op when the
      // flag is off (nothing reads `contributionStatus` in that path), harmless either way.
      if (GUEST_CONTRIBUTION_STATUS_UI_ENABLED) await refetch();
    },
    onError: (error) => {
      track(
        'guest_contribution_failed',
        { errorCode: error instanceof ApiError ? error.code : 'UNKNOWN' },
        vinkId,
      );
    },
  });

  const showSimulationBanner = SIMULATED_STATES.has(view.vink.state);

  if (GUEST_CONTRIBUTION_STATUS_UI_ENABLED) {
    return (
      <SessionViewV2
        view={view}
        showSimulationBanner={showSimulationBanner}
        contributing={mutation.isPending}
        contributionError={mutation.isError ? humanErrorMessage(mutation.error) : null}
        onContribute={() => mutation.mutate()}
      />
    );
  }

  // --- Flag-off: today's exact existing behavior, unchanged ---------------------------

  const canContribute =
    view.vink.state === 'OPEN' &&
    view.participant.allocatedAmountMinor > 0 &&
    !hasAuthorizedLocally;
  const showSignupConversion = hasAuthorizedLocally || view.vink.state !== 'OPEN';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-6 font-sans">
      <div className="rounded-[2rem] bg-white p-7 shadow-[0_20px_60px_-15px_rgba(10,10,11,0.15)]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-lg font-bold text-ink">
            Hi, {view.participant.displayName}
          </h1>
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
        ) : hasAuthorizedLocally ? (
          <p role="status" className="mt-3 text-sm font-medium text-blue">
            You&apos;re in — your share is approved.
          </p>
        ) : canContribute ? (
          <>
            {mutation.isError ? (
              // text-ink, not text-danger: explanatory error copy uses primary text (D36;
              // docs/design/phase-8-visual-system-refinement.md §11).
              <p role="alert" className="mt-3 text-sm text-ink">
                {humanErrorMessage(mutation.error)}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="mt-4 w-full rounded-full bg-blue px-9 py-4 font-display text-sm font-bold tracking-wide text-white uppercase transition hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mutation.isPending
                ? 'Approving…'
                : `Approve ${formatMoney(view.participant.allocatedAmountMinor)}`}
            </button>
          </>
        ) : (
          <p className="mt-3 text-sm text-smoke">This Vink is no longer accepting contributions.</p>
        )}
      </div>

      {showSignupConversion ? <SignupConversion /> : null}
    </div>
  );
}

/**
 * Slice I3 (flag-on): D24/D25/D34-correct composition. The contribution action/status is
 * always driven by `view.participant.contributionStatus` (server truth, survives reload) —
 * never local component state. A definitive vink-level outcome (`terminalOutcomeSentence`)
 * replaces the share card entirely once reached; `recovery_required` deliberately does not
 * (§18's continuity rule — the guest's own money is already settled, never re-described).
 */
function SessionViewV2({
  view,
  showSimulationBanner,
  contributing,
  contributionError,
  onContribute,
}: {
  view: GuestVinkView;
  showSimulationBanner: boolean;
  contributing: boolean;
  contributionError: string | null;
  onContribute: () => void;
}) {
  const { vink, participant } = view;
  const canContribute =
    vink.state === 'OPEN' &&
    participant.allocatedAmountMinor > 0 &&
    (participant.contributionStatus === 'not_started' ||
      participant.contributionStatus === 'declined_retryable');
  const outcomeSentence = terminalOutcomeSentence(vink.vinkOutcome, vink.purchaseCategory);
  const showSignupConversion = outcomeSentence !== null || vink.state !== 'OPEN';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-6 font-sans">
      <div className="rounded-[2rem] bg-white p-7 shadow-[0_20px_60px_-15px_rgba(10,10,11,0.15)]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-lg font-bold text-ink">Hi, {participant.displayName}</h1>
          <div aria-live="polite">
            <StatusBadge state={vink.state} />
          </div>
        </div>
        <div className="mt-4">
          <ProgressBar
            fundedAmountMinor={vink.fundedAmountMinor}
            requiredAmountMinor={vink.requiredAmountMinor}
          />
        </div>
      </div>

      {showSimulationBanner ? <SimulationBanner /> : null}

      {outcomeSentence !== null ? (
        // D25/Phase 4 §9 — the outcome sentence is the primary announced content on arrival.
        <div
          role="status"
          className="rounded-[2rem] bg-white p-7 shadow-[0_1px_2px_rgba(10,10,11,0.04),0_8px_24px_-8px_rgba(10,10,11,0.08)]"
        >
          <p className="font-display text-lg font-bold text-ink">{outcomeSentence}</p>
        </div>
      ) : (
        <div className="rounded-[2rem] bg-white p-7 shadow-[0_1px_2px_rgba(10,10,11,0.04),0_8px_24px_-8px_rgba(10,10,11,0.08)]">
          <p className="text-sm text-smoke">Your share</p>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-ink">
            {formatMoney(participant.allocatedAmountMinor)}
          </p>

          {participant.allocatedAmountMinor === 0 ? (
            <p className="mt-3 text-sm text-smoke">
              The organizer hasn&apos;t assigned you a share yet.
            </p>
          ) : canContribute ? (
            <>
              {contributionError !== null ? (
                // text-ink, not text-danger: explanatory error copy uses primary text (D36;
                // docs/design/phase-8-visual-system-refinement.md §11).
                <p role="alert" className="mt-3 text-sm text-ink">
                  {contributionError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={onContribute}
                disabled={contributing}
                className="mt-4 w-full rounded-full bg-blue px-9 py-4 font-display text-sm font-bold tracking-wide text-white uppercase transition hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                {contributing
                  ? 'Approving…'
                  : `Approve ${formatMoney(participant.allocatedAmountMinor)}`}
              </button>
            </>
          ) : (
            <p role="status" className="mt-3 text-sm font-medium text-blue">
              {contributionStatusSentence(
                participant.contributionStatus,
                formatMoney(participant.allocatedAmountMinor),
              )}
            </p>
          )}
          <p className="sr-only">{contributionStatusWord(participant.contributionStatus)}</p>
        </div>
      )}

      {showSignupConversion ? <SignupConversion /> : null}
    </div>
  );
}
