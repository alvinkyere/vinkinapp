# Milestone Report — PV8.5 (Production-Shaped Infrastructure Hardening)

Date: 2026-07-18 · Track: product validation (D10) · Owner-directed: "settle both [D10-flagged
infrastructure gaps] now... a formal milestone... to remove architectural debt that will
become significantly more expensive once Flutter depends on the current behavior." Not a
product-feature milestone — no PV-numbered scope from the master plan; §45 report format
retained for consistency with every other milestone in this repo.

## Scope decision, made explicit before any code changed

Two items were flagged across PV5–PV8: provider calls running inside the PostgreSQL
transaction, and single-process realtime fanout. They are **not the same kind of debt** and
were deliberately treated differently:

- **Realtime fanout** is infrastructure with no product-shape ambiguity — implementing
  Redis-backed pub/sub is safe, well-understood, and doesn't depend on anything unconfirmed.
  **Fully hardened this milestone** (below).
- **Provider-calls-in-transaction** is coupled to *which* provider gets chosen — a correct
  two-phase (reserve → external call outside any transaction → record result) redesign's
  shape depends on that provider's own idempotency/webhook semantics (Stripe's differ from
  Lithic's), which are unconfirmed while the M0 gate is open. The gate's own rule —
  "anything whose shape would change if condition 1 or 2 came back 'no' is forbidden until
  those conditions are met" — applies directly. Rewriting three financial engines (PV5–PV7,
  ~110 tests) to a speculative pattern risked guessing a design the real adapter would
  discard. **Settled via a formal, ratified decision-log entry (D15)** instead of a
  rewrite — an explicit, owner-visible scoping decision with a named revisit trigger
  (M0 gate closure), not silently-carried debt. Flagged here in case the owner wants the
  speculative rewrite attempted anyway.

## What was implemented

**D16 — Redis-backed realtime fanout:**
- `apps/api/src/realtime/hub.ts`: `RealtimeHub` extracted as an interface (`subscribe`,
  `publish`, `subscriberCount`); the PV8 concrete class renamed `InProcessRealtimeHub`
  (kept for infrastructure-free unit tests).
- `apps/api/src/realtime/redis-hub.ts` (new): `RedisRealtimeHub` — one ioredis connection
  for PUBLISH, one dedicated to SUBSCRIBE (ioredis locks a connection into subscriber-only
  mode on first `.subscribe()` call), local listeners reference-counted per vink so N
  WebSocket clients on the same vink cost exactly one Redis channel subscription.
- `server.ts` now constructs `RedisRealtimeHub` with two real Redis connections (both
  added to the shutdown sequence) instead of the single-process hub.
- **Outbox publisher hardened alongside it**: `SELECT … FOR UPDATE SKIP LOCKED` lets any
  number of API instances poll concurrently without double-claiming rows — a locked row is
  skipped, not blocked on. Publish-then-commit ordering preserved deliberately: a crash
  between publish and commit causes a harmless duplicate re-delivery on the next poll
  (Plan §12 at-least-once), never a silent loss (which committing first, then crashing
  before publish, would cause).

**D15 — provider-in-transaction pattern ratified, not rewritten:** module-header comments
in `contributions.ts`, `purchases.ts`, `recovery.ts`, `refunds.ts` updated from a vague
"flagged" note to point at the formal decision-log entry.

## Files changed

New: `apps/api/src/realtime/redis-hub.ts` + `redis-hub.integration.test.ts`,
`apps/api/src/realtime/outbox-publisher.integration.test.ts`, this report.
Modified: `apps/api/src/realtime/{hub,outbox-publisher}.ts` + `hub.test.ts`,
`apps/api/src/{app,server}.ts`, `apps/api/src/modules/realtime/routes.ts`,
`apps/api/src/realtime.integration.test.ts` (upgraded to exercise the real
`RedisRealtimeHub` configuration, not a test-only substitute),
`packages/application/src/{contributions,purchases,recovery,refunds}.ts` (comment-only),
`docs/spec/decision-log.md` (D15, D16), status docs.

## Database changes

None.

## APIs added

None (infrastructure only; `GET /api/v1/vinks/:vinkId/live` is unchanged from PV8).

## UI added

None.

## Tests added

12 new (2 hub unit rewritten for the interface + 6 new integration; totals: **146 unit +
55 integration**, all green vs real local PostgreSQL 16 **and real local Redis** — both
installed via Homebrew on this machine, no Docker):
- `redis-hub.integration.test.ts` — **the actual proof D16 exists for**: a message
  published on one `RedisRealtimeHub` instance reaches a listener subscribed through a
  *different* instance (two independent pub/sub connection pairs against the same Redis,
  standing in for two API processes) — something `InProcessRealtimeHub` structurally
  cannot do. Also: no cross-talk to an unsubscribed vink; unsubscribing the last local
  listener genuinely stops Redis delivery (not just local bookkeeping); reference-counting
  leaves delivery intact when one of two local listeners unsubscribes.
- `outbox-publisher.integration.test.ts` — **the actual proof `FOR UPDATE SKIP LOCKED`
  works**: 50 outbox rows, two concurrent `runOutboxPublish` calls (standing in for two API
  instances polling at once) — asserts every row is claimed and published exactly once
  combined (no duplicates, no gaps), and idempotent re-running publishes nothing further.
- `realtime.integration.test.ts` (PV8's exit-gate test) now runs against the real
  `RedisRealtimeHub` server configuration instead of a test substitute — the existing
  two-client/reconnection/auth assertions all still pass unchanged, now proving the
  production-shaped path.

## Known limitations

1. `subscriberCount` remains local-instance-only by design (documented in the interface) —
   there's no cluster-wide subscriber count; nothing in the codebase needs one.
2. The outbox poll interval is still a poll, not push (LISTEN/NOTIFY) — D16 considered and
   deferred this; the interval + `SKIP LOCKED` combination is correct and fast enough for
   the validation build's scale.
3. D15's scope decision means the ~110 PV5–PV7 tests keep testing the current (correct,
   for a mock) provider-in-transaction pattern; whoever picks up the real-adapter work
   inherits a clean, well-flagged starting point rather than a half-migrated one.

## Security review

- No new attack surface: the realtime channel's auth/ownership model is unchanged from
  PV8; this milestone only changed how messages get from the database to the channel.
- Redis connections carry no secrets beyond what `REDIS_URL` already implies (no new
  credentials introduced).
- The `FOR UPDATE SKIP LOCKED` change strictly narrows behavior (prevents duplicate
  claiming) — no new race was introduced by hardening an existing one.

## Next milestone

**PV9 — Organizer Mobile Application (Flutter)**, now on a settled foundation: both
standing D10 flags are resolved (one fixed, one formally scoped) before client code starts
depending on either's exact behavior. Owner actions unchanged: push (CI — already runs
both PG and Redis service containers, confirmed compatible with everything in this
milestone), Docker Desktop, Flutter SDK for PV9.
