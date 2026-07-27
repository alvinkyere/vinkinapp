import { FindingDetailView } from '../../../../features/reconciliation/FindingDetailView';

export default async function FindingDetailPage({
  params,
}: {
  params: Promise<{ findingId: string }>;
}) {
  const { findingId } = await params;
  return <FindingDetailView findingId={findingId} />;
}
