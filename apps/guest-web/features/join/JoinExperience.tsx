'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getGuestSession, getPublicVinkView } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { track } from '../../lib/analytics';
import { clearGuestSession, loadGuestSession, saveGuestSession } from '../../lib/session-storage';
import { useHasMounted } from '../../lib/use-has-mounted';
import { JoinForm } from './JoinForm';
import { SessionView } from './SessionView';
import type { GuestSession } from '../../lib/types';

export function JoinExperience({ publicCode }: { publicCode: string }) {
  const hasMounted = useHasMounted();
  // Only ever set by the join event handler below — never by an effect. A returning
  // guest's stored session is read fresh on each render once mounted (cheap; storage
  // rarely changes) so no separate "load on mount" state/effect is needed at all.
  const [joinedSession, setJoinedSession] = useState<GuestSession | null>(null);
  const storedSession = hasMounted ? loadGuestSession(publicCode) : null;
  const candidateSession = joinedSession ?? storedSession;

  const sessionQuery = useQuery({
    queryKey: ['guest-session', candidateSession?.guestToken],
    queryFn: () => getGuestSession(candidateSession!.guestToken),
    enabled: candidateSession !== null,
    retry: false,
  });

  // A pure side effect (clearing storage), not a state update — an expired/invalid stored
  // token is handled by deriving `effectiveSession` from `sessionQuery.isError` below, not
  // by setting state here.
  useEffect(() => {
    if (sessionQuery.isError && candidateSession !== null) {
      clearGuestSession(publicCode);
    }
  }, [sessionQuery.isError, candidateSession, publicCode]);

  const effectiveSession = sessionQuery.isError ? null : candidateSession;

  const publicViewQuery = useQuery({
    queryKey: ['public-vink', publicCode],
    queryFn: () => getPublicVinkView(publicCode),
    enabled: hasMounted && effectiveSession === null,
  });

  // Funnel entry point (PV12 prep). A pure side effect — track() is fire-and-forget, not a
  // state update, so this doesn't trip the set-state-in-effect concern the rest of this
  // file is careful about.
  useEffect(() => {
    if (publicViewQuery.isSuccess) track('guest_join_page_viewed', { publicCode });
    if (publicViewQuery.isError) {
      const status = publicViewQuery.error instanceof ApiError ? publicViewQuery.error.status : null;
      track('guest_join_lookup_failed', { publicCode, status });
    }
  }, [publicViewQuery.isSuccess, publicViewQuery.isError, publicViewQuery.error, publicCode]);

  if (!hasMounted || (effectiveSession !== null && sessionQuery.isPending)) {
    return <StatusMessage>Loading…</StatusMessage>;
  }

  if (effectiveSession !== null && sessionQuery.isSuccess) {
    return (
      <SessionView
        vinkId={effectiveSession.vinkId}
        guestToken={effectiveSession.guestToken}
        initial={sessionQuery.data}
      />
    );
  }

  if (effectiveSession === null) {
    if (publicViewQuery.isPending) return <StatusMessage>Loading…</StatusMessage>;
    if (publicViewQuery.isError) {
      const notFound = publicViewQuery.error instanceof ApiError && publicViewQuery.error.status === 404;
      return (
        <StatusMessage>
          {notFound ? "This link doesn't match any Vink." : 'Something went wrong loading this Vink.'}
        </StatusMessage>
      );
    }
    if (publicViewQuery.data !== undefined) {
      return (
        <JoinForm
          publicCode={publicCode}
          summary={publicViewQuery.data}
          onJoined={(newSession) => {
            saveGuestSession(newSession);
            setJoinedSession(newSession);
          }}
        />
      );
    }
  }

  return <StatusMessage>Loading…</StatusMessage>;
}

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="mx-auto flex w-full max-w-md flex-col items-center gap-2 p-10 text-center text-gray-600">
      {children}
    </div>
  );
}
