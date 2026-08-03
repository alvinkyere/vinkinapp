# SH1 — Security Hardening (continuous verification pass)

**Date:** 2026-08-03
**Scope:** owner-supplied SH1 brief — comprehensive offensive security review (OWASP ZAP,
authorization penetration testing, API abuse testing, dependency/secret scanning, CI security
automation) treating every endpoint as hostile. Not a rebuild of ENG8 (`docs/architecture/
eng8-threat-model-and-security-decisions.md`, `ENG8-SECURITY-HARDENING.md`) — a fresh
adversarial pass over what's changed since, chiefly the entire RM1–RM4B Real-Money Beta track
(reusable card pool, wallet-token provisioning, capture-immediately funding, dual-timer
lifecycle), which had never had a dedicated security review.

## Audit first

Two Explore-agent audits (mirroring ENG6 Slice 1/ENG8's own precedent) mapped the auth/authz
surface and cross-checked existing CI security tooling before any code was touched. Confirmed
solid: JWT verification (`jose`/HS256, structurally disjoint claim shapes prevent user/operator
token cross-use), CORS allowlisting, rate limiting, ENG2 Slice A's boundary-validation
(malformed UUIDs already rejected everywhere), and — a new finding this pass specifically
looked for — the RM1–RM4B card-pool surface never exposes `cardId`/`card_assignment_id`/wallet
tokens as caller-supplied route params at all, so the class of bug found below couldn't recur
there by construction.

Two real gaps found, both fixed:

## What was built

**Fix 1 — IDOR in `resolveContributionCommand`** (the headline SH1B-class finding).
`POST /api/v1/vinks/:vinkId/contributions/:contributionId/resolve`
(`apps/api/src/modules/contributions/routes.ts`) called `requireUser` and then passed
`vinkId`/`contributionId` straight into the command with **no ownership check at all** —
`ResolveContributionInput` carried no requester field, unlike `authorizeContributionCommand`'s
existing `requester` shape. Any authenticated user could force-resolve (and, via RM3A's
`captureImmediately`, capture real money on) any other user's pending contribution on any vink
they had no relationship to. Fixed by adding an optional `requester: ContributionRequester` to
`ResolveContributionInput` (`packages/application/src/contributions.ts`) — required and
enforced for the HTTP route (organizer or the contribution's own participant only, mirroring
the existing `loadOwnedVinkForRead`/inline-`organizerUserId` pattern), left `undefined` for the
two trusted internal callers that aren't driven by a single request (`jobs/sweeps.ts`'s
system-wide sweep, the dev/test-only `/internal/simulator/*` resolve-pending route). Proved the
regression test genuinely catches the bug, not just asserts a shape: reverted the
application-layer check via `git stash`, confirmed the new HTTP-level test fails (200 instead
of 403), restored, confirmed it passes.

**Fix 2 — unauthenticated `/internal/simulator/*` routes, live-reachable on the hosted pilot.**
All eight dev/test-only simulator utility routes across `contributions/routes.ts`,
`purchases/routes.ts`, `recovery/routes.ts` (`run-deadlines`, `resolve-pending`,
`provision-card`, `merchant-authorizations`, `authorizations/:id/{reverse,capture}`,
`recovery/{start,retry}`, `refund-failed-session`, `contributions/:id/retry-refund`) carried
**zero bearer authentication**, relying solely on `simulatorRoutesPermitted(env)`, an allowlist
of `development | test | demo`. Per `CLAUDE.md`'s own ENG4 hosted-activation note, the live
public Railway deployment runs `VINKIN_ENV=demo` — on the allowlist — meaning any internet
caller could reach these against **any vinkId/contributionId they don't own**: force a
deadline early, force-resolve a stranger's pending contribution either direction, trigger a
refund, with no auth. Flagged to the owner before fixing (`AskUserQuestion`, not decided
silently) since remediation choice affects whether any legitimate demo/QA flow calls these
unauthenticated — owner chose: require `requireOperator` on all of them (matching the existing
`/internal/ops/*` pattern), checked as the first statement in every handler, same ordering
discipline ENG6 Slice 6's own auth-ordering bug taught. Mitigating factor confirmed by reading
`server.ts:26`: `provider = new MockFinancialProvider()` still drives all command execution —
no real money could have moved through this gap regardless — but it was a live, unauthenticated
cross-tenant state-manipulation hole, exactly the SH1A/SH1C class the brief asks to hunt.

**Fix 3 — missing security headers on both Next.js frontends (found by the local ZAP scan).**
ENG8's `@fastify/helmet` work only ever covered `apps/api` — `apps/guest-web` and
`apps/operations-console` had zero security headers of any kind (confirmed by direct `curl`
before and after). A real local OWASP ZAP baseline scan (spider + active scan against all three
surfaces — see Verification for the environment substitution) found 8 genuine Medium findings
(Missing Anti-clickjacking Header / CSP Header Not Set) plus a real X-Powered-By disclosure at
Low. Fixed via `next.config.ts`'s `headers()` in both apps: `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a CSP
scoped to `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, and
`poweredByHeader: false`. **Deliberately not a full script-src CSP lockdown** — same caution
ENG8 disclosed for the API's own CSP (left off entirely rather than guess at one that breaks
inline-script pages without dedicated testing); the scoped CSP added here is the part
unambiguously safe to ship without risking hydration.

**Fix 4 — dependency drift since ENG8, found on a fresh `pnpm audit`.** Two new CVEs had
appeared since ENG8's dependency-scanning pass closed clean: `brace-expansion`
(GHSA-rgw5-rvv9-x895, a bypass of the CVE ENG8's `ignoreGhsas` entry originally covered — now
affecting two separate lineages, `minimatch@3.1.5`/ESLint 9.x at 1.1.16 and
`minimatch@10.2.5`/ESLint 10.x at 5.0.7) and `postcss` (GHSA-fxqj-rqcc-2cmp, affecting the
`@tailwindcss/postcss` lineage ENG8's `next>postcss`-scoped override never touched, confirming
that scoping decision was correct rather than just cautious). Unlike ENG8's original 1.x→5.x
brace-expansion jump (rejected as too risky), the actual fix versions available now (1.1.18,
5.0.9) are same-major patch releases within each parent's own declared semver range — no
compatibility risk. Fixed via four new scoped overrides in `pnpm-workspace.yaml`; removed the
now-fully-superseded `ignoreGhsas` entry rather than leaving it as dead config (a clean
`pnpm audit` with no ignore list at all confirms it's gone, not just suppressed).
`pnpm audit`: **0 vulnerabilities** (down from 1 moderate + 4 high, 2 ignored).

**CI security automation**: added `.github/workflows/codeql.yml` (CodeQL, `javascript-
typescript`, `security-extended` queries, push/PR/weekly schedule) — the one concretely-missing
item; `ci.yml`'s own `security-scans` job (`pnpm audit` + Semgrep) already covers dependency
scanning and SAST since ENG8, confirmed still wired and unchanged.

## What was NOT built (disclosed, out of scope)

- **GitGuardian, Snyk, a live staging ZAP run** — no accounts/credentials/staging URL exist in
  this environment. Owner confirmed local substitutes: gitleaks + trufflehog (no account
  needed) for secrets, a locally-run ZAP daemon for DAST. Flagged as a real follow-up if the
  owner later provisions those services (see Next).
- **Docker-based ZAP** (the brief's literal ask) — Docker isn't installed in this environment
  (confirmed, consistent with every prior milestone report's "still no Docker" note); OWASP ZAP
  was installed directly via Homebrew (`zaproxy` cask + `openjdk`) and run against the stack
  started the documented local-dev way instead. Same scan, no new Docker dependency.
  Substitution disclosed to the owner before executing, not decided silently.
  **The `zap` Homebrew cask is deprecated (fails Gatekeeper, disabled 2026-09-01)** — it still
  installed and ran clean here, but a future SH-series pass may need a different install path.
- **A full authenticated ZAP crawl behind JWT auth** — the spider/active scan covered
  unauthenticated surfaces (both Next.js apps' full page trees, the API's public/auth
  endpoints) plus a handful of manually-proxied authenticated probes (register/login/CORS).
  Building a full session-managed authenticated crawl (ZAP context + auth script) is a
  meaningfully larger investment than this pass's scope — flagged for a future SH2.
- **A full script-src CSP** on the two Next.js apps — see Fix 3 above; the scoped CSP shipped
  is real and unambiguously safe, not a placeholder, but doesn't lock down script execution.
- **Amount-tampering business-rule caps** (e.g. a max Vink size) — audited and found
  unnecessary, not merely unbuilt: `assertWithinApprovedMaximum` (§4.7) already means no
  participant can ever be captured beyond their own organizer-set allocation, and only that
  participant's own authenticated action can trigger their charge at all. No product-behavior
  change was made (out of scope per the brief's own instruction).

## Tests

- `packages/application`: **149/149** (up from 147 — 2 new unit tests proving the IDOR fix:
  cross-participant/stranger rejection with unmutated state, organizer-success, trusted-
  internal-caller-unaffected).
- `apps/api` integration: **290/290** (up from 288 — 1 new HTTP-level IDOR regression test in
  `contributions.integration.test.ts`, 1 new reverse-direction token-boundary test in
  `ops.integration.test.ts` proving an operator token is genuinely rejected by a
  `requireUser`-gated route, not just asserted from the code). All five integration test files
  touching `/internal/simulator/*` (`contributions`, `purchases`, `recovery`,
  `rm3b-card-pool-cutover`, `analytics`) updated to authenticate as an operator.
- `apps/guest-web` Playwright: **44 passed**, 8 failed, 1 skipped — the failed count matches
  RM4B's own documented baseline exactly ("same 8 pre-existing-unrelated failures"); none are
  header/CSP-shaped (all pre-existing exact-copy-text assertions in `e9.spec.ts`/
  `guest-terminal-states.spec.ts`), confirming no regression from the header change.
- `apps/operations-console` Playwright: 1 passed, 1 failed — the failure
  (`pv11-exit-gate.spec.ts`, timing out waiting for `CARD_READY`) traced to this local dev
  Postgres database's `cards` table being empty (`SELECT * FROM cards` → 0 rows) — a
  pre-existing local-environment seeding gap, not a code regression: server logs confirm the
  real sweep scheduler ran cleanly every cycle throughout, correctly found 0 provisionable
  cards, and correctly auto-refunded the stuck vink per RM4A's own design — no errors, no 401s,
  nothing implicating the `requireOperator` change (this test's own comment: "no simulator
  shortcut" — it never calls the newly-gated routes at all).
- `pnpm typecheck`/`lint`/`format:check`/`guard`: clean, 12/12 packages, throughout every fix.

## Verification

- The IDOR fix and the environment-gating fix were each proven against real PostgreSQL/Redis,
  real HTTP calls (`app.inject`), never mocks — this repo's standing convention.
- Both Next.js apps rebuilt clean (`next build`) after the dependency bumps and header changes;
  headers confirmed live via direct `curl` against real running processes, both before (absent)
  and after (present) the fix.
- The ZAP scan itself ran against a real local stack: brew-managed Postgres/Redis (already
  running per this repo's documented no-Docker local-dev pattern) + a real `node
  src/server.ts` + real `next dev` instances for both frontends, all three confirmed live via
  `/health/ready` and direct page fetches before scanning began.
- Every ZAP finding was individually triaged, not batch-accepted or batch-dismissed: the one
  High (Path Traversal) was manually reproduced and disproven with a real traversal payload
  (correctly `400`-rejected by existing input validation); the two Low false positives
  (Private IP / Timestamp Disclosure) were traced to specific lines inside third-party vendor
  JS (`@sentry/conventions`, React's compiled bundle), not application code.
- CORS allowlist behavior independently spot-checked: a forged `Origin: http://evil.example.com`
  gets no `Access-Control-Allow-Origin` grant on a real preflight request.

## Known, disclosed gaps

- GitGuardian/Snyk/live-staging ZAP — no accounts, not run (see above).
- Full authenticated ZAP crawl and full script-src CSP — scoped out this pass (see above).
- The `zap` Homebrew cask's own deprecation (disabled 2026-09-01) means this exact install path
  won't work unmodified for a future SH2 — worth resolving before then.
- `apps/operations-console`'s local dev database has no seeded card pool — pre-existing, not
  introduced or fixed here; a future session touching this test should seed one first (see
  `rm3b-card-pool-cutover.integration.test.ts`'s own `seedPoolCard()` for the pattern).

## Next

Follow-up recommendations for a future SH2 (not started, not scoped here):
1. Full authenticated ZAP crawl (context + auth script) covering JWT-gated organizer/participant
   routes and operator-token-gated `/internal/ops/*`/`/internal/reconciliation/*` routes — this
   pass only reached unauthenticated surfaces plus a handful of manual probes.
2. A script-src CSP for both Next.js apps, tested properly against hydration rather than
   guessed at — the current CSP is real but deliberately narrow.
3. Adopt GitGuardian or Snyk if the owner provisions accounts — local gitleaks/trufflehog +
   existing Semgrep `p/secrets` are solid but a continuously-running cloud scanner catches new
   commits between local passes.
4. Re-verify the `zap` Homebrew cask's replacement install path before its 2026-09-01
   deprecation disables it.
5. Continuous verification, not a one-time audit: re-run this same shape of pass after RM5–RM7
   (wallet provisioning, ops-console dispute review + the new operator-refund route, beta-cap
   configuration) land — each adds real financial-adjacent surface area the way RM1–RM4B did.

No Critical or High severity findings remain unresolved (the one High ZAP finding was a
confirmed false positive). Every real fix has a regression test or a direct, reproducible
verification step; everything not fixed is disclosed above with a reason, not silently dropped.
