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
 * Slice I2C: a JWT that isn't the organizer's now falls back to `getParticipantVinkView`
 * (Slice I2B's own customer-safe read, already used by `GET /vinks/:vinkId/participant-view`)
 * instead of an unconditional 403 — gated on the same `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`
 * flag that route already requires, so a flag-off deployment is byte-identical to pre-I2C. No
 * wire-envelope discriminator exists or is needed: the client already knows statically, from
 * which URL/role it navigated with, which shape (`VinkSnapshot` vs `ParticipantVinkView`) to
 * expect on its own connection — exactly like the guest branch above already relies on the
 * client knowing it used a `vgt_` token.
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
  getParticipantVinkView,
  getVinkSnapshot,
} from '../../../../../packages/application/src/index.ts';
import type { VinkId } from '../../../../../packages/domain/src/index.ts';
import type { Env } from '../../config/env.ts';
import type { Sql } from '../../db/client.ts';
import { verifyAccessToken } from '../../auth/tokens.ts';
import { GUEST_TOKEN_PREFIX, hashGuestToken } from '../../auth/guest-tokens.ts';
import { vinkIdParams } from '../../middleware/params.ts';
import { PostgresVinkStore } from '../vinks/store.ts';
import type { RealtimeHub } from '../../realtime/hub.ts';

const CLOSE_BAD_REQUEST = 4400;
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
    // A WS upgrade has no HTTP response to send a 400 on, so this route can't defer to
    // app.ts's ZodError handler the way plain HTTP routes do — it validates with safeParse
    // and closes the socket itself, same as every other rejection path below.
    const paramsResult = vinkIdParams.safeParse(request.params);
    if (!paramsResult.success) {
      socket.close(CLOSE_BAD_REQUEST, 'malformed vinkId');
      return;
    }
    const { vinkId } = paramsResult.data;
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
          // Slice I2C: not the organizer — fall back to the participant-scoped read, same as
          // the REST `/participant-view` route, before giving up and closing forbidden.
          if (env.VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL === '1') {
            try {
              snapshot = await getParticipantVinkView(
                store,
                vinkId as VinkId,
                claims.userId,
                new Date(),
              );
            } catch (participantError) {
              if (
                participantError instanceof ApplicationError &&
                participantError.code === 'FORBIDDEN'
              ) {
                socket.close(CLOSE_FORBIDDEN, 'forbidden');
                return;
              }
              if (
                participantError instanceof ApplicationError &&
                participantError.code === 'VINK_NOT_FOUND'
              ) {
                socket.close(CLOSE_NOT_FOUND, 'not found');
                return;
              }
              throw participantError;
            }
          } else {
            socket.close(CLOSE_FORBIDDEN, 'forbidden');
            return;
          }
        } else if (error instanceof ApplicationError && error.code === 'VINK_NOT_FOUND') {
          socket.close(CLOSE_NOT_FOUND, 'not found');
          return;
        } else {
          throw error;
        }
      }
    }

    socket.send(JSON.stringify({ type: 'snapshot', vinkId, snapshot }));
    const unsubscribe = await hub.subscribe(vinkId, (message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    });
    // ENG3 heartbeat: browsers don't expose the WebSocket protocol's own ping/pong control
    // frames to application code, so liveness is checked at the application layer instead —
    // a client sends `{type:'ping'}` on its own interval and expects this `{type:'pong'}`
    // right back. A connection that looks open but is actually dead (a silently dropped
    // mobile network path, a stalled proxy) never replies, and the client's own timeout is
    // what notices and reconnects — this route only needs to answer, never initiate.
    socket.on('message', (raw: unknown) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { type?: unknown }).type === 'ping' &&
        socket.readyState === socket.OPEN
      ) {
        socket.send(JSON.stringify({ type: 'pong' }));
      }
    });
    socket.on('close', () => {
      void unsubscribe();
    });
  });
}
