# ENG8 — Security Hardening

**Date:** 2026-07-28
**Scope:** `docs/architecture/eng-roadmap.md`'s ENG8 ("Security hardening... before any
external pilot") — 17 named implementation items plus a 10-scenario threat model.

## Audit first

An Explore-agent audit (mirroring ENG6 Slice 1's own precedent) checked all 17 items against
real code before any change. Already solid: token rotation, webhook signature verification,
CORS allowlists, replay protection via idempotency keys, deadline manipulation (already fixed
by ENG1). Real gaps: secure headers, input-size limits (implicit, never made an intentional
decision), least-privilege DB roles (none — single full-privilege connection for everything),
audit-log DB-level immutability (only the ledger had it), Redis-backed rate limiting
(per-process only, a disclosed gap since PV4), dependency scanning (no CI job at all), and
security-specific static analysis (ESLint only). Three items were genuine policy/tooling
decisions, resolved via `AskUserQuestion` before building: **Dependabot + `pnpm audit`** for
dependency scanning, **Semgrep CLI** (no-login public rulesets) for SAST, and **data-retention
rules + a system-wide privacy review deferred** — no retention/deletion policy or legal
requirement exists anywhere in this project's docs, and inventing one from code would be a
silent product/legal decision (§9 prohibits that).

## What was built

**Secure headers** (`apps/api/src/app.ts`): `@fastify/helmet`, with two disclosed deviations
from its defaults — `contentSecurityPolicy: false` (the default `script-src 'self'` would
break the two real inline-`<script>` HTML pages this API serves: password-reset confirm,
magic-link confirm) and `crossOriginResourcePolicy: { policy: 'cross-origin' }` (the default
`same-origin` blocks the exact cross-origin fetches `apps/guest-web`/`apps/operations-console`
exist to make — CORP enforces on CORS-mode fetches too, not just no-cors loads, a real
gotcha). Verified live: HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy present on
every response; the two auth confirm pages' inline scripts still execute (no CSP header at
all); a real cross-origin `curl` with `Origin: http://localhost:3100` gets both
`access-control-allow-origin` and `Cross-Origin-Resource-Policy: cross-origin`.

**Input-size limits**: an explicit `bodyLimit` (1 MiB, matching Fastify's prior implicit
default but now a documented, intentional value) in `Fastify({...})`. **Real bug caught by
live verification, not a new regression**: the global error handler collapsed Fastify's own
`FST_ERR_CTP_BODY_TOO_LARGE` (a genuine, well-formed `413`) into a bare `500
INTERNAL_ERROR` — this bug already existed under the old implicit 1 MiB default, just never
exercised. Fixed: the handler now passes through any Fastify-tagged (`FST_ERR_*`) error's own
sub-500 status code, narrowly (checked via `instanceof Error` + a `code`/`statusCode` type
guard, never trusting an arbitrary thrown error's own claimed status). Verified with a real
2 MB POST: `500` before the fix, genuine `413 {"error":"FST_ERR_CTP_BODY_TOO_LARGE"}` after.

**Redis-backed rate limiting** (`apps/api/src/middleware/rate-limit.ts`): closes the
disclosed-since-PV4 gap ("a shared Redis window replaces this when horizontal scale
arrives"). `makeRateLimiter` now takes an optional `Redis` client — INCR-then-PEXPIRE when
supplied, the original in-memory fixed window when not (unit tests, local dev without Redis;
zero test changes needed). Threaded through `registerAuthRoutes`/`registerSharingRoutes`/
`registerAnalyticsRoutes`/`app.ts`/`server.ts`, reusing the same Redis connection
`checkRedis` already uses (no new dedicated connection, unlike the realtime hub's genuine
SUBSCRIBE-mode need). Fails **open**, not closed, on a Redis error — a transient outage
degrades rate limiting instead of turning every password-reset/magic-link/join request into a
500; verified live with a real Redis key (`ratelimit:public-view:127.0.0.1`) created by a real
request.

**Least-privilege database role + audit-log DB-level immutability** (migration `0023`): a grep
across every non-test query in `apps/api/src` confirmed the running app never issues `DELETE`,
`TRUNCATE`, or any DDL — every "removal" in this codebase is a soft-state `UPDATE`. Migration
0023 creates a `vinkin_app` role with exactly `SELECT`/`INSERT`/`UPDATE` (no `DELETE`, no DDL),
default-privileged for future tables created by the same migration-runner identity. **Not yet
provisioned into the running connection** — swapping `apps/api`'s actual `DATABASE_URL` to
this role needs a real password (`ALTER ROLE ... PASSWORD`, never committed) and a per-
environment credential change, same "code-complete but not provisioned" shape as ENG4 Slice
2's Railway topology. The same migration also mirrors 0004's `ledger_entries_append_only`
trigger onto `operator_audit_log`, `vink_state_history`, and `contribution_status_history` —
previously append-only by convention only, now enforced at the DB level. New
`audit-immutability.integration.test.ts` (4/4) proves both: a real UPDATE/DELETE attempt on
each of the three tables genuinely raises `append-only`, and `information_schema` confirms
`vinkin_app`'s actual grants are exactly `INSERT`/`SELECT`/`UPDATE`.

**CSRF: not applicable, documented not assumed** (`docs/architecture/
eng8-threat-model-and-security-decisions.md`): confirmed via grep that no cookie-based
authentication exists anywhere in this API — every client uses a bearer token that must be
explicitly attached, so there is no ambient credential for a forged cross-site request to
ride on. CSRF tokens would defend against an attack this architecture cannot suffer; the
revisit trigger (a future cookie-based auth mode) is named explicitly, not left implicit.

**Dependency scanning** (`.github/dependabot.yml`, `.github/workflows/ci.yml`): Dependabot
(npm/pnpm workspace root, `apps/mobile`'s pub ecosystem, github-actions) for ongoing alerts;
a new `security-scans` CI job running `pnpm audit --audit-level=high` as the point-in-time PR
gate. **Running this for the first time surfaced 11 real high-severity findings** — not
theoretical: `find-my-way` (Fastify's own router, production runtime), `next` (4 separate
CVEs — middleware/proxy bypass, DoS, two SSRF variants, all in `apps/guest-web`/
`apps/operations-console`'s production runtime), `fast-uri`, `sharp`, and `postcss` (bundled
inside `next`, not the already-patched `@tailwindcss/postcss` lineage — confirmed two separate
postcss versions existed in the tree via `pnpm why`). Every one of the 10 fixed this pass was
a patch/minor-version bump, none a major jump: `next` 16.2.10 → 16.2.11 (direct dependency
bump, both apps); `find-my-way`/`fast-uri`/`sharp`/`next>postcss` via scoped
`pnpm-workspace.yaml` `overrides` (the `next>postcss` scoping specifically, rather than a bare
`postcss` override, avoids masking which of the two lineages was actually vulnerable). Both
Next.js apps rebuilt clean on `Next.js 16.2.11`; `apps/api`'s full suite re-verified unaffected
by the router/schema-compiler bumps. **One finding deliberately left unfixed and disclosed**:
`brace-expansion` (ESLint-only transitive dependency, never shipped to runtime or exposed to
attacker input) — its patched version is a major jump its own direct dependent
(`minimatch@3.1.5`) declares incompatible (`^1.1.7`); forcing it risked breaking the lint
pipeline for a dev-tooling-only DoS finding. Recorded via `pnpm-workspace.yaml`'s
`auditConfig.ignoreGhsas` (confirmed: `pnpm audit --audit-level=high` now exits `0`), not
silently dropped from output.

**Static analysis**: a new `security-scans` CI step installs Semgrep and runs
`p/security-audit` + `p/secrets` + `p/typescript` + `p/javascript` (chosen over `--config
auto`, which nudges toward a Semgrep account/login in recent CLI versions — these four need
neither) at `--severity ERROR` only for this first rollout, to avoid an unreviewed flood of
WARNING/INFO findings blocking every PR before anyone has seen what the ruleset actually flags
in this codebase. **Disclosed, not hidden**: this environment's disk was too constrained
(documented recurring issue — see ENG1-TIMER-SEMANTICS.md, I6.md, and this same milestone's
own disk-full incident below) to install Semgrep's toolchain locally and dry-run it; the CI
run itself is the first real verification.

**Threat model** (`docs/architecture/eng8-threat-model-and-security-decisions.md`): all 10
named scenarios assessed with file:line-level citations. 7 mitigated, 3 partial-with-disclosed-
gap (invite-link revocation, refund-retry velocity limiting, the pre-existing WS-token-in-URL
issue already flagged in `modules/realtime/routes.ts`'s own header comment — not new to ENG8,
not fixed here since a real fix needs coordinated `apps/mobile`/`apps/guest-web` client
changes beyond this pass's scope).

## Real environment incident during verification

Mid-verification, local disk hit **0 bytes free** — even `df -h` failed to write its own tool
output. Per this repo's own house rule (freeing disk needs owner sign-off, not unilateral
deletion — the exact precedent from `HOME-VISUAL-POLISH.md`/I6.md), asked first via
`AskUserQuestion` rather than guessing; owner chose "pnpm/turbo build caches only." Freed
~1.8 GiB via `rm -rf` on both Next.js apps' `.next` build dirs, `.turbo`, and `pnpm store
prune` (840 MB of cached package metadata) — all reversible, no project files touched;
`pnpm install --frozen-lockfile` confirmed the workspace's actual `node_modules` were
untouched by the prune. This is at least the fourth distinct instance of this exact class of
environment friction across this session's history (ENG1-TIMER-SEMANTICS.md,
ENG1-SLICE-3-SETUP-RECOVERY.md, I6.md all document it independently) — worth a standing
dev-data-reset habit if it keeps recurring, flagged again here rather than fixed as
out-of-scope infrastructure.

## Tests

- `apps/api`: **263/263** (up from 260 — 4 new in `audit-immutability.integration.test.ts`).
- `packages/application`: **137/137** unchanged.
- `apps/guest-web`/`apps/operations-console` unit suites: 7/7, 5/5 unchanged.
- `apps/guest-web`'s `e9.spec.ts` (the suite most exposed to the CORS/CORP/helmet changes):
  re-run twice — once against the unmodified server (stashed ENG8 changes) and once against
  the fully hardened server post-dependency-bump — **identical 6 pre-existing failures both
  times**, confirmed via `git stash` isolation to be unrelated to this milestone, not a new
  regression. The full Playwright battery across both Next.js apps was **not** re-run in its
  entirety this pass, given the disk incident above — disclosed as a real verification gap,
  not claimed as done.

## Verification

- `pnpm typecheck`/`lint`/`format:check`/`guard`: clean, 12/12 packages.
- Both Next.js apps (`apps/guest-web`, `apps/operations-console`) rebuilt clean on `next
  build` after the dependency bumps (`Next.js 16.2.11 (Turbopack)`, static/dynamic route
  manifest unchanged from before the bump).
- Live-process verification throughout, not just unit assertions: real security headers on a
  real response; real cross-origin CORS+CORP behavior; a real 2 MB oversized POST producing a
  genuine 413 (not the pre-existing masked 500); a real Redis key created by a real rate-
  limited request; a real UPDATE/DELETE rejected by the new DB triggers via `psql` directly
  against the local dev database (before the automated test existed).

## Known, disclosed gaps

- **Data-retention rules and a system-wide privacy review** — deferred, owner choice. No
  policy exists anywhere in this project to build against.
- **`brace-expansion` (GHSA-mh99-v99m-4gvg)** — dev-only, deliberately left unfixed, recorded
  in `pnpm-workspace.yaml`'s `auditConfig.ignoreGhsas`.
- **Semgrep's real findings against this codebase are unverified** until its first real CI
  run — not dry-run locally due to disk constraints.
- **`vinkin_app` role is code-complete, not provisioned** into the running connection — needs
  a real password and a `DATABASE_URL` swap per environment, an owner/ops action.
- **WebSocket auth-token-in-URL** (`modules/realtime/routes.ts`) — pre-existing, already
  disclosed in the code itself before ENG8; not re-scoped or fixed here.
- The full Playwright regression suite was not re-run end-to-end this pass (disk incident);
  the one suite most exposed to this milestone's changes (`e9.spec.ts`) was, twice.

## Next

ENG8's own numbered checklist is done for everything that doesn't require a policy decision
already deferred above. Per `docs/architecture/eng-roadmap.md`'s sequence
(`... → ENG7 → ENG8 → ENG9 → ...`), ENG9 ("Remote workflow certification") is next.
