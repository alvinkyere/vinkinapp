# Milestone Report — PV1 (Local Platform Foundation) + Owner Ratification Pass

Date: 2026-07-17 · Track: product validation (D10) · Follows the owner's review of PV0–PV2
(D10 ratified, D11 amended, G13 ratified, D12/D13 added, PV1 approved). §45 report format.

## What was implemented

**Ratification pass (before PV1):**
- Decision log updated: D10 marked ratified; D11 ACCEPTED AS AMENDED (PV state names
  canonical everywhere); new **D12** (every transition atomically produces its domain event)
  and **D13** (command model; transports never mutate aggregates). G13/G14 moved to Resolved.
- **D12 implemented in `packages/domain`:** new `domain-events.ts` (Plan §12 catalog + seven
  flagged additive extensions); both transition tables now map every edge to `{ to, emits }`;
  `transitionVink`/`transitionContribution` return the pair, making silent transitions
  unrepresentable. Owner's illustrative `CardProvisioningStarted` realized as the catalog's
  `TemporaryCardRequested` (flagged in D12).
- **D11 in docs:** `03-state-machines.md` rewritten in the canonical vocabulary (tables now
  include the emitted event per D12) with a retired-vocabulary mapping appendix; historical
  doc 00 carries a supersession banner instead of a history rewrite.
- **`07-system-context.md`:** the authoritative architecture diagram + five structural rules
  and a placement guide. (Owner asked for `06-`; 06 is the M0 gate whose references must not
  break, so it landed as 07.)

**PV1 — Local Platform Foundation:**
- pnpm workspace (`pnpm-workspace.yaml`, root `package.json` with `packageManager`) +
  Turborepo (`test`, `typecheck` pipelines). pnpm 11.14.0 installed on the machine.
- `docker-compose.yml`: postgres:16-alpine + redis:7-alpine with healthchecks and volumes.
  `pnpm dev` = compose up → migrate → API (the one-command backend).
- **`apps/api`** (Fastify 5, native TS type-stripping — no build step):
  - Zod-validated environment (`loadEnv`): refuses to boot on invalid config; staging/
    production refuse the checked-in dev JWT secret. Environment set per governance §5 with
    the simulator **allowlist** guard (`simulator-guard.ts`) ready for PV5/PV6.
  - Health: `/health/live`; `/health/ready` runs per-dependency checks (PG `SELECT 1`, Redis
    ping) with 2s timeouts and reports each as ok/down.
  - Auth: `POST /api/v1/auth/{register,login,refresh,logout}` + `GET /api/v1/me`. scrypt
    password hashing (node:crypto — no external hash dependency), 15-minute HS256 JWTs
    (jose), 30-day opaque refresh tokens stored only as SHA-256 hashes, rotation on every
    refresh with **reuse detection** (a replayed token revokes all of the user's sessions).
    Uniform 401 for unknown-user/wrong-password (no account enumeration).
  - Observability: Pino structured logs via Fastify (authorization header redacted), UUID
    request ids on every response (`x-request-id`), OpenTelemetry NodeSDK bootstrap gated
    behind `VINKIN_OTEL_ENABLED=1` (lazy-imported; off costs nothing).
  - Jobs: BullMQ heartbeat queue + worker process (`pnpm --filter @vinkin/api worker`)
    proving the Redis/BullMQ path; real Plan §10 timer jobs arrive with PV5 and must
    re-check PostgreSQL deadline truth.
  - Migrations: SQL-file runner (`schema_migrations`, one transaction per file, idempotent);
    `0001_identity.sql` (users incl. `password_hash`, auth_sessions). Seed script creates
    three demo users and refuses to run outside development/test/demo.
- Lint/format: ESLint (typescript-eslint recommended) + Prettier across the workspace;
  repo-wide `pnpm lint` / `pnpm format:check` green; docs (including the verbatim Spec) are
  excluded from formatting.
- CI: new **workspace job** — pnpm install, lint, format check, turbo typecheck (all four
  packages), then migrations + the full API suite **including integration tests against real
  PostgreSQL and Redis service containers** (`VINKIN_INTEGRATION=1`). Existing zero-dep
  package jobs and the PV0 provider-import guard job unchanged.

## Files changed

New: `pnpm-workspace.yaml`, `turbo.json`, `docker-compose.yml`, `.env.example`,
`.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`, root `package.json`,
`pnpm-lock.yaml`, `docs/architecture/07-system-context.md`,
`packages/domain/src/domain-events.ts`, `apps/api/**` (14 source, 6 test files, migration,
package.json, tsconfig.json), this report.
Modified: both domain state machines + their tests (D12), `packages/domain/src/index.ts`,
`docs/architecture/03-state-machines.md` (rewritten), `00-current-state-and-gaps.md`
(banner), `05-milestone-sequence.md`, `docs/spec/decision-log.md`, `open-questions.md`,
schema proposal (§1 sync), `.github/workflows/ci.yml`, `.gitignore`, `CLAUDE.md`,
`README.md`. Prettier normalized existing TS sources (formatting only).

## Database changes

`0001_identity.sql` — `users` (with `password_hash`, a flagged PV1 addition to the Plan §7
entity, mirrored into the schema proposal) and `auth_sessions` (hashed rotating refresh
tokens, `rotated_from` lineage). Applied by the runner locally/CI; no vink-domain tables yet
(they open PV3).

## APIs added

`GET /health/live`, `GET /health/ready`, `POST /api/v1/auth/register`, `POST
/api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET
/api/v1/me`. All bodies Zod-validated (400 `VALIDATION_FAILED` with issue paths); typed auth
errors map to 401/409.

## UI added

None (PV1 is backend infrastructure per master plan §24; UI obligations sit at PV9–PV11).

## Tests added

18 new API tests (repo total **99**, all green: domain 48, mock provider 14, conformance 20,
api 17 locally + 2 integration in CI):
- env: defaults, PORT coercion/rejection, unknown env rejection, dev-secret refusal in
  production/staging, secret length floor.
- simulator guard: allowlist is exactly {development, test, demo}.
- passwords: verify/reject, per-hash salting, malformed stored values.
- tokens: JWT round-trip, tampered/wrong-secret/garbage → null, refresh token
  distinctness + deterministic hashing.
- app (no infrastructure): live 200; ready reflects per-dependency health (200/503);
  x-request-id on every response; auth routes absent in unit mode.
- integration (CI, real PG): register → 409 duplicate → me → login/bad-login → refresh
  rotation → **reuse detection kills successor sessions** → logout → refresh-after-logout
  401; Zod 400 shape. Two domain tests added for D12 (no silent transitions).

Verification run locally: `pnpm lint`, `pnpm format:check`, `pnpm guard`, `pnpm typecheck`
(4/4), `pnpm test` (4/4 packages), API boots — `/health/live` 200, `/health/ready` 503 with
`{database: down, redis: down}` (no local containers), request-id header present.

## Known limitations

1. **Docker is not installed on this machine** — `docker compose up` (and therefore the
   literal PV1 exit gate "one command starts the complete local backend") could not be
   exercised locally. The compose file is exercised in spirit by CI's service containers,
   where migrations + integration tests run against real PG/Redis. Owner action: install
   Docker Desktop, then `pnpm dev`.
2. Auth endpoints predate the D13 command layer (recorded in D13: they migrate into
   commands when `packages/application` lands in PV3).
3. OTel exports only when `VINKIN_OTEL_ENABLED=1` and a collector exists; metrics (Plan §22
   counters) are not yet emitted — PV5+ concern.
4. BullMQ native speedups (`msgpackr-extract`) are deliberately not compiled
   (pure-JS fallback; pinned false in `pnpm-workspace.yaml`).
5. `pnpm dev` chains compose + migrate + API; a compose healthcheck race on very first boot
   may need one retry (migrate fails fast and is idempotent).
6. Guard still scans JS/TS only; extend for Dart before PV9 (carried from PV0–PV2 report).

## Security review

- Passwords: scrypt with per-password salt, constant-time compare; no plaintext anywhere.
- Refresh tokens stored only as SHA-256 hashes; rotation on every use; replay of a rotated
  token revokes the whole session family. Access tokens 15 minutes, issuer-pinned.
- No account enumeration (uniform INVALID_CREDENTIALS); username/password shape limits.
- Authorization header redacted from logs; request ids everywhere; no PAN/CVV columns exist.
- Boot-time refusal of the dev JWT secret outside development/test; simulator/seed guarded
  by the governance §5 **allowlist** (never a `!== production` check).
- Provider-import guard green; no provider SDK in the dependency tree.
- CI never contains real secrets (service containers use throwaway credentials).

## Next milestone

**PV3 — Organizer API** (PV2 exit criteria all met; PV1 platform ready):
1. Vink-domain migrations from the schema proposal (vinks, participants, contributions,
   state history, outbox, operation_requests).
2. `packages/application` command layer (D13): OpenVinkCommand, CancelVinkCommand, … each
   command: validate → load (row lock) → domain transition → outbox event (D12) → return.
3. Organizer endpoints from master plan §13 as thin bindings over commands.
Owner actions: install Docker Desktop (unblocks `pnpm dev` and E2E work), keep the M0
outreach moving in parallel (unchanged).
