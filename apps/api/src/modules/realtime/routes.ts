/**
 * Realtime transport (PV8, guest support PV10): `GET /api/v1/vinks/:vinkId/live` upgrades to
 * the vink's channel. Auth via `?token=` (a WebSocket upgrade cannot carry an Authorization
 * header from a browser) — flagged: the token rides in the URL and can land in proxy/access
 * logs; accepted for the validation build's mock-money scope, revisit before real money
 * (G4-adjacent). The token is either an organizer/participant JWT or a guest `vgt_` token
 * (Plan §21/D14) — `GUEST_TOKEN_PREFIX` lets the transport tell them apart on sight, exactly
 * as the REST guest surface (`sharing/routes.ts`, `contributions/routes.ts`) already does.
 * Guests get the same event stream everyone else on the vink gets (the outbox publisher's
 * payload carries no requester-specific data) but their own `snapshot` is the guest-scoped
 * `GuestVinkView` (Plan PV4) — no card, no other participants' identities — never the
 * organizer's full `VinkSnapshot`.
 *
 * On every connection (first or reconnect) the server sends a `snapshot` message before
 * anything else — Plan §14's "fetch current session snapshot, replace local state, resume"
 * is satisfied by construction: a new socket always gets a fresh, authoritative snapshot.
 * Individual event messages are never trusted as complete truth by the client (Plan §14);
 * each still carries the vink's current state/funded/required so a client CAN act on one
 * without a round trip, but a snapshot is always one reconnect away.
 */

import type { FastifyInstance } from 'fastify';
import {
  ApplicationError,
  getGuestVinkView,
  getVinkSnapshot,
} from '../../../../../packages/application/src/index.ts';
import type { VinkId } from '../../../../../packages/domain/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { verifyAccessToken } from '../../auth/tokens.ts';
import { GUEST_TOKEN_PREFIX, hashGuestToken } from '../../auth/guest-tokens.ts';
import { PostgresVinkStore } from '../vinks/store.ts';
import type { RealtimeHub } from '../../realtime/hub.ts';

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_NOT_FOUND = 4404;

export function registerRealtimeRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  hub: RealtimeHub,
): void {
  const store = new PostgresVinkStore(sql);

  app.get('/api/v1/vinks/:vinkId/live', { websocket: true }, async (socket, request) => {
    const { vinkId } = request.params as { vinkId: string };
    const token = (request.query as { token?: string }).token;
    if (token === undefined) {
      socket.close(CLOSE_UNAUTHENTICATED, 'missing token');
      return;
    }

    let snapshot: unknown;
    if (token.startsWith(GUEST_TOKEN_PREFIX)) {
      const now = new Date();
      const resolved = await store.findGuestParticipant(hashGuestToken(token), now);
      if (resolved === null) {
        socket.close(CLOSE_UNAUTHENTICATED, 'invalid or expired guest token');
        return;
      }
      if (resolved.participant.vinkId !== vinkId) {
        socket.close(CLOSE_FORBIDDEN, 'forbidden');
        return;
      }
      snapshot = await getGuestVinkView(store, hashGuestToken(token), now);
    } else {
      const claims = await verifyAccessToken(env.JWT_SECRET, token);
      if (claims === null) {
        socket.close(CLOSE_UNAUTHENTICATED, 'invalid token');
        return;
      }
      try {
        snapshot = await getVinkSnapshot(store, vinkId as VinkId, claims.userId);
      } catch (error) {
        if (error instanceof ApplicationError && error.code === 'FORBIDDEN') {
          socket.close(CLOSE_FORBIDDEN, 'forbidden');
          return;
        }
        if (error instanceof ApplicationError && error.code === 'VINK_NOT_FOUND') {
          socket.close(CLOSE_NOT_FOUND, 'not found');
          return;
        }
        throw error;
      }
    }

    socket.send(JSON.stringify({ type: 'snapshot', vinkId, snapshot }));
    const unsubscribe = await hub.subscribe(vinkId, (message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    });
    socket.on('close', () => {
      void unsubscribe();
    });
  });
}
