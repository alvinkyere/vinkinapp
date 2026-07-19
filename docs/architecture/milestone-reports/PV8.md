# Milestone Report — PV8 (Real-Time Experience)

Date: 2026-07-18 · Track: product validation (D10) · §45 report format.

## What was implemented

- **`apps/api/src/realtime/hub.ts`**: in-process pub/sub keyed by `vinkId`
  (`subscribe`/`publish`/`subscriberCount`), deliberately shaped like a Redis pub/sub
  client so a real deployment's fanout swap is mechanical (flagged, same shape as D10's
  provider-calls-in-transaction flag).
- **`apps/api/src/realtime/message-mapping.ts`**: `DomainEventName → ClientMessageType`
  as a `Record`, which makes the mapping exhaustive at compile time — a new domain event
  without a mapping is a type error, not a silent gap. Plan §14 names 15 client message
  types; several domain events (card/merchant/recovery/refund internals) have no listed
  counterpart, so they map to an additive `vink_state_changed` fallback carrying the
  original event type — flagged, not silently invented.
- **`apps/api/src/realtime/outbox-publisher.ts`**: the **first real consumer of
  `outbox_events.published_at`**, which every PV3–PV7 command has been writing since PV3.
  Polls unpublished rows in `seq` order, fetches each vink's current state/funded/required,
  publishes a self-contained message to the hub, marks `published_at`. Runs as a tight
  interval poll (not BullMQ) — realtime wants sub-second latency and there's no
  PostgreSQL-owned "truth" to defer to the way deadline sweeps have; a real deployment
  would swap this for LISTEN/NOTIFY or Redis fanout.
- **`apps/api/src/modules/realtime/routes.ts`**: `GET /api/v1/vinks/:vinkId/live`
  upgrades to the channel. Auth via `?token=` (a browser WebSocket upgrade cannot carry an
  Authorization header) — flagged: the JWT rides in the URL, acceptable for the
  validation build's mock-money scope. **Every connection — first or reconnect — gets a
  fresh `snapshot` message before anything else**, which satisfies Plan §14's reconnection
  rule ("fetch snapshot, replace, resume") by construction: there is no separate
  reconnection code path to get wrong. Distinct WebSocket close codes for unauthenticated
  (4401), forbidden (4403), and unknown-vink (4404).
- Wired into `apps/api/src/app.ts` (`@fastify/websocket` plugin) and `server.ts` (shared
  `RealtimeHub` passed to both the app and `startOutboxPublisher`, stopped on shutdown).

## Integration defect found and fixed (root-caused via direct reproduction, not guessed)

`buildApp` registered `@fastify/websocket` with a bare `app.register(...)` and continued
synchronously registering routes — the same pattern every other plugin/route registration
in the file already used. But `@fastify/websocket` wraps `{websocket: true}` route handlers
via an `onRoute` hook it adds **inside its own deferred (avvio-queued) plugin body**.
Registering it without awaiting races that hook: the realtime route, added synchronously
right after, was never wrapped, so its `(socket, request)` handler was invoked as a plain
Fastify `(request, reply)` handler instead — `socket` silently became `request`, `request`
became `reply`, and destructuring `request.params` crashed on the actual `reply` object.
Every WebSocket connection failed at the client with a generic "connection failed" error
that gave no hint of the cause; a minimal standalone reproduction script (bypassing the
test framework) surfaced the real server-side stack trace and the exact bug. Fix:
`buildApp` is now `async` and `await`s the websocket plugin registration before any route
registers; all nine existing `buildApp(...)` call sites (server.ts + eight test files)
updated to `await` it, with `ReturnType<typeof buildApp>` type declarations updated to
`Awaited<ReturnType<typeof buildApp>>`.

## Files changed

New: `apps/api/src/realtime/{hub,message-mapping,outbox-publisher}.ts` + their `.test.ts`,
`apps/api/src/modules/realtime/routes.ts`, `apps/api/src/realtime.integration.test.ts`,
this report. Modified: `apps/api/src/app.ts` (async + websocket plugin + route wiring),
`apps/api/src/server.ts` (hub + publisher lifecycle), `apps/api/package.json`
(`@fastify/websocket`), eight test files (`await buildApp`, `Awaited<...>` types), docs
statuses.

## Database changes

None (the outbox/`published_at` column has existed since migration 0002).

## APIs added

`GET /api/v1/vinks/:vinkId/live` (WebSocket upgrade, `?token=` auth).

## UI added

None (PV9–PV11 are the clients).

## Tests added

23 new (2 hub + 2 mapping unit + 3 integration + fixtures; totals: **146 unit + 49
integration**, all green vs real local PostgreSQL 16 with a real listening HTTP server —
WebSocket upgrades cannot go through Fastify's `.inject()`):
- Unit: hub delivers only to the right channel's subscribers and cleans up on unsubscribe;
  publishing to an empty channel is a no-op; every domain event resolves to a non-empty
  message type; the Plan §14-named events map to their exact wire vocabulary; unlisted
  events use the flagged fallback.
- Integration (**PV8 exit gate — "multiple clients observe the same authoritative Vink
  state without manual refresh"**): two live clients on one vink receive byte-identical
  `snapshot`, `funding_progress_updated`, `VinkOpened`, and `vink_funded` messages as a
  real funding journey runs via REST — proving both see the same state, live, unprompted.
  Reconnection: a client disconnects, state changes via REST while it's gone, a fresh
  connection's snapshot reflects the change (never the stale value) — no separate
  "catch-up" logic exists to fail. Auth: missing/wrong-owner/unknown-vink connections close
  with 4401/4403/4404 respectively.

## Known limitations

1. Single-process pub/sub — the hub has no fanout across instances; horizontal scale needs
   the Redis swap already flagged in the code (matches D10's revisit pattern).
2. The outbox poll interval (250ms in production, 30ms in tests) is a latency/DB-load
   tradeoff; LISTEN/NOTIFY would remove the poll entirely — deferred, not required for the
   PV8 exit gate.
3. Guest realtime (guest-token auth on the live channel) is not built — PV8's scope per the
   master plan is the organizer channel; guest web is PV10.
4. The `vink_state_changed` fallback carries the raw event type but no Plan §14-named
   semantic; a future revision could extend the vocabulary explicitly instead (flagged for
   a future decision-log entry if the fallback proves too coarse for PV9's UI).
5. No message-level auth beyond channel ownership — a subscriber to `vink:{id}` sees every
   event for that vink; fine for the organizer-only PV8 scope, revisit for guest/participant
   channels.

## Security review

- Channel access requires a valid organizer JWT and ownership of the specific vink,
  checked via the same `getVinkSnapshot` path REST uses — no parallel authorization logic
  to drift out of sync.
- The query-string token is the one deliberate compromise in this milestone, explicitly
  flagged rather than silently accepted; short-lived access tokens (15 min, from PV1) limit
  the exposure window.
- No write path exists on the realtime channel — it is read-only by construction, so it
  cannot become a new place to violate D13.
- Close codes are distinct and specific (never a generic 1000/1006), so a client can tell
  "you're not allowed" from "this doesn't exist" from "try again."

## Next milestone

**PV9 — Organizer Mobile Application** (Flutter): the first client consumer of everything
built PV1–PV8 — REST + this realtime channel — for the full E1 organizer journey, with the
mock card display clearly labeled as simulation. This is also a natural checkpoint to revisit
the outstanding D10-flagged items (provider-calls-in-transaction, single-process realtime
fanout) before client work multiplies the surface area depending on them. Owner actions
unchanged: push (CI), Docker Desktop (still not required for anything built so far, but
needed once a real multi-instance concern arises), Flutter SDK for PV9.
