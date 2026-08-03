import { VinkDetailView } from '../../../features/ops/VinkDetailView';

export default async function VinkDetailPage({
  params,
}: {
  params: Promise<{ vinkId: string }>;
}) {
  const { vinkId } = await params;
  return <VinkDetailView vinkId={vinkId} />;
}
