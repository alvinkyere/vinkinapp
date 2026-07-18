# Milestone Report — PV3 (Organizer API + Application Command Layer)

Date: 2026-07-17 (revised 2026-07-18 after first-CI defect resolution) · Track: product
validation (D10) · Owner-approved continuation after PV1. §45 report format.

## Post-CI defect resolution (2026-07-18)

The first CI run failed two integration journeys. Both were reproduced locally against a
real PostgreSQL 16 (throwaway instance; see "Local verification setup" below), root-caused,
fixed, and re-verified: **24/24 API tests green against real PostgreSQL**, including two new
closure-evidence tests. Neither failure was a test-isolation or concurrency artifact — both
reproduced identically on a clean, single-suite database.

**Defect #1 — auth: reuse-detection revocation rolled back by its own error.**
`refreshSession` detected reuse of a rotated token, issued the family-wide
`UPDATE … SET revoked_at`, then threw `AuthError` **inside `sql.begin`** — postgres.js
rolled the transaction back, undoing the revocation. The endpoint still returned 401 for
the replayed token, but the rotated successor token stayed alive (test expected 401 for it,
got 200). Exactly the owner's hypothesized pattern 6. *Fix:* the transaction now returns a
discriminated outcome (`ROTATED | REUSE_DETECTED | INVALID`) instead of throwing; on
`REUSE_DETECTED` the family revocation commits in its own statement after the transaction,
before the 401 is raised. *Regression evidence:* the test now also asserts directly in the
database that zero live sessions remain for the user after the reuse response. Logout
contract confirmed as **idempotent 204** (owner's recommendation; already implemented).

**Defect #2 — vinks: outbox payload stored as a jsonb string scalar.**
`insertOutbox` passed `JSON.stringify(payload)` as a parameter to a `::jsonb` target;
postgres.js serialized the JS string as a jsonb **string scalar** (`"{\"vinkId\":…}"`), not
an object. The activity query's `jsonb_build_object('eventType', …) || payload` then became
jsonb **array concatenation** (`[{eventType…}, "…"]`), so `detail.eventType` was undefined
for every event row — the journey's event-list assertion failed. *Fix:* `sql.json(payload)`
stores a real jsonb object; a new `CHECK (jsonb_typeof(payload) = 'object')` on
`outbox_events` makes the bug class unrepresentable at the schema level.

**Hardening landed with the fixes (owner's required list):**
- *Deterministic activity ordering:* `seq BIGSERIAL` added to `vink_state_history` and
  `outbox_events`; activity orders by `(at, kind, seq)` — timestamps alone cannot break
  ties because rows written in one transaction share `now()`.
- *Test isolation:* each integration suite now runs in its **own PostgreSQL schema**
  (`createIsolatedTestDb`) with a full migration run, dropped `CASCADE` afterwards —
  concurrent suites cannot interfere, cleanup needs no FK ordering (the previous
  `DELETE FROM users` cleanup would have violated the `vinks.organizer_user_id` FK), and
  per-test truncation is unnecessary.
- *Migration runner:* single transaction guarded by `pg_advisory_xact_lock` — concurrent
  runners serialize instead of racing on `CREATE TABLE`/`schema_migrations` inserts; the
  "already exists, skipping" NOTICE noise is gone (idempotent-DDL notices silenced in the
  client; zero NOTICE lines in the final run log).
- *Closure evidence tests:* (a) five concurrent `POST …/open` requests yield exactly one
  200 and four 409s, with exactly one `VinkOpened` outbox event and one history row —
  row-lock serialization proven; (b) a unit of work that writes aggregate + history +
  outbox and then throws leaves version unchanged and zero rows — D12 atomicity proven.

**Status:** local real-infrastructure verification PASSING (24/24). Full-CI green requires
the owner's push; no further code change is anticipated for it.

**Local verification setup** (this machine, no Docker): PostgreSQL 16 via
`brew install postgresql@16`; throwaway cluster in the session scratchpad on port 55432
(`initdb -U vinkin --auth=trust` + `pg_ctl … -o "-p 55432 -c unix_socket_directories=''"`).
Run: `VINKIN_ENV=test VINKIN_INTEGRATION=1 DATABASE_URL=postgres://vinkin@localhost:55432/vinkin
node --test --test-force-exit "src/**/*.test.ts"` in `apps/api`. Stop with
`pg_ctl -D <scratchpad>/pg/data stop`.

## What was implemented

- **`packages/application`** — the D13 command layer, zero-dependency (persistence is a
  port; the domain is imported relatively like every other package):
  - Ports: `UnitOfWork`/`VinkTx` (atomic writes: aggregate + history + outbox in ONE `run`),
    `VinkReader` (read side), `Clock`, `CommandContext` (actor + correlation id).
  - `applyVinkTransition` — **the single write path for state changes**: domain returns
    `{to, emits}` (D12), then the aggregate update, `vink_state_history` row, and outbox
    event are written together. Nothing else may touch `vink.state`.
  - Commands (each: validate → load row-locked → decide → persist/emit → return):
    `createVink` (policy check, public code, deadlines, organizer participant, VinkCreated),
    `configureVink` (DRAFT-only, recomputes required/maximum), `addParticipant` (registered
    users; ParticipantJoined), `removeParticipant` (organizer-protected, zeroes allocation,
    ParticipantRemoved), `setSplit` (split engine over active participants in join order,
    sets each participant's §4.7 approval cap, ParticipantAllocationChanged), `openVink`
    (requires ≥1 member and full allocation), `cancelVink` (machine-enforced legality),
    `coverRemaining` (organizer absorbs the unallocated remainder — journey E3's PV3 form).
  - Queries: `getVinkSnapshot` with **server-computed `allowedActions`** (master plan §19 —
    clients never re-derive state logic) + unallocated remainder; `getVinkActivity`
    (history + outbox merged). Organizer-only until PV4 tokens.
  - Typed `ApplicationError` (`VINK_NOT_FOUND`, `FORBIDDEN`, `VINK_VERSION_CONFLICT`, …);
    optimistic `expectedVersion` support on every mutating command (Plan §11).
  - `InMemoryVinkStore` test double (exported for future simulators).
- **`apps/api`** — transport + persistence adapter:
  - `PostgresVinkStore`: one `sql.begin` per unit of work, `SELECT … FOR UPDATE` on the
    vink row, snake_case↔domain mapping with safe-integer enforcement on BIGINT amounts,
    activity as a history∪outbox UNION ordered by time.
  - Migration `0002_vink_domain.sql`: guest_identities, vinks, participants (exactly-one
    identity CHECK), vink_state_history, outbox_events (unpublished partial index),
    operation_requests — all CHECK lists mirroring the domain unions.
  - Routes (thin bindings, Zod-validated): `POST /api/v1/vinks`, `GET/PATCH
    /api/v1/vinks/:id`, `POST …/open|cancel|cover-remaining`, `POST/DELETE
    …/participants[/:id]` (add by username), `PUT …/split` (EQUAL/CUSTOM_AMOUNT/PERCENTAGE),
    `GET …/activity`. Error map: 404/403/409 (version conflict AND illegal transition)/422
    (domain rule); Bearer auth required on all.
- Domain: `ParticipantRemoved` added to the event-catalog extensions (D12 note updated).

## Files changed

New: `packages/application/**` (9 source files + test suite, package.json, tsconfig),
`apps/api/src/modules/vinks/{store,routes}.ts`, `apps/api/src/auth/http.ts`,
`apps/api/src/db/migrations/0002_vink_domain.sql`, `apps/api/src/vinks.integration.test.ts`,
this report. Modified: `packages/domain/src/domain-events.ts`, `apps/api/src/app.ts`
(route wiring), `docs/spec/decision-log.md` (D12 extension list),
`docs/architecture/05-milestone-sequence.md`, `CLAUDE.md`, `README.md`.

## Database changes

Migration 0002 (above). No triggers yet: the §4.7 cross-row trigger and ledger DDL are PV5
scope (contributions), matching the schema proposal's open items.

## APIs added

Eleven organizer endpoints (listed above) under `/api/v1`, all bound to commands per D13 —
no handler mutates state. `POST /vinks/:id/open` etc. are transport names only; the business
action is the command (owner's PV3 refinement honored).

## UI added

None (UI obligations sit at PV9–PV11 per the PV track structure).

## Tests added

12 new (repo total **111**: domain 48, application 10, api 19 + 2×2 integration variants
counted once each in CI, mock provider 14, conformance 20):
- Application (in-memory, no infrastructure): create (event, public-code shape, policy);
  unsupported category + past deadline rejection; full flow add→EQUAL→open with D12
  history+event assertions; duplicate member / organizer-removal / split-mismatch
  rejections; remove→cover-remaining→open recovery; ownership/version/machine-legality
  guards (DRAFT cancel rejected loudly per ratified G13); OPEN cancel + post-cancel edit
  block; DRAFT-only configure; snapshot `allowedActions` per state + stranger 403; activity
  ordering.
- API integration (CI, real PG — the **PV3 exit gate**): full organizer journey
  create→add×2→member-403→premature-open-422→EQUAL split→snapshot(OPEN_VINK, 0
  unallocated)→open→stale-version-409→activity (5 events + 1 transition)→cancel→empty
  allowedActions; journey E3 PV3 form (custom split→remove→remainder 8000→cover→open);
  unsupported category 422 + unknown vink 404.

Verified locally: `pnpm lint`, `format:check`, `guard`, `typecheck` (5/5), `pnpm test`
(5/5 packages, 109 locally-runnable tests green).

## Known limitations

1. **The integration suites (auth + vinks) have not executed anywhere yet** — no Docker
   locally and CI hasn't run (nothing pushed). They are the exit-gate evidence and run on
   the first push. If CI surfaces SQL-level issues the fixes are adapter-local by
   construction.
2. Snapshot/activity are organizer-only; participant and guest views arrive with PV4 tokens.
3. `addParticipant` requires a registered username; guest identities join in PV4.
4. No pagination on activity (fine at validation scale; revisit PV8).
5. `configureVink` bumps the version but emits no event (no catalog event for config
   changes; activity shows creation and allocation events only) — flag if analytics needs it.
6. Outbox rows are written but no publisher consumes them yet (realtime lands PV8; workers
   PV5).

## Security review

- Every vink route authenticates (Bearer) and authorizes (organizer-only, enforced in the
  application layer, not the handler); member/stranger access is 403 by test.
- All writes go through one row-locked transaction; version conflicts are explicit 409s —
  no lost updates from stale clients (Plan §11).
- Public codes: crypto-random, 30-char alphabet without ambiguous glyphs, 10 chars
  (~49 bits); never sequential (Plan §21). No sequential ids anywhere (UUIDs).
- Zod validation on every body; amounts are non-negative integers at the edge AND re-checked
  by the Money type inside.
- No state or funded-amount field is client-settable — commands compute everything
  server-side (Plan §21 "prevent clients from directly setting states or funded totals").

## Next milestone

**PV4 — Guest Join and Sharing:** share-link + QR payload contract from `public_code`,
`GET /join/:publicCode` public snapshot, guest join (`POST
/public/vinks/:publicCode/participants`) with hashed guest tokens (table already migrated),
participant-scoped snapshot views, rate limiting on the public endpoints (G4 token design
decision becomes live). Owner actions unchanged: push to run CI (executes both integration
suites), install Docker Desktop, keep M0 outreach moving.
