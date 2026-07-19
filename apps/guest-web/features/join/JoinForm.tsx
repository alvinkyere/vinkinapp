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
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">
            {CATEGORY_LABELS[summary.purchaseCategory] ?? summary.purchaseCategory}
          </h1>
          <StatusBadge state={summary.state} />
        </div>
        <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
          {formatMoney(summary.requiredAmountMinor)}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {summary.participantCount} {summary.participantCount === 1 ? 'person' : 'people'} so far
        </p>
      </div>

      {!summary.joinable ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This Vink is no longer accepting new participants.
        </p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (displayName.trim().length === 0) return;
            mutation.mutate(displayName.trim());
          }}
        >
          <label htmlFor="displayName" className="text-sm font-medium text-gray-700">
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
            className="rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="e.g. Jordan"
          />
          {mutation.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : 'Something went wrong — try again.'}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={mutation.isPending || displayName.trim().length === 0}
            className="mt-2 rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? 'Joining…' : 'Join this Vink'}
          </button>
        </form>
      )}
    </div>
  );
}
