'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getGuestSession } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
import { saveGuestSession } from '../../../lib/session-storage';

/**
 * Redeems a pre-minted, organizer-issued guest token (apps/api's
 * `POST /api/v1/vinks/:vinkId/guests`, PV13 design correction) straight into a live
 * session — no join form, since the organizer already named this guest. Once redeemed,
 * this is just a normal guest session: redirect into the existing `/join/:publicCode` flow
 * (features/join/JoinExperience.tsx), which already knows how to render it from
 * localStorage. This page exists only to bridge "I have a token" to "I have a session."
 */
export default function RedeemGuestTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notOpenYet, setNotOpenYet] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGuestSession(token)
      .then((view) => {
        if (cancelled) return;
        // D23: an organizer-invited guest (`POST /api/v1/vinks/:vinkId/guests`) can redeem
        // a token before the vink is OPEN — `NotOpenYetView` withholds even `publicCode`, so
        // there's nothing to redirect to yet. Shown directly here rather than crashing on a
        // missing field; not gated behind the Guest Web UI flag (this is crash-prevention
        // for a shape the wire can already send, not a new product decision).
        if (!('vink' in view)) {
          setNotOpenYet(true);
          return;
        }
        saveGuestSession({
          publicCode: view.vink.publicCode,
          guestToken: token,
          vinkId: view.participant.vinkId,
        });
        router.replace(`/join/${view.vink.publicCode}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.status === 401
            ? 'This invite link has expired or already been used.'
            : "We couldn't open this invite. Check the link and try again.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center font-sans">
      {notOpenYet ? (
        <>
          <h1 className="font-display text-lg font-bold text-ink">Not open yet</h1>
          <p role="status" className="text-sm text-smoke">
            Check back soon.
          </p>
        </>
      ) : error === null ? (
        <p role="status" className="text-smoke">
          Opening your invite…
        </p>
      ) : (
        // text-ink, not text-danger: explanatory error copy uses primary text (D36;
        // docs/design/phase-8-visual-system-refinement.md §11).
        <p role="alert" className="text-ink">
          {error}
        </p>
      )}
    </main>
  );
}
