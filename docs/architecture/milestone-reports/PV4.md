# Milestone Report — PV4 (Guest Join and Sharing)

Date: 2026-07-18 · Track: product validation (D10) · Started on owner instruction while
PV3's formal closure awaits the CI re-run. §45 report format.

## What was implemented

- **`packages/application`** guest module (D13 shape):
  - `guestJoinVinkCommand` (public command — new `PublicCommandContext`, no actor user):
    row-locks the vink by public code, enforces joinability (OPEN and before the submission
    deadline — the Plan's "expiration handling"), creates the guest identity + participant
    (MEMBER/JOINED, zero allocation) and emits `ParticipantJoined` with `guest: true`, all
    in one unit of work. The **application layer never sees the raw token** — the transport
    mints it and passes only the SHA-256 hash inward.
  - Queries: `getPublicVinkView` (anonymous pre-join summary: category, amounts, state,
    deadline, participant count, `joinable` — no internal ids) and `getGuestVinkView`
    (guest's own allocation/status, resolved from the token hash, never from client ids).
  - Port additions: `getVinkByPublicCode(ForUpdate)`, `insertGuestIdentity`,
    `findGuestParticipant(hash, now)`; `GuestIdentityRecord`; new error codes
    `VINK_NOT_JOINABLE` (→410) and `GUEST_UNAUTHENTICATED` (→401).
- **`apps/api`:**
  - Migration `0003_guest_sharing.sql`: `guest_identities.expires_at`, UNIQUE token-hash
    index, **partial UNIQUE index enforcing single-slot binding** (one guest identity, one
    participant), public-code index.
  - Guest tokens (`vgt_` prefix, 32 random bytes, hash-only storage) — D14.
  - In-memory fixed-window **rate limiter** on the public surface (view 120/min/IP, join
    30/min/IP; 429 + `retry-after`), config-injectable for tests.
  - Routes: `POST /vinks/:id/share-links` and `POST /vinks/:id/qr` (auth, organizer —
    the QR endpoint returns the **`vinkin.join.v1` payload contract**, clients render the
    image); `GET /join/:publicCode` (public, rate-limited); `POST
    /public/vinks/:publicCode/participants` (public, rate-limited — the only place the raw
    guest token ever appears); `GET /guest/session` (guest bearer token).
  - New env: `VINKIN_PUBLIC_BASE_URL` (share-link/QR base; guest-web origin once PV10 exists).
- Decision log: **D14** (validation-build guest token design, PROPOSED) with G4 annotated —
  production token questions (OTP threshold, TTL) remain open for M4.

## Files changed

New: `packages/application/src/guest.ts` + `guest.test.ts`,
`apps/api/src/modules/sharing/routes.ts`, `apps/api/src/auth/guest-tokens.ts`,
`apps/api/src/middleware/rate-limit.ts`, `apps/api/src/db/migrations/0003_guest_sharing.sql`,
`apps/api/src/guest.integration.test.ts`, this report.
Modified: `packages/application/src/{ports,errors,index}.ts`, `testing/in-memory.ts`,
`apps/api/src/modules/vinks/store.ts` (guest port methods), `apps/api/src/app.ts`,
`apps/api/src/config/env.ts`, `docs/spec/{decision-log,open-questions}.md`,
`docs/architecture/05-milestone-sequence.md`, `CLAUDE.md`, `README.md`.

## Database changes

Migration 0003 (above) — additive; exercises the multi-migration path of the runner.

## APIs added

Five endpoints: two authenticated organizer sharing endpoints (share-link, QR payload) and
three public/guest endpoints (pre-join view, guest join, guest session view).

## UI added

None (guest web UI is PV10; these are its exact API contracts).

## Tests added

7 new (4 application unit + 3 integration; repo totals: **113 unit + 27 integration**, all
green — integration verified against real local PostgreSQL 16):
- Unit (in-memory, fake clock): guest joins OPEN vink → own view via token hash;
  DRAFT/past-deadline/unknown-code rejections (`VINK_NOT_JOINABLE`/404); public view
  reports `joinable` truthfully incl. deadline passage; expired and unknown token hashes
  fail closed.
- Integration (**PV4 exit gate**): full E9 joinable half — organizer opens vink → share
  link + QR payload (401 unauthenticated) → anonymous pre-join view → guest joins with **no
  authentication** → guest session view via `vgt_` bearer token → DB check that the raw
  token is stored nowhere → wrong/absent token 401. Join refused 410 before open and after
  cancel, 404 unknown code. Rate limiter: 3-request window → `[404,404,404,429,429]` with
  `retry-after`.

## Known limitations

1. Guest tokens have no re-issue flow — a guest who loses the token re-joins as a new
   participant (organizer removes the orphan). Acceptable for the pilot; revisit with G4.
2. Rate limiting is per-process memory — resets on restart, not shared across instances.
   Redis-backed window when horizontal scale arrives (PV8+).
3. Guests joining after the split leaves them at zero allocation until the organizer
   re-splits (visible via `EDIT_ALLOCATION`); realtime nudges arrive in PV8.
4. `GET /join/:publicCode` reveals category/amount/progress to anyone with the code — by
   design (the code IS the invitation), consistent with §21's cryptographically random
   codes; no participant names are exposed pre-join.
5. Guest view is read-only; contribution approval (E9's second half) is PV5.
6. PV3's formal closure still awaits the owner's push/CI green; PV4 code is additive and
   does not touch the PV3 fix surfaces.

## Security review

- Raw guest tokens exist only in the join response; storage is SHA-256 hash with a UNIQUE
  index; expiry enforced in the query (`expires_at > now`), fail-closed on unknown/expired.
- Single-slot binding enforced by a partial UNIQUE index, not just application logic.
- Public endpoints rate-limited per IP with 429 + `retry-after`; limits injectable, so
  tests assert the real mechanism.
- Joinability guard runs inside the row-locked transaction — no join can race a
  cancel/close into an inconsistent participant set.
- Public views expose no internal UUIDs, no participant names, no organizer identity.
- Zod validation on the join body; display name length-capped.

## Next milestone

**PV5 — Mock Contribution Flow** (the big one): contribution creation + mock authorization
through `MockFinancialProvider` behind the neutral interface, decline/timeout/lost-response
scenarios, resolution + processing-grace jobs (BullMQ, PostgreSQL-deadline-checked),
funding determination under the D5 single resolver, ledger postings (Plan §18 accounts +
balanced-transaction enforcement from the schema proposal), concurrent-contribution
overfund tests. Requires: owner push (PV3+PV4 CI), and ideally Docker Desktop locally for
Redis-backed job tests (PG-only paths verified via the local instance).
