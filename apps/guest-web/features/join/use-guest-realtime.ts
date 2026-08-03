'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGuestSession } from '../../lib/api';
import { wsBaseUrl } from '../../lib/config';
import { isFullGuestSession } from '../../lib/guest-view-guards';
import type { GuestVinkView, GuestVinkViewResult } from '../../lib/types';

type LiveMessage = Record<string, unknown>;

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
/** ENG3: a flat retry delay produces a reconnect storm if the server (or a shared proxy) is
 * struggling — exponential backoff with jitter spreads reconnect attempts out instead of
 * everyone retrying in lockstep every 2s. `random` is injectable (defaults to `Math.random`)
 * so `reconnectDelayMs.test.ts` can assert exact values instead of only a loose range —
 * mirrors `apps/mobile`'s equivalent `reconnectDelay(attempt, {random})` in
 * `realtime_client.dart`. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** attempt);
  const jitter = exponential * (0.8 + random() * 0.4); // ±20%
  return Math.round(jitter);
}

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

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
 *
 * ENG3: reconnect uses exponential backoff+jitter (not a flat delay), an application-level
 * ping/pong heartbeat detects a connection that looks open but has gone silently dead, and a
 * `visibilitychange` listener reconnects immediately (bypassing the backoff wait) and
 * refreshes state the moment a backgrounded mobile tab becomes visible again — mirroring
 * `apps/mobile`'s equivalent `AppLifecycleState` handling in `realtime_client.dart`.
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

  // ENG3: multiple triggers can each start a `getGuestSession` fetch in quick succession — a
  // live message, the explicit `refetch()` call after this guest's own mutation, and a
  // visibility-change-triggered refresh can all overlap. Overlapping fetches can resolve out
  // of order; without a guard, a slower, older response can overwrite a faster, newer one and
  // leave the screen showing stale data (the exact bug class `vink_lobby_screen.dart`'s
  // `_snapshotRequestId` already guards against on the organizer side — this is that same
  // fix, applied here for the first time). Only the result of the most recently *issued*
  // fetch is ever applied.
  const requestSeqRef = useRef(0);

  const applyFreshSession = useCallback(async (token: string) => {
    const requestId = ++requestSeqRef.current;
    const fresh = await getGuestSession(token);
    if (requestId !== requestSeqRef.current) return; // superseded by a newer request
    if (isFullGuestSession(fresh)) setView(fresh);
  }, []);

  const refetch = useCallback(async () => {
    const token = guestTokenRef.current;
    if (token === null) return;
    await applyFreshSession(token);
  }, [applyFreshSession]);

  useEffect(() => {
    if (vinkId === null || guestToken === null) return;
    const token = guestToken;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    function clearHeartbeat(): void {
      if (heartbeatInterval !== null) clearInterval(heartbeatInterval);
      if (heartbeatTimeout !== null) clearTimeout(heartbeatTimeout);
      heartbeatInterval = null;
      heartbeatTimeout = null;
    }

    function startHeartbeat(current: WebSocket): void {
      clearHeartbeat();
      heartbeatInterval = setInterval(() => {
        if (current.readyState !== WebSocket.OPEN) return;
        current.send(JSON.stringify({ type: 'ping' }));
        heartbeatTimeout = setTimeout(() => {
          // No pong within the timeout — the connection looks open but is not answering.
          // Force-close so the existing `close` handler reconnects through the normal
          // backoff path, rather than silently sitting on a dead socket.
          current.close();
        }, HEARTBEAT_TIMEOUT_MS);
      }, HEARTBEAT_INTERVAL_MS);
    }

    function scheduleReconnect(): void {
      if (disposed) return;
      clearHeartbeat();
      reconnectTimer = setTimeout(connect, reconnectDelayMs(attempt));
      attempt += 1;
    }

    function connect(): void {
      socket = new WebSocket(`${wsBaseUrl()}/api/v1/vinks/${vinkId}/live?token=${token}`);
      socket.addEventListener('open', () => {
        attempt = 0; // a successful connection resets the backoff
        if (socket !== null) startHeartbeat(socket);
      });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as LiveMessage;
        if (message.type === 'pong') {
          if (heartbeatTimeout !== null) clearTimeout(heartbeatTimeout);
          heartbeatTimeout = null;
          return;
        }
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
        applyFreshSession(token).catch(() => {
          // The next live message (or a reconnect) will trigger another attempt; the
          // lightweight patch above already keeps the header current in the meantime.
        });
      });
      socket.addEventListener('close', () => {
        clearHeartbeat();
        if (!disposed) scheduleReconnect();
      });
    }

    // ENG3: a backgrounded mobile tab is frequently network-throttled or has its socket
    // closed outright by the OS/browser without a clean `close` event ever firing — waiting
    // out the normal backoff on return would leave a returning guest looking at stale data
    // for several seconds. Reconnecting immediately (bypassing the backoff wait) and
    // refreshing state the instant the tab becomes visible again fixes both at once.
    function handleVisibilityChange(): void {
      if (document.visibilityState !== 'visible' || disposed) return;
      if (socket === null || socket.readyState === WebSocket.CLOSED) {
        if (reconnectTimer !== null) clearTimeout(reconnectTimer);
        connect();
      }
      applyFreshSession(token).catch(() => {
        // A live message or the next visibility change will retry; nothing to recover here.
      });
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    connect();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      clearHeartbeat();
      socket?.close();
    };
  }, [vinkId, guestToken, applyFreshSession]);

  return { view, refetch };
}
