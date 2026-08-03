'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { searchVinks } from '../lib/api';
import { formatMoney } from '../lib/money';
import { StatusBadge } from '../components/StatusBadge';
import { useOperator } from '../features/ops/operator-context';

export default function SearchPage() {
  const { operatorToken, operatorName, logout } = useOperator();
  const [publicCode, setPublicCode] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [state, setState] = useState('');
  const [submitted, setSubmitted] = useState({ publicCode: '', organizer: '', state: '' });

  const query = useQuery({
    queryKey: ['ops-search', submitted],
    queryFn: () => searchVinks(operatorToken, submitted),
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Vink search</h1>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <Link href="/analytics" className="text-blue-600 hover:underline">
            Pilot metrics
          </Link>
          <Link href="/reconciliation" className="text-blue-600 hover:underline">
            Reconciliation
          </Link>
          <span>{operatorName}</span>
          <button type="button" onClick={logout} className="text-blue-600 hover:underline">
            Sign out
          </button>
        </div>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted({ publicCode, organizer, state });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="publicCode" className="text-xs font-medium text-gray-500">
            Public code
          </label>
          <input
            id="publicCode"
            value={publicCode}
            onChange={(event) => setPublicCode(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="organizer" className="text-xs font-medium text-gray-500">
            Organizer username
          </label>
          <input
            id="organizer"
            value={organizer}
            onChange={(event) => setOrganizer(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="state" className="text-xs font-medium text-gray-500">
            State
          </label>
          <input
            id="state"
            value={state}
            onChange={(event) => setState(event.target.value)}
            placeholder="e.g. FUNDED"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Search
        </button>
      </form>

      {query.isPending ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {query.isError ? <p className="text-sm text-red-600">Search failed.</p> : null}
      {query.data !== undefined ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">
                  Public code
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">
                  Organizer
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">
                  Category
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">
                  State
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">
                  Funded
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {query.data.vinks.map((vink) => (
                <tr key={vink.id}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/vinks/${vink.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {vink.publicCode}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{vink.organizerUsername}</td>
                  <td className="px-4 py-2 text-gray-700">{vink.purchaseCategory}</td>
                  <td className="px-4 py-2">
                    <StatusBadge state={vink.state} />
                  </td>
                  <td className="px-4 py-2 tabular-nums text-gray-700">
                    {formatMoney(vink.fundedAmountMinor)} / {formatMoney(vink.requiredAmountMinor)}
                  </td>
                </tr>
              ))}
              {query.data.vinks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    No vinks match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
