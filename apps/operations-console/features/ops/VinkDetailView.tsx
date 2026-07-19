'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuditLog, getVinkDetail } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { DataTable } from '../../components/DataTable';
import { Section } from '../../components/Section';
import { StatusBadge } from '../../components/StatusBadge';
import { useOperator } from './operator-context';
import { MerchantAuthorizationForm } from './MerchantAuthorizationForm';
import { CaptureForm } from './CaptureForm';
import type { Row } from '../../lib/types';

export function VinkDetailView({ vinkId }: { vinkId: string }) {
  const { operatorToken } = useOperator();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['ops-vink', vinkId],
    queryFn: () => getVinkDetail(operatorToken, vinkId),
  });
  const auditQuery = useQuery({
    queryKey: ['ops-audit', vinkId],
    queryFn: () => getAuditLog(operatorToken, vinkId),
  });

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['ops-vink', vinkId] });
    void queryClient.invalidateQueries({ queryKey: ['ops-audit', vinkId] });
  }

  if (detailQuery.isPending) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }
  if (detailQuery.isError || detailQuery.data.vink === null) {
    return <p className="p-6 text-sm text-red-600">Vink not found.</p>;
  }

  const { vink, organizer, participants, contributions, card, purchaseAuthorizations, settlements, recoveryObligations, ledgerEntries, outboxEvents, stateHistory } =
    detailQuery.data;
  const v = vink as Row;
  const openAuthorization = purchaseAuthorizations.find((a) => a.status === 'APPROVED');
  const undeliveredCount = outboxEvents.filter((e) => e.published_at === null).length;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Search
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{v.public_code as string}</h1>
          <p className="text-sm text-gray-500">
            {v.purchase_category as string} · organizer {organizer?.username}
          </p>
        </div>
        <StatusBadge state={v.state as string} />
      </div>

      <Section title="Funding">
        <p className="text-2xl font-bold tabular-nums text-gray-900">
          {formatMoney(v.funded_amount_minor as number)} / {formatMoney(v.required_amount_minor as number)}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          submission deadline {new Date(v.submission_deadline as string).toLocaleString()}
        </p>
      </Section>

      <Section title={`Participants (${participants.length})`}>
        <DataTable rows={participants} emptyLabel="No participants." />
      </Section>

      <Section title={`Contributions (${contributions.length})`}>
        <DataTable rows={contributions} emptyLabel="No contributions yet." />
      </Section>

      <Section title="Card">
        <DataTable rows={card !== null ? [card] : []} emptyLabel="No card provisioned yet." />
      </Section>

      <Section
        title="Simulation controls"
        action={undeliveredCount > 0 ? <span className="text-xs text-amber-600">{undeliveredCount} event(s) undelivered</span> : null}
      >
        <p className="mb-3 text-xs text-gray-500">
          Merchant authorization / capture — the two operator actions this console can take,
          both calling the exact same commands the PV6 simulator does (D17).
        </p>
        <div className="flex flex-col gap-4 sm:flex-row">
          <MerchantAuthorizationForm
            vinkId={vinkId}
            disabled={card === null || card.status !== 'ACTIVE'}
            onDone={refresh}
          />
          <CaptureForm
            vinkId={vinkId}
            authorizationId={typeof openAuthorization?.id === 'string' ? openAuthorization.id : null}
            providerAuthorizationId={
              typeof openAuthorization?.provider_authorization_id === 'string'
                ? openAuthorization.provider_authorization_id
                : undefined
            }
            requestedAmountMinor={Number(openAuthorization?.approved_amount_minor ?? openAuthorization?.requested_amount_minor ?? 0)}
            onDone={refresh}
          />
        </div>
      </Section>

      <Section title={`Purchase authorizations (${purchaseAuthorizations.length})`}>
        <DataTable rows={purchaseAuthorizations} emptyLabel="No merchant authorizations yet." />
      </Section>

      <Section title={`Settlements (${settlements.length})`}>
        <DataTable rows={settlements} emptyLabel="No settlement yet." />
      </Section>

      <Section title={`Recovery obligations (${recoveryObligations.length})`}>
        <DataTable rows={recoveryObligations} emptyLabel="No recovery obligation." />
      </Section>

      <Section title={`Ledger entries (${ledgerEntries.length})`}>
        <DataTable rows={ledgerEntries} emptyLabel="No ledger postings yet." />
      </Section>

      <Section title={`Outbox / realtime delivery (${outboxEvents.length})`}>
        <DataTable rows={outboxEvents} emptyLabel="No domain events yet." />
      </Section>

      <Section title={`State history (${stateHistory.length})`}>
        <DataTable rows={stateHistory} emptyLabel="No transitions yet." />
      </Section>

      <Section title="Audit log — actions taken on this vink through this console">
        <DataTable
          rows={(auditQuery.data?.entries ?? []) as unknown as Row[]}
          emptyLabel="No operator actions recorded yet."
        />
      </Section>
    </main>
  );
}
