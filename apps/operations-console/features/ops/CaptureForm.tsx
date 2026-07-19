'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { captureAuthorization } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { useOperator } from './operator-context';

export function CaptureForm({
  vinkId,
  authorizationId,
  providerAuthorizationId,
  requestedAmountMinor,
  onDone,
}: {
  vinkId: string;
  authorizationId: string | null;
  providerAuthorizationId: string | undefined;
  requestedAmountMinor: number;
  onDone: () => void;
}) {
  const { operatorToken } = useOperator();
  const [amount, setAmount] = useState('');

  // A genuine prop-sync case, not the "you might not need an effect" trap: this form must
  // NOT remount when a new authorization appears (unlike a `key`-based reset), because
  // remounting would wipe the mutation's own success/error state the instant a capture
  // succeeds — the authorization's status flips APPROVED → CAPTURED in the same refetch
  // that's supposed to let the operator see "Settlement: MATCHED" (a real bug this exact
  // shape caused before the fix: see PV11 milestone report).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    if (requestedAmountMinor > 0) setAmount((requestedAmountMinor / 100).toFixed(2));
  }, [requestedAmountMinor]);

  const mutation = useMutation({
    mutationFn: () => {
      if (authorizationId === null) throw new Error('no open authorization');
      return captureAuthorization(operatorToken, authorizationId, {
        vinkId,
        providerAuthorizationId,
        settledAmountMinor: Math.round(Number(amount) * 100),
      });
    },
    onSuccess: onDone,
  });

  const disabled = authorizationId === null;

  return (
    <form
      className="flex flex-1 flex-col gap-2 rounded-lg border border-gray-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <p className="text-xs font-medium text-gray-700">2. Capture (settlement)</p>
      <input
        aria-label="Settled amount (dollars)"
        placeholder="Settled amount ($)"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        required
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      {mutation.isError ? (
        <p role="alert" className="text-xs text-red-600">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Failed.'}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p className="text-xs text-emerald-700">
          Settlement: {mutation.data.settlementStatus} → vink {mutation.data.vinkState}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={disabled || mutation.isPending}
        className="rounded bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {mutation.isPending ? 'Capturing…' : 'Capture'}
      </button>
      {disabled ? <p className="text-xs text-gray-400">No open authorization to capture.</p> : null}
    </form>
  );
}
