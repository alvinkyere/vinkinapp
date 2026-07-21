# Milestone Report — ENG1 Slice 2 (Idempotent Vink Creation)

Date: 2026-07-20 · Track: engineering (owner-supplied ENG0–ENG15 plan, 2026-07-20) ·
Scope: idempotent Vink creation and duplicate-submission protection **only**, per the
owner's own slice brief — no setup recovery, timer changes, merchant-payment changes,
authentication, deployment, or UX redesign.

## What was implemented

A client-generated idempotency key, stable across retries of the same create attempt, lets
a lost-response retry return the original Vink instead of creating a duplicate — the
required scenario ("server commits → response lost → client retries with same key → same
Vink returned → only one Vink exists"). PostgreSQL uniqueness is the final guard (hard
rule); the application layer's own pre-check is only an optimization ahead of it.

- **`packages/domain`**: `Vink.creationIdempotencyKey: string` — same precedent as
  `Contribution.idempotencyKey` already on the entity.
- **`packages/application`**:
  - `CreateVinkInput.creationIdempotencyKey?: string` — **optional**, deliberately: existing
    internal callers (10 test-suite call sites across `contributions/purchases/recovery/
    guest/refunds.test.ts`) don't need to change. Omitting it just forgoes replay
    protection — `createVinkCommand` fills in a fresh `randomUUID()` that can never collide,
    identical to the pre-slice behavior.
  - `createVinkCommand`: pre-checks `findVinkByCreationIdempotencyKey(organizer, key)`
    inside the transaction before inserting; a hit replays that Vink + its participants, no
    new insert, no duplicate `VinkCreated` event. On a genuine race (two concurrent requests
    both miss the pre-check, then the DB's unique index rejects the loser's `INSERT`), the
    adapter throws `CreationIdempotencyRaceError`; the command catches it and replays the
    now-committed winner in a fresh read, rather than surfacing an error.
  - New port method `VinkTx.findVinkByCreationIdempotencyKey`; new error type
    `CreationIdempotencyRaceError` (internal signal, never reaches a transport).
  - `InMemoryVinkStore` mirrors the same duplicate-key guard for unit tests.
- **`apps/api`**:
  - Migration `0009_vink_creation_idempotency.sql`: `vinks.creation_idempotency_key TEXT NOT
    NULL` (added nullable, backfilled existing rows with `gen_random_uuid()`, then
    tightened) + `UNIQUE (organizer_user_id, creation_idempotency_key)` index — the actual
    guard.
  - `PostgresVinkTx.insertVink` catches SQLSTATE `23505` on that specific constraint name
    and translates it to `CreationIdempotencyRaceError`; any other unique violation still
    propagates untouched.
  - `createSchema` (`POST /api/v1/vinks`) accepts optional `creationIdempotencyKey` (1–200
    chars).
- **`apps/mobile`**: `core/networking/idempotency_key.dart` — a 128-bit
  `Random.secure()` key, no new pub dependency (a `uuid` package wasn't worth adding for
  one string). `create_vink_screen.dart` generates one key lazily on the first submit
  attempt and reuses it across retries of that same attempt (a fresh screen instance —
  genuinely starting over — gets a fresh key). The existing `_busy`-gated
  `VinkPrimaryButton` already disables the button while a request is in flight (verified:
  `loading: true` maps to `onTap: null`) — that first layer was already correct; this slice
  adds the second layer the spec calls out explicitly ("idempotency belongs on the server").

## Files changed

New: `apps/api/src/db/migrations/0009_vink_creation_idempotency.sql`,
`apps/mobile/lib/core/networking/idempotency_key.dart`, this report.
Modified: `packages/domain/src/entities.ts`, `packages/application/src/{errors,ports,
commands,commands.test}.ts`, `packages/application/src/testing/in-memory.ts`,
`apps/api/src/modules/vinks/{store,routes}.ts`, `apps/api/src/vinks.integration.test.ts`,
`apps/mobile/lib/features/create_vink/create_vink_screen.dart`.

## Database changes

Migration 0009 (above) — the one existing dev-DB Vink row was backfilled automatically, no
manual intervention needed.

## Tests added

6 new (4 unit + 2 integration; repo totals: **197 Node/TS tests** (up from 191) + **23
Flutter tests**, all green):

- Unit (`commands.test.ts`, in-memory): same key replays the same Vink with no second
  `VinkCreated` event; a different key (or a different organizer reusing the same key) is a
  genuinely new Vink; omitting the key never collides across separate calls; a forced
  race-loss at the store (pre-check misses, `insertVink` throws
  `CreationIdempotencyRaceError`) replays the winner instead of erroring — this test
  deliberately simulates READ COMMITTED semantics (the pre-check "misses" the not-yet-
  visible concurrent commit) rather than relying on JS's single-threaded execution to
  produce a real race, which it can't.
- Integration (`vinks.integration.test.ts`, real PostgreSQL): the literal required scenario
  (create → retry with the same key → same Vink, `GET /vinks` shows exactly one match) plus
  a **genuinely concurrent** `Promise.all` double-`POST /vinks` with the same key — this one
  exercises the real database unique constraint, not a simulation, and both requests
  resolve to the same Vink id with exactly one row ever existing.
- Real-app verification: `apps/mobile/integration_test/e1_test.dart` (the project's existing
  full golden-path proof) re-run against a freshly restarted real local API server — real
  touch injection on a booted iOS Simulator, no mocks. Passed in 23s. Spot-checked the
  database directly afterward: the row it created carries a 32-char hex key (the Flutter
  helper's format, not a UUID), confirming the client-generated key actually made the
  round trip, not just a server-side default.

## A defect this slice caught (in the surrounding environment, not the new code)

Restarting the verification suite after applying migration 0009 broke `guest-web`'s and
`operations-console`'s Playwright suites — `POST /api/v1/vinks` started returning nothing
usable. Root cause: a **stale `node src/server.ts` process from earlier in this session**
was still listening on port 3000, running pre-migration code that doesn't know about the new
`NOT NULL` column — every insert it attempted violated the new constraint. Not a bug in this
slice's code; killing the stale process and restarting with current code fixed it
immediately, and it's a reminder that this environment has no process supervisor — a
migration and a running server can silently drift apart within a single session.

## Known limitations

1. Duplicate-tap suppression via this slice covers **Vink creation only** — the owner's own
   ENG1 ordering defers "all mutating commands" (add participant, split, open, contribute,
   etc.) to Slice 4, after retry classification exists to decide *which* failures are safe
   to protect this way.
2. No idempotency-key TTL/cleanup — keys live as long as their Vink row does, which is fine
   at this scale and matches how `Contribution.idempotencyKey` already behaves.
3. A replayed create currently always returns HTTP 201, even on the second (replay) call —
   deliberate: the response body is identical either way, and some idempotency-key
   conventions (Stripe included) do the same rather than distinguishing 200-on-replay vs.
   201-on-first. Flagged in case it turns out to matter for API contract work in ENG2.

## Next milestone

Per the owner's stated order: **ENG1 Slice 3 — interrupted setup recovery** (unsaved local
setup vs. server-persisted setup vs. opened/expired/completed Vink; resume vs. discard),
which explicitly depends on this slice's creation semantics being trustworthy first.
