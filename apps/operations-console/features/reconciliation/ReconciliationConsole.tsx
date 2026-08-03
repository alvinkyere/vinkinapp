'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { listFindings, listWebhookEvents, replayWebhookEvent } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import type { FindingFilters, WebhookEventFilters } from '../../lib/api';
import type {
  ReconciliationClassification,
  ReviewStatus,
  WebhookEventStatus,
} from '../../lib/types';
import {
  ClassificationBadge,
  ReviewStatusBadge,
  WebhookStatusBadge,
} from '../../components/ReconciliationBadges';
import { useOperator } from '../ops/operator-context';
import { RunReconciliationButton } from './RunReconciliationButton';

const CLASSIFICATIONS: ReconciliationClassification[] = [
  'EXPECTED',
  'PENDING',
  'MISMATCHED',
  'ORPHANED',
  'UNRECOGNIZED',
];
const REVIEW_STATUSES: ReviewStatus[] = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];
const PAGE_SIZE = 25;

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | '';
  options: readonly T[];
  onChange: (value: T | '') => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T | '')}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  return (
    <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-500">
      <span>{total === 0 ? '0 results' : `Page ${page} of ${totalPages} (${total} total)`}</span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded border border-gray-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded border border-gray-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function FindingsTab() {
  const { operatorToken } = useOperator();
  const [filters, setFilters] = useState<{
    classification: ReconciliationClassification | '';
    reviewStatus: ReviewStatus | '';
    provider: string;
    search: string;
  }>({ classification: '', reviewStatus: '', provider: '', search: '' });
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['reconciliation-findings', filters, page],
    queryFn: () => {
      const params: FindingFilters = { page, pageSize: PAGE_SIZE };
      if (filters.classification !== '') params.classification = filters.classification;
      if (filters.reviewStatus !== '') params.reviewStatus = filters.reviewStatus;
      if (filters.provider !== '') params.provider = filters.provider;
      if (filters.search !== '') params.search = filters.search;
      return listFindings(operatorToken, params);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Classification"
          value={filters.classification}
          options={CLASSIFICATIONS}
          onChange={(value) => {
            setFilters((f) => ({
              ...f,
              classification: value as ReconciliationClassification | '',
            }));
            setPage(1);
          }}
        />
        <FilterSelect
          label="Review status"
          value={filters.reviewStatus}
          options={REVIEW_STATUSES}
          onChange={(value) => {
            setFilters((f) => ({ ...f, reviewStatus: value as ReviewStatus | '' }));
            setPage(1);
          }}
        />
        <FilterInput
          label="Provider"
          value={filters.provider}
          onChange={(value) => {
            setFilters((f) => ({ ...f, provider: value }));
            setPage(1);
          }}
          placeholder="stripe, mock…"
        />
        <FilterInput
          label="Search (event id / entity id)"
          value={filters.search}
          onChange={(value) => {
            setFilters((f) => ({ ...f, search: value }));
            setPage(1);
          }}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {query.isPending ? <p className="p-4 text-sm text-gray-500">Loading…</p> : null}
        {query.isError ? (
          <p className="p-4 text-sm text-red-600">Failed to load findings.</p>
        ) : null}
        {query.data !== undefined ? (
          <>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Occurred</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Provider</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Event type</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Classification</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Review</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">
                    Correlated entity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {query.data.items.map((finding) => (
                  <tr key={finding.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-700">
                      <Link
                        href={`/reconciliation/findings/${finding.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {new Date(finding.occurredAt).toLocaleString()}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{finding.provider}</td>
                    <td className="px-4 py-2 text-gray-700">{finding.eventType}</td>
                    <td className="px-4 py-2">
                      <ClassificationBadge classification={finding.classification} />
                    </td>
                    <td className="px-4 py-2">
                      <ReviewStatusBadge reviewStatus={finding.reviewStatus} />
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {finding.correlatedEntityType ?? '—'}
                    </td>
                  </tr>
                ))}
                {query.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                      No findings match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <Pagination
              page={page}
              total={query.data.total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function ReplayButton({ webhookEventId }: { webhookEventId: string }) {
  const { operatorToken } = useOperator();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => replayWebhookEvent(operatorToken, webhookEventId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-webhook-events'] });
    },
  });

  if (mutation.isSuccess) {
    return <span className="text-xs text-emerald-700">Replayed: {mutation.data.outcome}</span>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {mutation.isPending ? 'Replaying…' : 'Replay'}
      </button>
      {mutation.isError ? (
        <span role="alert" className="text-xs text-red-600">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Replay failed.'}
        </span>
      ) : null}
    </div>
  );
}

function WebhookInboxTab() {
  const { operatorToken } = useOperator();
  const [filters, setFilters] = useState<{
    provider: string;
    status: WebhookEventStatus | '';
    search: string;
  }>({ provider: '', status: '', search: '' });
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['reconciliation-webhook-events', filters, page],
    queryFn: () => {
      const params: WebhookEventFilters = { page, pageSize: PAGE_SIZE };
      if (filters.provider !== '') params.provider = filters.provider;
      if (filters.status !== '') params.status = filters.status;
      if (filters.search !== '') params.search = filters.search;
      return listWebhookEvents(operatorToken, params);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterInput
          label="Provider"
          value={filters.provider}
          onChange={(value) => {
            setFilters((f) => ({ ...f, provider: value }));
            setPage(1);
          }}
          placeholder="stripe, mock…"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={['received', 'dead_letter']}
          onChange={(value) => {
            setFilters((f) => ({ ...f, status: value as WebhookEventStatus | '' }));
            setPage(1);
          }}
        />
        <FilterInput
          label="Search (event id / object id)"
          value={filters.search}
          onChange={(value) => {
            setFilters((f) => ({ ...f, search: value }));
            setPage(1);
          }}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {query.isPending ? <p className="p-4 text-sm text-gray-500">Loading…</p> : null}
        {query.isError ? (
          <p className="p-4 text-sm text-red-600">Failed to load the webhook inbox.</p>
        ) : null}
        {query.data !== undefined ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Received</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Provider</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Event ID</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Occurred</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Retries</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Last error</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {query.data.items.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700">
                        {new Date(event.receivedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-gray-700">{event.provider}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">
                        {event.providerEventId}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700">
                        {event.occurredAt !== null
                          ? new Date(event.occurredAt).toLocaleString()
                          : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <WebhookStatusBadge status={event.status} />
                      </td>
                      <td className="px-4 py-2 tabular-nums text-gray-700">
                        {event.deliveryCount}
                      </td>
                      <td
                        className="max-w-xs truncate px-4 py-2 text-red-700"
                        title={event.lastError ?? ''}
                      >
                        {event.lastError ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        {event.status === 'dead_letter' ? (
                          <ReplayButton webhookEventId={event.id} />
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {query.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                        No webhook events match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={query.data.total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function ReconciliationConsole() {
  const { operatorName, logout } = useOperator();
  const [tab, setTab] = useState<'findings' | 'inbox'>('findings');

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Reconciliation</h1>
          <p className="text-xs text-gray-500">
            Diagnostic only — findings and the webhook inbox are read-only; nothing here moves
            money, approves a payment, or edits a financial record.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <RunReconciliationButton />
          <div className="flex flex-col items-end gap-1 text-sm text-gray-500">
            <Link href="/" className="text-blue-600 hover:underline">
              Vink search
            </Link>
            <span className="flex items-center gap-2">
              {operatorName}
              <button type="button" onClick={logout} className="text-blue-600 hover:underline">
                Sign out
              </button>
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {(['findings', 'inbox'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === value
                ? 'border-b-2 border-gray-900 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {value === 'findings' ? 'Reconciliation findings' : 'Webhook inbox / dead letters'}
          </button>
        ))}
      </div>

      {tab === 'findings' ? <FindingsTab /> : <WebhookInboxTab />}
    </main>
  );
}
