'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { joinVink } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { track } from '../../lib/analytics';
import { countdownLabel } from '../../lib/guest-copy';
import { humanErrorMessage } from '../../lib/human-errors';
import { formatMoney } from '../../lib/money';
import { CATEGORY_LABELS } from '../../lib/purchase-category';
import { StatusBadge } from '../../components/StatusBadge';
import { useNow } from '../../lib/use-countdown';
import type { GuestSession, PublicVinkSummary } from '../../lib/types';

export function JoinForm({
  publicCode,
  summary,
  onJoined,
}: {
  publicCode: string;
  summary: PublicVinkSummary;
  onJoined: (session: GuestSession) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  // RM4B (D47): ticks every second so this never freezes on the shortened (post-RM4A)
  // submission window — `countdownLabel`'s own Phase 6 §13 copy is unchanged, only how often
  // it's recomputed.
  const now = useNow();
  const deadlineLabel = summary.joinable ? countdownLabel(summary.submissionDeadline, now) : null;

  const mutation = useMutation({
    mutationFn: (name: string) => joinVink(publicCode, name),
    onSuccess: (result) => {
      track('guest_join_succeeded', { publicCode }, result.participant.vinkId);
      onJoined({ publicCode, guestToken: result.guestToken, vinkId: result.participant.vinkId });
    },
    onError: (error) => {
      track('guest_join_failed', {
        publicCode,
        errorCode: error instanceof ApiError ? error.code : 'UNKNOWN',
      });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-6">
      <div className="rounded-[2rem] bg-white p-7 shadow-[0_20px_60px_-15px_rgba(10,10,11,0.15)]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-lg font-bold text-ink">
            {CATEGORY_LABELS[summary.purchaseCategory] ?? summary.purchaseCategory}
          </h1>
          <StatusBadge state={summary.state} />
        </div>
        <p className="mt-2 font-display text-3xl font-extrabold tabular-nums text-ink">
          {formatMoney(summary.requiredAmountMinor)}
        </p>
        <p className="mt-1 text-sm text-smoke font-sans">
          {summary.participantCount} {summary.participantCount === 1 ? 'person' : 'people'} so far
        </p>
        {deadlineLabel !== null ? (
          <p className="mt-1 text-sm text-smoke font-sans">{deadlineLabel}</p>
        ) : null}
      </div>

      {!summary.joinable ? (
        // text-ink, not text-danger: danger text at this size fails WCAG AA (D36) — the
        // danger-tinted background carries the signal instead.
        <p className="rounded-xl bg-danger/8 px-4 py-3 text-sm text-ink font-sans">
          This Vink is no longer accepting new participants.
        </p>
      ) : (
        <form
          className="flex flex-col gap-3 font-sans"
          onSubmit={(event) => {
            event.preventDefault();
            if (displayName.trim().length === 0) return;
            mutation.mutate(displayName.trim());
          }}
        >
          <label htmlFor="displayName" className="text-sm font-medium text-ink">
            Your name
          </label>
          <input
            id="displayName"
            name="displayName"
            autoComplete="name"
            required
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="rounded-xl bg-white px-4 py-3 text-base text-ink outline outline-ink/12 focus:outline-2 focus:outline-blue"
            placeholder="e.g. Jordan"
          />
          {mutation.isError ? (
            // text-ink, not text-danger: explanatory error copy uses primary text (D36;
            // docs/design/phase-8-visual-system-refinement.md §11).
            <p role="alert" className="text-sm text-ink">
              {humanErrorMessage(mutation.error)}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={mutation.isPending || displayName.trim().length === 0}
            className="mt-2 rounded-full bg-blue px-9 py-4 font-display text-sm font-bold tracking-wide text-white uppercase transition hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? 'Joining…' : 'Join this Vink'}
          </button>
        </form>
      )}
    </div>
  );
}
