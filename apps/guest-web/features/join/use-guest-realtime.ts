'use client';

import { useEffect, useState } from 'react';
import { getGuestSession } from '../../lib/api';
import { wsBaseUrl } from '../../lib/config';
import type { GuestVinkView } from '../../lib/types';

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
export function useGuestRealtime(
  vinkId: string | null,
  guestToken: string | null,
  initial: GuestVinkView | null,
): GuestVinkView | null {
  const [view, setView] = useState<GuestVinkView | null>(initial);

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
          setView(message.snapshot as GuestVinkView);
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
            if (!disposed) setView(fresh);
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

  return view;
}
