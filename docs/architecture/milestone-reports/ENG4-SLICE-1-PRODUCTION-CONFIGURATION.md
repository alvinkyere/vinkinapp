# ENG4 Slice 1 — Production Configuration

**Date:** 2026-07-24
**Scope:** First slice of ENG4 ("Hosted Pilot Infrastructure"), owner-approved execution order
(pure-application-code slices 1/3/4/5 first, before the infrastructure/vendor-decision slices
2/6/7/8/9). Brief's own Slice 1 goal: audit every configuration value, separate
dev/test/staging/production, ensure no production secret lives in source, and make every
deployment either start correctly or refuse to start — never partially start.

## Audit findings (before any code)

`apps/api/src/config/env.ts` already implements the brief's core requirement well: a single
Zod-validated schema, fail-fast (`envSchema.parse` throws on malformed input), and explicit
boot-refusal checks rejecting known-unsafe dev defaults (`JWT_SECRET`, `OPERATOR_PASSWORD`) in
staging/production/demo. No hardcoded secrets found anywhere in source (repo-wide regex sweep);
the two checked-in values are labeled dev-only defaults, already refused outside dev/test/demo.

The real gaps: `apps/guest-web/lib/config.ts` and `apps/operations-console/lib/config.ts` read
`process.env.NEXT_PUBLIC_API_BASE_URL` with a bare `?? 'http://127.0.0.1:3000'` fallback and no
validation whatsoever — a staging/production deploy that forgot to set this would silently serve
traffic pointed at a loopback address nobody outside the host machine can reach, never refusing
to start. And the root `.env.example` had drifted stale: it documented 4 of `env.ts`'s ~19 real
variables.

## What was built

**`apps/guest-web/lib/env.ts` / `apps/operations-console/lib/env.ts`** (new): Zod-validated
`loadEnv()`, mirroring `apps/api/src/config/env.ts`'s exact pattern — same `VINKIN_ENV` enum,
same "refuse the dev default outside staging/production" shape for `NEXT_PUBLIC_API_BASE_URL`.
**Deliberately not** what `lib/config.ts`'s client-bundled `API_BASE_URL`/`wsBaseUrl()` reads
from: Next.js inlines `process.env.NEXT_PUBLIC_*` into the browser bundle only via a literal
`process.env.NEXT_PUBLIC_X` reference at build time (webpack/Turbopack static replacement);
routing that value through a dynamically-parsed schema would silently break it in the browser,
since a whole `process.env` object isn't populated client-side. `lib/config.ts`'s existing
literal reads are untouched — `env.ts` is a separate, server-only validation/refusal layer.

**`apps/guest-web/scripts/validate-env.ts` / `apps/operations-console/scripts/validate-env.ts`**
(new): a tiny script that calls `loadEnv()` and exits 1 with a clear message on failure. Wired
into `package.json`'s `start` script as `"node scripts/validate-env.ts && next start"` — the
`&&` means a refusal genuinely prevents `next start` from ever running, not just logs a warning.
Verified this three ways against real running processes, not just unit tests: a real `next
build` + `npm start` with valid config serves traffic (`curl` gets 200); the same command with
`VINKIN_ENV=staging` and no explicit `NEXT_PUBLIC_API_BASE_URL` exits 1 and the port is
confirmed never bound; setting the URL explicitly then starts clean.

**Both apps' `tsconfig.json`**: added `allowImportingTsExtensions: true` (safe given both
already have `noEmit: true`, the flag's only prerequisite) — needed because the new scripts
import `.ts`-extensioned relative paths (required for Node's native execution, matching
`apps/api`'s own convention) but the default Next.js `moduleResolution: "bundler"` tsconfig
rejects that without the flag.

**`.env.example`** (root): re-synced with `apps/api/src/config/env.ts`'s actual 19 variables
(was documenting 4), with a pointer comment to the two new per-app `env.ts` files instead of
duplicating their (smaller) variable lists.

## Tests

- `apps/guest-web/lib/env.test.ts` (new, 7 tests): dev defaults, unknown `VINKIN_ENV` rejection,
  malformed URL rejection, loopback-default refusal in staging/production, loopback-default
  allowed in development/test, the two `NEXT_PUBLIC_*` flag/URL validations.
- `apps/operations-console/lib/env.test.ts` (new, 5 tests): same core cases, scoped to what this
  app actually reads.
- Both wired to a new `test:unit` script (`node --test lib/*.test.ts`) — additive, doesn't touch
  the existing `test` (Playwright) script. Not yet wired into CI (CI currently runs neither
  app's Playwright suite either — flagged as a known gap, not silently fixed here, since wiring
  either into CI is Slice 8's scope, not this one's).

## Verification

- `pnpm typecheck`: 10/10 packages clean.
- `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean.
- `apps/guest-web` / `apps/operations-console` `npm run test:unit`: 7/5 passing.
- Real process verification (not simulated): `next build` succeeds for both apps; `npm start`
  with valid config boots and serves a real `curl` request; `npm start` with a staging/
  production `VINKIN_ENV` and no explicit API URL exits 1 and never binds the port; the same
  command with the URL set boots clean. Confirmed for both apps independently.
- `git diff --stat -- pnpm-lock.yaml`: 6 additive lines only (the two new `zod` entries) —
  confirmed no unrelated lockfile drift from `pnpm install`.

## Known, disclosed gaps

- A `MODULE_TYPELESS_PACKAGE_JSON` Node warning appears when running the new scripts/tests
  (neither app's `package.json` declares `"type": "module"`, unlike `apps/api`'s). Deliberately
  not fixed here — adding it repo-wide to a Next.js app's `package.json` risks affecting how
  Next's own config files load and is a real, if small, blast-radius change unrelated to this
  slice's actual goal; the warning is cosmetic (a perf note, not a failure) and left as a flagged
  follow-up rather than silently touched.
- `test:unit` is not yet wired into CI or the root `pnpm test` — see above.
- `apps/mobile`'s config directory (`lib/core/config/`) was not audited this slice — ENG4's
  brief frames this as backend/web "production configuration"; Flutter's config surface
  (feature flags, not deploy-environment secrets) is a different shape and wasn't in the
  audit's scope of found gaps. Flagged, not silently assumed clean.

## Exit gate

- [x] Every configuration value across `apps/api`, `apps/guest-web`, `apps/operations-console`
  is now either previously-validated or newly-validated.
- [x] No production secret exists in source (confirmed by audit, unchanged by this slice).
- [x] Fail-fast/startup verification now exists for all three backend/web apps, not just
  `apps/api`.
- [x] Verified with real process starts, not just unit tests: a deployment either starts
  correctly or refuses to start — proven for both new apps, in both directions.

## Next

ENG4 Slice 3 (structured logging — correlation IDs propagated through BullMQ jobs and provider
calls, not just the HTTP request lifecycle Fastify already covers).
