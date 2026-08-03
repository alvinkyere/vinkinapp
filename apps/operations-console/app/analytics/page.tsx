'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getFunnelSummary } from '../../lib/api';
import { useOperator } from '../../features/ops/operator-context';

// The exit gate names five measurable numbers (master plan PV12) plus "no unresolved
// critical correctness defects" — a judgment call this dashboard can't compute, tracked
// separately. Thresholds live here, not on the backend, since they're pilot-specific
// targets, not a system invariant.
const THRESHOLDS = {
  completedVinks: 25,
  participantJoins: 75,
  organizerTaskCompletionRate: 0.8,
};

function Metric({
  label,
  value,
  target,
  met,
}: {
  label: string;
  value: string;
  target?: string;
  met?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      {target !== undefined ? (
        <p className={`mt-1 text-xs font-medium ${met ? 'text-emerald-700' : 'text-amber-700'}`}>
          {met ? '✓ meets target' : '– target'} {target}
        </p>
      ) : null}
    </div>
  );
}

export default function AnalyticsPage() {
  const { operatorToken, operatorName, logout } = useOperator();
  const query = useQuery({
    queryKey: ['ops-funnel-summary'],
    queryFn: () => getFunnelSummary(operatorToken),
    refetchInterval: 30_000,
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Search
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">PV12 pilot metrics</h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>{operatorName}</span>
          <button type="button" onClick={logout} className="text-blue-600 hover:underline">
            Sign out
          </button>
        </div>
      </div>

      {query.isPending ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {query.isError ? <p className="text-sm text-red-600">Couldn&apos;t load metrics.</p> : null}

      {query.data !== undefined ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric
              label="Complete simulated Vinks"
              value={String(query.data.completedVinks)}
              target={`≥ ${THRESHOLDS.completedVinks}`}
              met={query.data.completedVinks >= THRESHOLDS.completedVinks}
            />
            <Metric
              label="Participant joins"
              value={String(query.data.participantJoins)}
              target={`≥ ${THRESHOLDS.participantJoins}`}
              met={query.data.participantJoins >= THRESHOLDS.participantJoins}
            />
            <Metric
              label="Organizer task completion"
              value={`${(query.data.organizerTaskCompletionRate * 100).toFixed(0)}%`}
              target={`≥ ${THRESHOLDS.organizerTaskCompletionRate * 100}%`}
              met={query.data.organizerTaskCompletionRate >= THRESHOLDS.organizerTaskCompletionRate}
            />
            <Metric
              label="Median join-to-contribution time"
              value={
                query.data.medianJoinToContributionMinutes === null
                  ? '—'
                  : `${query.data.medianJoinToContributionMinutes.toFixed(1)} min`
              }
            />
            <Metric label="Vinks created (all states)" value={String(query.data.vinksCreated)} />
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Top failure points</h2>
            {query.data.topFailurePoints.length === 0 ? (
              <p className="text-sm text-gray-500">No failures reported yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {query.data.topFailurePoints.map((entry, index) => (
                  <li key={entry.eventName} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">
                      {index + 1}. {entry.eventName}
                    </span>
                    <span className="tabular-nums text-gray-500">{entry.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <p className="text-xs text-gray-400">
            The sixth exit-gate criterion — &quot;no unresolved critical correctness
            defects&quot; — is a judgment call, not a number this page computes; track it
            against the vink search/inspection view and the audit log.
          </p>
        </>
      ) : null}
    </main>
  );
}
