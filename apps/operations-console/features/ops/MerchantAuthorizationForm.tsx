'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createMerchantAuthorization } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { useOperator } from './operator-context';

export function MerchantAuthorizationForm({
  vinkId,
  disabled,
  onDone,
}: {
  vinkId: string;
  disabled: boolean;
  onDone: () => void;
}) {
  const { operatorToken } = useOperator();
  const [merchantName, setMerchantName] = useState('Corner Grocer');
  const [merchantIdentifier, setMerchantIdentifier] = useState('SIM-MERCHANT-1');
  const [mcc, setMcc] = useState('5411');
  const [amount, setAmount] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createMerchantAuthorization(operatorToken, vinkId, {
        merchantName,
        merchantIdentifier,
        mcc,
        amountMinor: Math.round(Number(amount) * 100),
      }),
    onSuccess: onDone,
  });

  return (
    <form
      className="flex flex-1 flex-col gap-2 rounded-lg border border-gray-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <p className="text-xs font-medium text-gray-700">1. Merchant authorization (the &quot;swipe&quot;)</p>
      <input
        aria-label="Merchant name"
        value={merchantName}
        onChange={(event) => setMerchantName(event.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <input
        aria-label="Merchant identifier"
        value={merchantIdentifier}
        onChange={(event) => setMerchantIdentifier(event.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <input
        aria-label="MCC"
        value={mcc}
        onChange={(event) => setMcc(event.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <input
        aria-label="Amount (dollars)"
        placeholder="Amount ($)"
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
        <p className="text-xs text-emerald-700">Outcome: {mutation.data.outcome}</p>
      ) : null}
      <button
        type="submit"
        disabled={disabled || mutation.isPending}
        className="rounded bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {mutation.isPending ? 'Authorizing…' : 'Authorize'}
      </button>
      {disabled ? <p className="text-xs text-gray-400">Needs an active card.</p> : null}
    </form>
  );
}
