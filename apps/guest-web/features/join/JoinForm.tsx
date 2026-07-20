'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { joinVink } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { track } from '../../lib/analytics';
import { formatMoney } from '../../lib/money';
import { StatusBadge } from '../../components/StatusBadge';
import type { GuestSession, PublicVinkSummary } from '../../lib/types';

const CATEGORY_LABELS: Record<string, string> = {
  GROCERY: 'Grocery run',
  RETAIL: 'Retail purchase',
  ELECTRONICS: 'Electronics purchase',
  RESTAURANT: 'Restaurant bill',
  HOTEL: 'Hotel stay',
  FUEL: 'Fuel',
  CAR_RENTAL: 'Car rental',
};

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
      </div>

      {!summary.joinable ? (
        <p className="rounded-xl bg-danger/8 px-4 py-3 text-sm text-danger font-sans">
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
            <p role="alert" className="text-sm text-danger">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : 'Something went wrong — try again.'}
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
