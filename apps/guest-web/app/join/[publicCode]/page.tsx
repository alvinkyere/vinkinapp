import { getPublicVinkView } from '../../../lib/api';
import { JoinExperience } from '../../../features/join/JoinExperience';
import type { PublicVinkView } from '../../../lib/types';

/**
 * ENG3 Slice 5 ("server-rendered invite context," "immediate first render"): fetches the
 * anonymous-visitor view server-side, in the one place that can — a Next.js Server Component
 * — so the organizer/purpose/amount are already in the initial HTML instead of requiring a
 * client-side round trip behind a mandatory "Loading…" gate. `null` on any fetch failure
 * (unknown code, network error, backend down) is a deliberate, safe degrade: `JoinExperience`
 * re-fetches client-side and shows its own existing error handling — this page never renders
 * an error itself, since a stale/misdialed server error page is worse than a brief client
 * loading state for the rare failure case.
 */
export default async function JoinPage({ params }: { params: Promise<{ publicCode: string }> }) {
  const { publicCode } = await params;
  const initialPublicView = await fetchInitialPublicView(publicCode);
  return (
    <main className="flex flex-1 flex-col justify-center">
      <JoinExperience publicCode={publicCode} initialPublicView={initialPublicView} />
    </main>
  );
}

async function fetchInitialPublicView(publicCode: string): Promise<PublicVinkView | null> {
  try {
    return await getPublicVinkView(publicCode);
  } catch {
    return null;
  }
}
