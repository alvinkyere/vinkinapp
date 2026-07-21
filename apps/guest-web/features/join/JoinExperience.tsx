'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getGuestSession, getPublicVinkView } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { track } from '../../lib/analytics';
import { GUEST_CONTRIBUTION_STATUS_UI_ENABLED } from '../../lib/config';
import { isFullGuestSession, isNotOpenYetPublicView } from '../../lib/guest-view-guards';
import { humanErrorMessage } from '../../lib/human-errors';
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
      const status =
        publicViewQuery.error instanceof ApiError ? publicViewQuery.error.status : null;
      track('guest_join_lookup_failed', { publicCode, status });
    }
  }, [publicViewQuery.isSuccess, publicViewQuery.isError, publicViewQuery.error, publicCode]);

  if (!hasMounted || (effectiveSession !== null && sessionQuery.isPending)) {
    return <StatusMessage>Loading…</StatusMessage>;
  }

  if (effectiveSession !== null && sessionQuery.isSuccess) {
    const session = sessionQuery.data;
    // D23 (Slice I3): an organizer-invited guest can have a participant row on a DRAFT vink
    // (`inviteGuestCommand` allows DRAFT-or-OPEN) — never render `SessionView` with a shape
    // it doesn't have fields for. Gated: when the flag is off, this narrow (and, per Phase 10
    // §11, not-yet-paired-with-the-backend-flag) case falls back to a plain loading state
    // rather than a broken partial render — never a crash either way.
    if (!isFullGuestSession(session)) {
      return GUEST_CONTRIBUTION_STATUS_UI_ENABLED ? (
        <NotOpenYet />
      ) : (
        <StatusMessage>Loading…</StatusMessage>
      );
    }
    return (
      <SessionView
        vinkId={effectiveSession.vinkId}
        guestToken={effectiveSession.guestToken}
        initial={session}
      />
    );
  }

  if (effectiveSession === null) {
    if (publicViewQuery.isPending) return <StatusMessage>Loading…</StatusMessage>;
    if (publicViewQuery.isError) {
      return <StatusMessage>{humanErrorMessage(publicViewQuery.error)}</StatusMessage>;
    }
    if (publicViewQuery.data !== undefined) {
      const summary = publicViewQuery.data;
      // D23 (Slice I3, permitted work): a DRAFT vink must never leak its amount/split/state
      // to an anonymous visitor — the rejected alternative was "relabel the badge but still
      // show the summary." Gated behind `guest_contribution_status_ui`; flag off preserves
      // today's exact existing leak (a known, already-shipped regression, not a new risk).
      if (isNotOpenYetPublicView(summary)) {
        return GUEST_CONTRIBUTION_STATUS_UI_ENABLED ? (
          <NotOpenYet />
        ) : (
          <StatusMessage>Loading…</StatusMessage>
        );
      }
      return (
        <JoinForm
          publicCode={publicCode}
          summary={summary}
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
    <div
      role="status"
      className="mx-auto flex w-full max-w-md flex-col items-center gap-2 p-10 text-center font-sans text-smoke"
    >
      {children}
    </div>
  );
}

// D23 / Phase 6 §16's exact row: heading "Not open yet", explanation "Check back soon." —
// deliberately withholds everything else (amount, split, category), per D23's own rejected
// alternative.
function NotOpenYet() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-2 p-10 text-center font-sans">
      <h1 className="font-display text-lg font-bold text-ink">Not open yet</h1>
      <p role="status" className="text-sm text-smoke">
        Check back soon.
      </p>
    </div>
  );
}
