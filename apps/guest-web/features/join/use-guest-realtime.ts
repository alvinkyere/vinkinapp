'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGuestSession } from '../../lib/api';
import { wsBaseUrl } from '../../lib/config';
import { isFullGuestSession } from '../../lib/guest-view-guards';
import type { GuestVinkView, GuestVinkViewResult } from '../../lib/types';

type LiveMessage = Record<string, unknown>;

const RECONNECT_DELAY_MS = 2_000;

/**
 * Connects to the same vinkId-keyed realtime channel the organizer app uses
 * (apps/api/src/modules/realtime/routes.ts, PV10 guest-token branch). The server always
 * sends a `snapshot` first (Plan §14) — every reconnect gets a fresh authoritative state,
 * never a stale one. Individual event messages carry only `state`/`fundedAmountMinor`
 * directly (apps/api/src/realtime/outbox-publisher.ts sends a lean payload by design) — that
 * patches the header immediately, then a full `GET /api/v1/guest/session` re-fetch catches
 * up fields the event doesn't carry (e.g. `participant.allocatedAmountMinor`, which changes
 * when the organizer re-splits after this guest joins). Same fix as the organizer Flutter
 * app's Lobby screen needed in PV9 for the identical reason — a lean live event must never
 * leave the rest of the view stale.
 */
export interface GuestRealtimeResult {
  view: GuestVinkView | null;
  /** Slice I3 — an explicit, immediate re-fetch, for use right after this guest's own
   * mutation (e.g. `authorizeGuestContribution`) succeeds: mirrors the exact fix pattern
   * `apps/mobile`'s organizer Lobby needed in PV9/ENG1 for the same reason — a server-truth
   * status must be read fresh after the guest's own action, not assumed from local state,
   * and not left to wait on the next WS event (which usually arrives promptly, but "usually"
   * isn't good enough for D25's "never re-offer the action" guarantee). */
  refetch: () => Promise<void>;
}

export function useGuestRealtime(
  vinkId: string | null,
  guestToken: string | null,
  initial: GuestVinkView | null,
): GuestRealtimeResult {
  const [view, setView] = useState<GuestVinkView | null>(initial);
  const guestTokenRef = useRef(guestToken);
  useEffect(() => {
    guestTokenRef.current = guestToken;
  }, [guestToken]);

  const refetch = useCallback(async () => {
    const token = guestTokenRef.current;
    if (token === null) return;
    const fresh = await getGuestSession(token);
    if (isFullGuestSession(fresh)) setView(fresh);
  }, []);

  useEffect(() => {
    if (vinkId === null || guestToken === null) return;
    const token = guestToken;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect(): void {
      socket = new WebSocket(`${wsBaseUrl()}/api/v1/vinks/${vinkId}/live?token=${token}`);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as LiveMessage;
        if (message.type === 'snapshot') {
          const snapshot = message.snapshot as GuestVinkViewResult;
          if (isFullGuestSession(snapshot)) setView(snapshot);
          return;
        }
        const state = message.state as string | undefined;
        const fundedAmountMinor = message.fundedAmountMinor as number | null | undefined;
        if (state === undefined) return;
        setView((current) =>
          current === null
            ? current
            : {
                ...current,
                vink: {
                  ...current.vink,
                  state,
                  fundedAmountMinor: fundedAmountMinor ?? current.vink.fundedAmountMinor,
                },
              },
        );
        getGuestSession(token)
          .then((fresh) => {
            if (!disposed && isFullGuestSession(fresh)) setView(fresh);
          })
          .catch(() => {
            // The next live message (or a reconnect) will trigger another attempt; the
            // lightweight patch above already keeps the header current in the meantime.
          });
      });
      socket.addEventListener('close', () => {
        if (!disposed) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [vinkId, guestToken]);

  return { view, refetch };
}
