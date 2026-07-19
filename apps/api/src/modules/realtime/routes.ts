/**
 * Realtime transport (PV8): `GET /api/v1/vinks/:vinkId/live` upgrades to the vink's
 * channel. Auth via `?token=` (a WebSocket upgrade cannot carry an Authorization header from
 * a browser) — flagged: the JWT rides in the URL and can land in proxy/access logs; accepted
 * for the validation build's mock-money scope, revisit before real money (G4-adjacent).
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
  getVinkSnapshot,
} from '../../../../../packages/application/src/index.ts';
import type { VinkId } from '../../../../../packages/domain/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { verifyAccessToken } from '../../auth/tokens.ts';
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
    const claims = await verifyAccessToken(env.JWT_SECRET, token);
    if (claims === null) {
      socket.close(CLOSE_UNAUTHENTICATED, 'invalid token');
      return;
    }

    let snapshot;
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

    socket.send(JSON.stringify({ type: 'snapshot', vinkId, snapshot }));
    const unsubscribe = await hub.subscribe(vinkId, (message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    });
    socket.on('close', () => {
      void unsubscribe();
    });
  });
}
