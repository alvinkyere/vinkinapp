'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { acknowledgeFinding, getFindingDetail, resolveFinding } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { ClassificationBadge, ReviewStatusBadge } from '../../components/ReconciliationBadges';
import { DataTable } from '../../components/DataTable';
import { Section } from '../../components/Section';
import { useOperator } from '../ops/operator-context';

function ReviewActions({ findingId }: { findingId: string }) {
  const { operatorToken } = useOperator();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['reconciliation-finding', findingId] });
    void queryClient.invalidateQueries({ queryKey: ['reconciliation-findings'] });
  };

  const acknowledge = useMutation({
    mutationFn: () => acknowledgeFinding(operatorToken, findingId, notes || undefined),
    onSuccess: invalidate,
  });
  const resolve = useMutation({
    mutationFn: () => resolveFinding(operatorToken, findingId, notes),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-gray-500" htmlFor="review-notes">
        Resolution notes
      </label>
      <textarea
        id="review-notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={3}
        placeholder="What did you find? Required to resolve; optional to acknowledge."
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => acknowledge.mutate()}
          disabled={acknowledge.isPending}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge'}
        </button>
        <button
          type="button"
          onClick={() => resolve.mutate()}
          disabled={resolve.isPending || notes.trim().length === 0}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {resolve.isPending ? 'Resolving…' : 'Resolve'}
        </button>
      </div>
      {acknowledge.isError ? (
        <p role="alert" className="text-xs text-red-600">
          {acknowledge.error instanceof ApiError ? acknowledge.error.message : 'Failed.'}
        </p>
      ) : null}
      {resolve.isError ? (
        <p role="alert" className="text-xs text-red-600">
          {resolve.error instanceof ApiError ? resolve.error.message : 'Failed.'}
        </p>
      ) : null}
    </div>
  );
}

export function FindingDetailView({ findingId }: { findingId: string }) {
  const { operatorToken } = useOperator();
  const query = useQuery({
    queryKey: ['reconciliation-finding', findingId],
    queryFn: () => getFindingDetail(operatorToken, findingId),
  });

  if (query.isPending) {
    return <main className="mx-auto max-w-4xl p-6 text-sm text-gray-500">Loading…</main>;
  }
  if (query.isError) {
    return <main className="mx-auto max-w-4xl p-6 text-sm text-red-600">Finding not found.</main>;
  }

  const finding = query.data;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/reconciliation" className="text-sm text-blue-600 hover:underline">
            ← Reconciliation
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">Finding {finding.id}</h1>
        </div>
        <div className="flex gap-2">
          <ClassificationBadge classification={finding.classification} />
          <ReviewStatusBadge reviewStatus={finding.reviewStatus} />
        </div>
      </div>

      <Section title="Provider object reference">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Provider</dt>
          <dd className="text-gray-900">{finding.provider}</dd>
          <dt className="text-gray-500">Provider event ID</dt>
          <dd className="font-mono text-gray-900">{finding.providerEventId}</dd>
          <dt className="text-gray-500">Event type</dt>
          <dd className="text-gray-900">{finding.eventType}</dd>
          <dt className="text-gray-500">Occurred at</dt>
          <dd className="text-gray-900">{new Date(finding.occurredAt).toLocaleString()}</dd>
          <dt className="text-gray-500">Correlated entity</dt>
          <dd className="text-gray-900">
            {finding.correlatedEntityType ?? '—'} {finding.correlatedEntityId ?? ''}
          </dd>
          <dt className="text-gray-500">Linked Vink</dt>
          <dd className="text-gray-900">
            {finding.linkedVinkId !== null ? (
              <Link
                href={`/vinks/${finding.linkedVinkId}`}
                className="text-blue-600 hover:underline"
              >
                {finding.linkedVinkId}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </dl>
      </Section>

      <Section title="Reason">
        <p className="text-sm text-gray-900">{finding.reason}</p>
        {finding.proposedRemediation !== null ? (
          <p className="mt-2 text-sm text-amber-800">
            <span className="font-semibold">Proposed remediation (for operator review only):</span>{' '}
            {finding.proposedRemediation}
          </p>
        ) : null}
      </Section>

      <Section title="Operator review">
        <ReviewActions findingId={finding.id} />
      </Section>

      <Section title="Linked ledger entries">
        <DataTable rows={finding.ledgerEntries} emptyLabel="No ledger entries linked." />
      </Section>

      <Section title="Reconciliation history (other findings for this same entity)">
        {finding.reconciliationHistory.length === 0 ? (
          <p className="text-sm text-gray-500">No other findings recorded against this entity.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {finding.reconciliationHistory.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2">
                <ClassificationBadge classification={entry.classification} />
                <span className="text-gray-700">{entry.eventType}</span>
                <span className="text-gray-400">{new Date(entry.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Audit history">
        {finding.auditHistory.length === 0 ? (
          <p className="text-sm text-gray-500">No operator actions recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {finding.auditHistory.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">{entry.action}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-gray-500">by {entry.operatorName}</p>
                {typeof entry.details.notes === 'string' && entry.details.notes.length > 0 ? (
                  <p className="mt-1 text-gray-700">{entry.details.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Raw provider payload">
        <pre className="max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
          {finding.webhookEvent.rawBody}
        </pre>
      </Section>
    </main>
  );
}
