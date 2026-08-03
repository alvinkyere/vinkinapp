'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getReconciliationRunStatus, triggerReconciliationRun } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { useOperator } from '../ops/operator-context';

/**
 * ENG6 Slice 6 — "manual reconciliation run: explicit operator action only, no scheduler
 * introduced yet, prevent concurrent executions, progress reporting." The backend's own
 * `runReconciliation` processes one batch synchronously and returns its full result — that
 * result IS the progress report, delivered atomically at completion; `run-status` gives any
 * viewer (not just whoever clicked) a live "a run is currently in progress" signal in the
 * meantime, polled while a run might be happening.
 */
export function RunReconciliationButton() {
  const { operatorToken } = useOperator();
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['reconciliation-run-status'],
    queryFn: () => getReconciliationRunStatus(operatorToken),
    refetchInterval: (query) => (query.state.data?.inProgress ? 1000 : 10000),
  });

  const mutation = useMutation({
    mutationFn: () => triggerReconciliationRun(operatorToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-run-status'] });
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-findings'] });
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-webhook-events'] });
    },
  });

  const busy = mutation.isPending || status.data?.inProgress === true;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={busy}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Running…' : 'Run reconciliation'}
      </button>
      {mutation.isError ? (
        <p role="alert" className="text-xs text-red-600">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Run failed.'}
        </p>
      ) : null}
      {status.data?.lastRun ? (
        <p className="text-xs text-gray-500">
          Last run: {status.data.lastRun.eventsExamined} examined,{' '}
          {status.data.lastRun.findingsCreated} finding(s) created (
          {new Date(status.data.lastRun.completedAt).toLocaleString()})
        </p>
      ) : null}
    </div>
  );
}
