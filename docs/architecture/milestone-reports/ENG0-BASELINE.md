# ENG0 — Repository and Baseline Certification

Status: **done**. This certifies the PV13/PV13-SCREENSHOTS baseline as the starting point for
the new engineering track (`ENG0`–`ENG15`, see the engineering plan the owner supplied
2026-07-20, superseding the "Next" pointer at the top of `CLAUDE.md`).

## Exact verified commit

```
fe876d7  App dev Stage 1 completed
```

Working tree was clean except one untracked doc (`docs/architecture/how-to-run-a-demo.md`,
already written pre-ENG0 and folded into this baseline — see §"Startup commands" below) plus
the two fixes this milestone made (`turbo.json`, `.prettierignore`). Owner should tag once
these are committed:

```bash
git add turbo.json .prettierignore docs/architecture/how-to-run-a-demo.md \
        docs/architecture/milestone-reports/ENG0-BASELINE.md
git commit -m "ENG0: baseline certification — fix turbo env passthrough and prettier ignore"
git tag -a eng0-baseline -m "ENG0 baseline: last known-green PV13 state, verification suite fixed and passing"
```

## Applications

| App | Package | Role |
|---|---|---|
| `apps/api` | `@vinkin/api` | Fastify API + WebSocket `/live` channel, BullMQ workers/schedulers, migration runner, seed |
| `apps/mobile` | (Flutter, no npm package) | Organizer app, iOS Simulator |
| `apps/guest-web` | `@vinkin/guest-web` | Next.js guest/participant join+contribute flow |
| `apps/operations-console` | `@vinkin/operations-console` | Next.js internal ops console |

## Packages

`@vinkin/domain`, `@vinkin/application`, `@vinkin/ledger`, `@vinkin/payment-provider`,
`@vinkin/payment-provider-contract-tests` — all `0.0.1`, zero-dependency native-TS (Node
type-stripping), no build step.

## Services / ports

| Service | Port | Notes |
|---|---|---|
| API (`apps/api`) | 3000 | `PORT` env |
| guest-web | 3100 | must match `VINKIN_PUBLIC_BASE_URL` (CORS-allowed origin since PV4) |
| operations-console | 3200 | must match `OPERATIONS_CONSOLE_BASE_URL` (CORS-allowed origin since PV11) |
| PostgreSQL | 5432 | `docker-compose.yml`, or brew `postgresql@16` locally |
| Redis | 6379 | `docker-compose.yml`, or brew `redis` locally |

## Databases / migrations

PostgreSQL 16. 8 migrations (`apps/api/src/db/migrations/0001`–`0008`): identity, vink domain,
guest sharing, contributions+ledger, cards+purchases, recovery, operator audit log, analytics
events. Runner: `pnpm --filter @vinkin/api migrate` (advisory-locked, per PV3).

## Queues / workers

BullMQ, both in `apps/api/src/jobs/`:
- `worker.ts` — heartbeat queue (`HEARTBEAT_QUEUE`)
- `sweeps.ts` — deadline sweep queue (`SWEEP_QUEUE`), PG-owned truth for expiry (PV5)

Both require `createBullMqRedis()` (not `createRedis()`) — the PV9-fixed
`maxRetriesPerRequest: null` requirement. This is the kind of defect ENG1 §1 correlation
tracing is meant to catch earlier.

## Design systems

One active design system per client, confirmed by reading the wiring (not just docs):
- Mobile: `apps/mobile/lib/design_system/vink_theme.dart` → `buildVinkTheme()` → wired into
  `MaterialApp.router(theme: buildVinkTheme())` in `apps/mobile/lib/app/app.dart:15,18`. No
  parallel Material-default theme remains.
- guest-web: `apps/guest-web/app/globals.css` carries the same design tokens (Next.js,
  restyled onto the mobile tokens per PV13, not converted to Flutter).

## Environment variables (all `VINKIN_*` referenced in source)

`VINKIN_ENV`, `VINKIN_PUBLIC_BASE_URL`, `VINKIN_OPERATIONS_CONSOLE_BASE_URL` →
(actual name is `OPERATIONS_CONSOLE_BASE_URL`, no `VINKIN_` prefix — inconsistent with the
rest; flagged as a known defect below), `VINKIN_API_BASE_URL`, `VINKIN_GUEST_WEB_BASE_URL`,
`VINKIN_INTEGRATION`, `VINKIN_OTEL_ENABLED`, `VINKIN_ENVIRONMENTS`.

## Startup commands

Already documented in `docs/architecture/how-to-run-a-demo.md` (was untracked going into this
milestone; now certified as part of the baseline). Summary:

```bash
brew services start postgresql@16
brew services start redis

cd apps/api && VINKIN_ENV=development PORT=3000 \
  VINKIN_PUBLIC_BASE_URL=http://127.0.0.1:3100 \
  OPERATIONS_CONSOLE_BASE_URL=http://127.0.0.1:3200 \
  node src/server.ts

cd apps/guest-web && npm run build && npm run start -- -p 3100
cd apps/operations-console && npm run build && npm run start -- -p 3200
cd apps/mobile && flutter run -d <device-udid-or-name>
```

No undocumented manual initialization step was found.

## Seeded users / pilot fixtures

`pnpm --filter @vinkin/api seed` (`apps/api/src/seed.ts`) — idempotent, refused outside
development/test/demo (same allowlist as the simulator guard). Creates three demo users
(`demo_organizer`, `demo_member_1`, `demo_member_2`, shared password
`vinkin-demo-password`).

## Verification suite — result

Ran the full documented suite (`pnpm test`, `pnpm lint`, `pnpm typecheck`,
`pnpm format:check`, `pnpm guard`) plus `flutter analyze` / `flutter test` for `apps/mobile`.

| Check | Result |
|---|---|
| `VINKIN_INTEGRATION=1 pnpm test` | **191/191 pass**, 0 fail, 0 skip (see breakdown below) |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean, 8/8 packages |
| `pnpm format:check` | clean |
| `pnpm guard` (provider-import CI guard) | passed |
| `flutter analyze` (`apps/mobile`) | **7 info-level issues, exit code 1** — see known defects |
| `flutter test` (`apps/mobile`) | 23/23 pass |

Per-package test breakdown (`VINKIN_INTEGRATION=1 pnpm test`):

| Package | Tests |
|---|---|
| `@vinkin/domain` | 48 |
| `@vinkin/application` | 36 |
| `@vinkin/ledger` | 6 |
| `@vinkin/payment-provider` | 14 |
| `@vinkin/payment-provider-contract-tests` | 20 |
| `@vinkin/api` | 63 |
| `@vinkin/guest-web` (Playwright) | 2 |
| `@vinkin/operations-console` (Playwright) | 2 |
| **Total** | **191** (+ 23 Flutter, separate toolchain) |

(`@vinkin/api`'s 63 includes 19 suites, several previously skipped absent
`VINKIN_INTEGRATION=1` reaching the task — see defect below.)

## Known defects found and fixed this milestone

1. **`pnpm test` silently skipped every integration test.** `turbo.json` declared no `env`
   key for the `test` task, and Turborepo 2.x defaults to `envMode: "strict"` — so
   `VINKIN_INTEGRATION=1 pnpm test` never actually reached `process.env.VINKIN_INTEGRATION`
   inside the task, and 19 of `@vinkin/api`'s test suites silently reported `# SKIP` instead
   of running. Every milestone report's "N tests green" claims were true for the tests that
   *ran*, but `pnpm test` — the command `CLAUDE.md` tells every session to run — was not
   actually exercising the integration suites since whenever the `turbo.json` `test` task was
   introduced. **Fixed**: `turbo.json` now declares `"env": ["VINKIN_INTEGRATION",
   "VINKIN_OTEL_ENABLED"]` on the `test` task. Re-ran: 63/63 `@vinkin/api` tests now execute
   (up from 23 executed + 19 skipped).
2. **`pnpm format:check` failed on gitignored, Next.js auto-generated files**
   (`apps/guest-web/next-env.d.ts`, `apps/operations-console/next-env.d.ts`). Both are in
   each app's `.gitignore` but not in the root `.prettierignore`, so a clean checkout with
   `npm run build` already run would fail `format:check` on files nobody hand-writes or
   commits. **Fixed**: added `next-env.d.ts` to `.prettierignore`.

## Known defects — documented, not fixed (out of ENG0 scope)

3. **`flutter analyze` is not actually clean**, contra prior milestone reports' claims — 7
   info-level issues (`use_null_aware_elements` ×2, `prefer_initializing_formals` ×1,
   `use_build_context_synchronously` ×1, `deprecated_member_use` ×3 for `hasFlag` in
   `test/design_system/accessibility_test.dart`), exit code 1. Most likely cause: Flutter SDK
   drift — the currently installed SDK (3.44.6, built 2026-07-08) is newer than whatever SDK
   was used when those reports were written, and at least the `hasFlag` deprecation is
   explicitly SDK-version-gated ("deprecated after v3.32.0-0.0.pre"). One of the seven
   (`use_build_context_synchronously` in `add_person_sheet.dart:242`) is a real async-gap
   correctness lint, not just style — worth a look during ENG1/ENG3 client-reliability work
   rather than a blind fix here. Not fixed in ENG0 because touching product `.dart` files is
   implementation work, not baseline documentation.
4. **Inconsistent env var naming**: every other cross-service base URL is `VINKIN_*`
   (`VINKIN_PUBLIC_BASE_URL`, `VINKIN_API_BASE_URL`, `VINKIN_GUEST_WEB_BASE_URL`) except
   `OPERATIONS_CONSOLE_BASE_URL`, which has no `VINKIN_` prefix. Cosmetic; flagged for
   whenever ENG2's contract work touches config.
5. Carried over from prior reports (still true, re-verified narratively against the code, not
   re-tested this session since no new work touched them):
   - D19 (PV13-SCREENSHOTS): `fundedAmountMinor` only updates atomically on the *last*
     participant's contribution (`resolveFunding`, D5) — the partial-progress funding state
     vinkin.org's hero mockup implies is not reachable today. Flagged for the owner, unchanged.
   - No freeform Vink name/merchant field exists in the domain (PV13 known gap).
   - PV13's screenshot side-by-side comparison exists
     (`artifacts/product-screenshots/vinkin-website-product-comparison.png`) but hasn't had
     owner eyes on it yet.
   - A live-UI proof of the custom-split mismatch scenario is still open.
   - Sandbox S1–S12 (M0 gate) blocked on provider owner outreach + sandbox accounts.
   - Turbopack dev-mode HMR websocket fails to handshake in this environment — worked around
     by testing against production builds (already how `playwright.config.ts` operates).
   - The `VINKIN_PUBLIC_BASE_URL`/`OPERATIONS_CONSOLE_BASE_URL` override is easy to silently
     drop on a plain server restart (bit the PV13-SCREENSHOTS pass); still no `.env` or
     start-script fix exists. Candidate small ENG1/ENG3 fix.

No obsolete or experimental code was found to quarantine — no `TODO`/`FIXME`/`XXX`/
`@deprecated` markers and no old/legacy/scratch/wip-named files or directories anywhere in
`apps/` or `packages/`.

## Exit gate

- [x] Clean checkout can be started from documented instructions
      (`docs/architecture/how-to-run-a-demo.md`) — no undocumented manual step found.
- [x] All existing automated tests pass — 191 Node/TS tests (only 151 of which actually ran
      under the pre-fix `pnpm test`, due to defect #1) + 23 Flutter tests, all green.
- [x] No undocumented manual initialization step exists.
- [x] All known failures are entered into the backlog above (defects #3–#5).

ENG0 is done. Recommended next: **ENG1 — Core Workflow Correctness**, starting with §1
(diagnose the indefinite "Connecting…" defect) per the engineering plan's own stated priority
order.
