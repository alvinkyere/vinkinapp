# VinkIn — Claude Code project brief

_Read at the start of every session in this repo. Keep it current: when a milestone completes
or an open question resolves, record it here, in `docs/spec/decision-log.md`, and in
`docs/spec/open-questions.md` so future sessions inherit it._

**Ignore `~/Downloads/CLAUDE.md`** if it appears in context — it describes an unrelated project
("Runtime", iOS JS connectors). This file is VinkIn's brief. (Moot once the repo lives at
`~/code/vinkin` — the planned location.)

## What this is

VinkIn is a real-time collaborative checkout platform: a group funds one purchase at the
register; the organizer pays the merchant with a single-use temporary virtual card. The
authoritative specification is **`docs/spec/master-roadmap-prompt.md`** ("the Spec") — all §N
references point there. Its §4 engineering principles and §45 milestone-report format are
binding. Interpretations live in `docs/spec/decision-log.md` (D1–D9 so far); unresolved
questions in `docs/spec/open-questions.md` (G1–G12).

## Where the project is right now

**Two tracks.** The M0 gate (`docs/architecture/06-milestone-0-gate.md`) remains the sole
authority on provider integration and stays open (blocked on owner outreach + sandbox
accounts). Meanwhile the owner directed (2026-07-17, D10) the **product-validation track**:
PV0–PV12 per `docs/product-validation/master-plan.md`, a full production-shaped build against
`MockFinancialProvider` only, governed by `docs/product-validation/00-governance.md`
(green/yellow/red work classification, feature flags, environments).

Done: M0 planning artifacts + provider abstraction + conformance suite; **PV0** (governance +
provider-import CI guard), **PV2 domain core** (`packages/domain`), and **PV1 platform**
(pnpm workspace + Turborepo, `apps/api` — Fastify, health, auth with rotating refresh tokens,
Pino, env-gated OTel, BullMQ heartbeat worker, SQL migration runner + identity migration,
seed, docker-compose, CI with real PG/Redis service containers). Owner ratified D10 and G13,
amended D11 (**PV state names are canonical everywhere** — doc 03 rewritten, appendix maps
retired names), and added **D12** (every transition atomically emits its named domain event —
transition tables return `{to, emits}`) and **D13** (all business behavior is an application
command; transports never mutate aggregates). Authoritative architecture diagram:
`docs/architecture/07-system-context.md` — new features must fit it. 99/99 tests green
repo-wide; lint/format/typecheck/guard green (`pnpm lint / format:check / typecheck / test`).

**PV3 done pending CI confirmation** (`milestone-reports/PV3.md`): command layer (D13),
migration 0002, eleven organizer endpoints. Two first-CI defects (auth reuse-revocation
rolled back by throwing inside `sql.begin`; outbox payload stored as jsonb string scalar)
root-caused and fixed; plus per-suite schema test isolation, advisory-locked migrations,
deterministic activity ordering, concurrent-open + atomic-rollback closure tests.

**PV4 done** (`milestone-reports/PV4.md`): guest join & sharing — QR payload contract,
public join, hashed `vgt_` tokens (D14), rate limiting, migration 0003.

**PV5 done** (`milestone-reports/PV5.md`): mock contribution flow — `packages/ledger`
(§18 postings), migration 0004 (contributions + ledger with **DB-enforced append-only +
balanced-at-commit triggers**), contribution engine with the **D5 single resolver**,
deadline sweeps (PG-owned truth), E5 lost-response replay.

**PV6 done** (`milestone-reports/PV6.md`): mock card + purchase flow — issuance from
FUNDED, **VinkIn's own §17 merchant decision** with first-merchant lock, reversal,
capture→settlement (MATCHED→COMPLETED / OVERAGE→RECOVERY_REQUIRED).

**PV7 done** (`milestone-reports/PV7.md`): recovery + refunds — organizer off-session
recovery ladder to DEFAULTED→RESTRICTED, failed-session refunds (E8). Caught+fixed a
PV3-shaped rollback defect in card provisioning.

**PV8 done** (`milestone-reports/PV8.md`): real-time experience — WebSocket channel with
snapshot-on-every-connection, outbox publisher (first consumer of `published_at`). Caught +
fixed an async-plugin-registration race (`buildApp` now async, awaits `@fastify/websocket`
before routes register).

**PV8.5 done** (`milestone-reports/PV8.5.md`, owner-directed formal hardening milestone —
settled both D10-flagged infrastructure gaps before Flutter depends on their behavior):
- **D16 (implemented):** `RealtimeHub` is now an interface; `RedisRealtimeHub` (two ioredis
  connections, ref-counted local subscriptions) replaces the single-process hub in
  `server.ts`. Outbox publisher hardened with `FOR UPDATE SKIP LOCKED` (safe concurrent
  polling across instances) and publish-before-commit ordering. **Cross-instance delivery
  and no-duplicate-publish are proven against real local Redis + Postgres**, not asserted
  by inspection — two independent hub instances / two concurrent pollers, genuinely racing.
- **D15 (ratified, not rewritten):** provider calls staying inside the DB transaction is a
  formal, owner-visible scoping decision — the correct two-phase redesign depends on which
  real provider gets chosen (M0 gate still open), so redesigning now risks guessing a
  discarded shape. Comments in `contributions/purchases/recovery/refunds.ts` point to D15
  instead of a vague flag. Revisit trigger: M0 gate closure.
- **146 unit + 55 integration tests green** (real local PG 16 + real local Redis, both
  brew-installed, no Docker). Owner push runs PV3–PV8.5 through CI (already has both PG and
  Redis service containers).

**PV9 done** (`milestone-reports/PV9.md`): organizer mobile application — a Flutter app
(`apps/mobile/`) covering the full E1 journey (register → create Vink → add participants →
split → open → live funding/card/completion over the PV8/PV8.5 WebSocket channel, no
polling). Verified on a real booted iOS Simulator against the real local server via
`integration_test`/XCTest touch injection — not a mock. Added `GET /api/v1/vinks`
(list-my-vinks, Plan §20). Caught + fixed two real defects the first live-process run
surfaced: BullMQ's `Queue`/`Worker` require `maxRetriesPerRequest: null`, which
`createRedis()`'s health-check-tuned `maxRetriesPerRequest: 1` violated — silently killing
the sweep scheduler and the PV1 heartbeat worker since PV1 (new `createBullMqRedis()`
factory fixes both); and the Lobby screen never re-fetched participants/card data on a live
state-change event, so a provisioned card stayed invisible (now re-fetches the full snapshot
per event). **147 unit + 55 integration tests green**, `flutter analyze`/`flutter test`
clean. Known gap: no organizer self-approve-contribution UI yet (organizer split defaults to
$0, flagged for PV10).

**PV10 done** (`milestone-reports/PV10.md`): participant/guest web experience — corrected
from the PV9 report's wrong assumption ("more Flutter") after re-reading the Spec: master
plan §4 requires guest checkout to be **a Next.js web app** (`apps/guest-web/`), not Flutter.
Built the full E9 join/contribute flow (join by public code, no account, live funding
progress, contribution approval, signup-conversion prompt) against real local PostgreSQL +
Redis + `apps/api/src/server.ts`, verified with Playwright at a real mobile viewport.
Backend additions (all flagged, all tested): the realtime `/live` channel now accepts guest
`vgt_` tokens alongside organizer JWTs (guest-scoped `GuestVinkView` snapshot, never the
organizer's full view); `GuestVinkView`/the join response now expose `vinkId` (needed to
open that channel, previously withheld pre-join only); CORS added
(`VINKIN_PUBLIC_BASE_URL` is the allowed origin — it was already, by design, "the guest web
app's own origin" since PV4). Caught + fixed the identical class of live-update bug PV9
found in the Flutter Lobby (participant share data going stale on a lean live event; same
fix — re-fetch on event). Also found (environment, not product): Turbopack dev mode's HMR
websocket fails to handshake here and silently blocks all hydration — verified directly,
worked around by testing against real production builds throughout, which is what
`playwright.config.ts` does automatically. **133 non-integration + 57 integration tests
green** (integration count up from 55 — the guest realtime tests), `lint`/`typecheck` clean
including the new `@vinkin/guest-web` package. Known gap carried over: still no organizer
self-approve-contribution UI (flagged in both PV9 and PV10 reports now).

**PV11 done** (`milestone-reports/PV11.md`, owner-scoped brief: "operational rather than
consumer-facing… must not introduce new financial semantics… avoid turning PV11 into a
broad internal admin platform"): operations console — a Next.js app
(`apps/operations-console/`) letting an authorized operator search vinks and inspect every
table one touches (participants, contributions, card, purchase authorizations, settlements,
recovery, ledger — genuinely balance-checked, outbox delivery status, state history, audit
log) on one page, plus the two "safe simulation controls" PV12 will actually need (merchant
authorization + capture — no real terminal exists for the pilot). **D17**: operator identity
is a shared password + typed name, not per-operator accounts — deliberately, matching the
brief's own "avoid a broad admin platform" instruction; revisit trigger is PV12 itself
(multiple operators on rotating shifts). The two action routes call the exact same PV6
application commands the existing `/internal/simulator/*` surface calls — no new financial
logic, only operator auth + audit logging layered on top. Caught + fixed a real UI bug during
end-to-end testing: the Capture form's own `key` prop (added to satisfy a lint rule) caused
React to remount it the instant a capture succeeded — destroying the success message before
the operator could see it, even though the backend had genuinely completed the settlement
correctly every time. **170 tests green** (apps/api up to 60, +3 for ops), `lint`/`typecheck`
clean including `@vinkin/operations-console`; automated Playwright exit-gate test drives a
full inspect-and-complete cycle through the real console UI against the real backend.

**PV12 prep — funnel analytics done** (`milestone-reports/PV12-prep-analytics.md`;
**not PV12 itself** — that exit gate needs an actual closed campus pilot with real people,
which no code satisfies; owner chose this over a survey flow or a disclosure audit when
asked how to prepare). **D18**: four of PV12's five measurable exit-gate numbers are pure
queries over existing tables (no new instrumentation); a new `analytics_events` table +
`POST /api/v1/analytics/events` (public, rate-limited) exist only for the one real gap —
client-side failure/abandonment visibility that persisted state structurally can't show.
Both client apps report a small named event set (`apps/guest-web/lib/analytics.ts`,
`apps/mobile/lib/core/analytics/analytics.dart` — the latter finally wiring PV9's
`Analytics` stub to the backend); the ops console's new `/analytics` page shows all six
numbers with the pilot's own thresholds. Caught + fixed a real bug while touching guest-web:
a leftover debug loading-state readout from PV10's investigation had been shipping to real
users since PV10, undetected because no test asserted the loading state's text content.
**63 backend tests green** (up from 60); verified end-to-end by re-running guest-web's own
E9 test and confirming its real browser-generated events landed in the database and appear
correctly in the dashboard.

**PV13 done** (`milestone-reports/PV13.md`, owner-directed correction after reviewing the PV9
app: "technically functional but not product-ready" — didn't resemble vinkin.org, didn't
clearly split a bill, excluded the organizer from contributing, treated any non-member
username as a dead end. Full rebuild, not patches, per the brief's own instruction). Fetched
vinkin.org's real compiled CSS/HTML directly and wrote `docs/design/vinkin-design-system.md`
(exact colors/fonts/shapes/copy, not an approximation); built a full Flutter design-token +
component system and **actually wired the real theme in** (`buildVinkTheme()` existed since
earlier this pass but was never connected to `MaterialApp.router` until now — the old
Material-default theme and its entire parallel design system are deleted, not superseded);
rebuilt Home/Create-Vink(5 steps)/Live-Lobby/Profile/onboarding on it; restyled guest-web onto
the identical tokens (still Next.js, not converted to Flutter). Organizer's own "Pay my $X"
now goes through the exact same `POST /contributions/authorize` path every participant uses
— no shortcut. Unknown usernames offer a guest path (organizer-initiated `inviteGuestCommand`,
reusing D14's guest-identity/token machinery) instead of a dead end. One small, deliberate
backend addition: a plain read, `VinkReader.listContributionsByVink`, feeding the lobby's
per-participant paid/processing/waiting status — additive only, no D15/ledger/settlement
impact. The rewritten `integration_test/e1_test.dart` (the brief's own fully scripted $120
Vink journey) caught and fixed four real defects on its first real run: an ambiguous duplicate
"Start a Vink" button; the category picker offering `RESTAURANT`/`HOTEL`/`FUEL`/`CAR_RENTAL`,
which the domain's own policy layer has always rejected (`policyForCategory`,
`packages/domain/src/policy.ts` — three of those were never actually enabled, PV9's original
picker already knew to exclude them and PV13 briefly regressed that); a step that swallowed
API errors silently; and a bottom-sheet layout overflow. **23/23 Flutter tests green**,
`flutter analyze` clean; **36/36 application + 63/63 apps/api tests green**
(`VINKIN_INTEGRATION=1`), repo-wide `typecheck`/`lint`/`format:check`/`guard` clean; guest-web's
own `next build` + `tsc` + `eslint` + Playwright E9 all clean. Known gaps (flagged in the
report, not hidden): no freeform Vink name/merchant field exists anywhere in the domain (the
brief's "Purpose" step framing doesn't map onto a real field — flagged as a product question,
not silently added); the 13 named screenshots and the explicit vinkin.org side-by-side visual
comparison were not produced as a deliverable set — `flutter test -d <device>`'s
`takeScreenshot()` doesn't persist files without `flutter drive` + a driver script, discovered
too late in this pass to wire up.

**PV13 Screenshots done** (`milestone-reports/PV13-SCREENSHOTS.md`): resolved PV13's own
flagged screenshot-capture gap and delivered the 13 official product screenshots. Root cause
of the earlier gap: `flutter test -d <device>`'s `takeScreenshot()` only captures pixels —
persisting them needs `flutter drive` + `integration_test/integration_test_driver_extended.dart`'s
`integrationDriver({onScreenshot})` (a different file than the un-parameterized
`integration_test_driver.dart` the prior report guessed at; confirmed by reading the installed
SDK source). New: `apps/mobile/test_driver/integration_test.dart` (the driver) and
`apps/mobile/integration_test/screenshot_test.dart` (one continuous real Vink lifecycle —
create → add people → split → review → open → organizer pays own share → member/guest
contributions → live FUNDED → real-swept card → merchant simulation → live COMPLETED, on a
freshly-created "iPhone 16 Pro (Screenshots)" simulator); `apps/guest-web/tests/screenshots.spec.ts`
for the guest side; `apps/guest-web/scripts/compose-screenshots.mjs` for the contact sheet,
device-frame compositions, and website comparison (Playwright-rendered HTML/CSS — no
ImageMagick/ffmpeg/cwebp in this environment); `docs/design/website-screenshot-plan.md`.
**D19** (finding, not yet a decision): `fundedAmountMinor` only updates atomically once the
*last* participant contributes (`resolveFunding`, D5) — individual authorizations never move
the pooled total, so the "$90 of $120, 3 of 4 paid" progress-bar moment vinkin.org's own hero
mockup visually implies does not exist as a reachable state today; flagged for the owner,
unchanged (a settlement-semantics question, out of scope to alter unilaterally). The capture
run itself caught and fixed three real defects along the way: a duplicate "Start a Vink"
button ambiguity, a stale-response race in the lobby's realtime refresh (overlapping WS-
triggered fetches could complete out of order and overwrite newer data with older — fixed
with a monotonic request-sequence guard), and a bottom-sheet layout overflow on this device
size. **23/23 Flutter tests green**, guest-web `tsc`/`eslint` clean, both Playwright suites
(E9 + screenshots) green together.

**Track change (2026-07-20):** the owner supplied a new engineering plan
(`ENG0`–`ENG15`) that now governs everything below PV13 — UX owns customer-facing product
decisions going forward; this engineering track owns correctness, reliability, contracts,
deployment, auth, security, observability, provider integration, and production readiness.
Sequence: `ENG0 → ENG1 → ENG2 → ENG3 → ENG4 → ENG5 → ENG6 → ENG7 → ENG8 → ENG9 → PV12 → M0 →
ENG12 → ENG13 → ENG14 → ENG15`.

**ENG0 done** (`milestone-reports/ENG0-BASELINE.md`): baseline certified at commit `fe876d7`
(owner to tag `eng0-baseline` once this milestone's two fixes are committed — see the report
for the exact commands; per house rule, git actions are provided, not run, here). Found and
fixed two real defects in the verification suite itself: `pnpm test` was silently skipping
every integration test (`turbo.json`'s `test` task declared no `env` key, and Turborepo 2.x
defaults to strict env mode, so `VINKIN_INTEGRATION=1` never reached the task — 19 of
`@vinkin/api`'s suites were `# SKIP`, undercounting every prior milestone's "N tests green" by
what actually ran under the documented command; fixed by adding `"env": ["VINKIN_INTEGRATION",
"VINKIN_OTEL_ENABLED"]`), and `pnpm format:check` failing on two gitignored, Next.js
auto-generated `next-env.d.ts` files never meant to be hand-formatted (fixed via
`.prettierignore`). Re-verified full suite green: **191 Node/TS tests + 23 Flutter tests**,
lint/typecheck/format:check/guard all clean. One defect documented but deliberately not
fixed (out of baseline-certification scope, real code change): `flutter analyze` now reports
7 info-level issues (exit 1) — SDK drift since earlier reports, one of which
(`use_build_context_synchronously` in `add_person_sheet.dart:242`) is a real async-gap
correctness lint worth a look during ENG1/ENG3, not a blind fix here. No obsolete/experimental
code found to quarantine. One design system per client reconfirmed by reading the actual
wiring, not docs (`buildVinkTheme()` → `MaterialApp.router` in mobile; guest-web's
`globals.css` on the same tokens).

Carried-over PV13 gaps (still open, unchanged by ENG0): the visual side-by-side comparison
already exists (`artifacts/product-screenshots/vinkin-website-product-comparison.png`) but
hasn't had owner eyes on it yet; a live-UI proof of the custom-split mismatch scenario is
still open. Machine notes: pnpm 11 + PostgreSQL 16 + Redis + Flutter SDK +
Playwright(Chromium) all installed (via brew/dart/npm; still no Docker) — the local API
server must be started with
`VINKIN_PUBLIC_BASE_URL=http://127.0.0.1:3100 OPERATIONS_CONSOLE_BASE_URL=http://127.0.0.1:3200`
(the CORS-allowed origins) or guest-web's/ops-console's own Playwright suites fail on CORS,
not on anything in their own code — this bit the screenshot pass itself mid-session (a plain
server restart silently dropped the override) and cost real debugging time; still worth a
`.env`/start-script fix (flagged again in ENG0-BASELINE.md as a candidate ENG1/ENG3 item).
Sandbox S1–S12 blocked on keys.

**ENG1 in progress.** The owner refined the plan's priority order (2026-07-20): idempotent
creation before setup recovery before retry classification before broader duplicate-tap
protection before timers before the merchant-payment command split, executed as separate
reviewable slices rather than all of ENG1 at once.

- **ENG1 §1 done** (diagnose + fix the indefinite "Connecting…" defect, folded into this same
  session before slicing began): root cause was `RealtimeClient`'s WebSocket connect call
  having no `connectTimeout` (the package's own docs: "if connectTimeout is null … the
  connection process will never time-out") — a stalled TCP handshake could hang for the OS's
  own timeout (minutes), and the client's retry logic swallowed connection errors rather than
  surfacing them, leaving the Lobby screen on "Connecting…" indefinitely with no error/retry
  path. Fixed: `IOWebSocketChannel.connect(..., connectTimeout: 8s)`, connection errors now
  propagate to listeners, and — per ENG1 §3's own principle — the Lobby screen no longer
  depends solely on the WebSocket for first paint; it fetches the snapshot over plain HTTP in
  parallel (whichever resolves first renders the lobby). Also added a `receiveTimeout: 15s`
  to the shared Dio client (it only had `connectTimeout` before). Verified via a standalone
  probe (unbounded hang past 12s without the fix; clean 8.0s `TimeoutException` with it) and
  a full build + real run on a booted iOS Simulator against the real local backend, driven by
  the project's own `integration_test/e1_test.dart` (real touch injection, no mocks) — passed
  clean.
- **ENG1 Slice 2 done** (`milestone-reports/ENG1-SLICE-2-IDEMPOTENT-CREATION.md`): idempotent
  Vink creation. Client-generated idempotency key (mobile: `core/networking/
  idempotency_key.dart`, no new pub dependency), server-side replay inside
  `createVinkCommand`, and migration 0009's `UNIQUE (organizer_user_id,
  creation_idempotency_key)` index as the actual guard — PostgreSQL uniqueness is the final
  guard per the hard rule, the application-layer pre-check is only an optimization ahead of
  it. A genuine concurrent-race test (`Promise.all` double `POST /vinks`, real Postgres)
  proves the database constraint path, not just the sequential lost-response-retry path.
  **197 Node/TS tests** (up from 191) **+ 23 Flutter tests** green; re-ran the real
  `e1_test.dart` against a freshly restarted backend to confirm no regression, then spot-
  checked the database directly to confirm the real client-generated key (not a server
  default) made the full round trip. Caught a real environment defect along the way (not new
  code): a stale `node src/server.ts` process from earlier in the session was still running
  pre-migration code, which started violating the new NOT NULL column on every insert —
  killing and restarting it fixed it; flagged as a reminder this environment has no process
  supervisor to keep a running server and a migration from silently drifting apart.

**ENG1 Slice 3 done** (`milestone-reports/ENG1-SLICE-3-SETUP-RECOVERY.md`): interrupted setup
recovery. Fixed a real dead end — `/vinks/:vinkId` routed a DRAFT Vink straight into
`VinkLobbyScreen` (built for OPEN-and-beyond live/funding state), so Home's own "Finish setup"
button led nowhere useful. A server-persisted DRAFT now resumes at its exact valid step (new
`/create-vink/resume/:vinkId`, decided from the server snapshot via a pure, unit-tested
`resumeStepFor` — mirrors `computeAllowedActions`), and the decision is state-driven from two
independent places (Home's card *and* `VinkLobbyScreen`'s own DRAFT redirect), not tied to
which button was tapped. An unsaved pre-network local form (Purpose/Total, before any Vink
exists) is durably persisted (`LocalDraftStore`, reusing `flutter_secure_storage` under its
own key — no new pub dependency) and offered back as resume-or-discard the next time the user
starts a Vink, instead of silently vanishing on a kill. **Checked the ratified decision log
before implementing discard**: G13 is CLOSED (owner, 2026-07-17) — "DRAFT cancellation stays
unmodeled" — so persisted-draft "discard" deliberately stays exactly what `_confirmLeave()`
already promised (saved, resumable later), not a fabricated client-only hide. **27 Flutter
tests** (up from 23), `flutter analyze` unchanged at its documented 7 pre-existing info-level
issues. Verified with two new real-device integration tests (real touch injection, real local
backend, no mocks) — including a full add-participant → interrupt-before-split →
simulated-relaunch → resume-at-Split → finish-and-open cycle, confirmed exactly one Vink ever
existed. Getting that real-device proof green took much longer than the fix itself, entirely
from two **local environment** issues unrelated to the product: the Mac's disk hit 98% full
mid-session (misleading, differently-shaped failures on every retry), and repeated
`simctl erase` cycles degraded the CoreSimulator daemon until installs themselves started
failing — fixed by a full `CoreSimulatorService` restart, not just re-erasing the device;
documented in the report as a lesson for future heavy real-device iOS sessions.

**ENG1 Slice 4 done** (`milestone-reports/ENG1-SLICE-4-RETRY-AND-DUPLICATES.md`): typed retry
classification and duplicate-action protection. Audited all nine named mutating actions
against what the backend already guaranteed before touching anything — most (create,
contribute, split, open) were already solid or only needed better client messaging. Two real
defects found and fixed: `_cancelVink()` in `vink_lobby_screen.dart` had **zero error
handling** (any failure, including a harmless double-tap, propagated unhandled); and
`inviteGuestCommand` had **zero duplicate protection** (a lost-response retry or double-tap
created a second, genuinely separate guest participant every time — migration `0010` +
`INVITE_ALREADY_SENT` fixes it, rejecting a detected duplicate rather than replaying it, since
D14 means the raw guest token can never be recovered for a true replay). New
`core/errors/failure_classifier.dart` gives every screen the same eight typed categories
(`retryable`/`conflict`/`expired`/`authenticationRequired`/`alreadyCompleted`/`validation`/
`terminal`/`unknown`) driving whether a retry shows, whether state refreshes first, and
whether the user must sign in again — replacing seven screens' worth of ad-hoc
`ApiException`/`humanErrorMessage` handling. Deliberately never auto-retries — every retry is
user-triggered, per the brief's own caution against auto-retrying financial mutations without
a positive idempotency guarantee. Found and fixed a related gap while wiring it: nothing told
the app's in-memory auth state a session was dead after `ApiClient`'s own refresh-retry
already failed (new `AuthController.expireSession()`). "Open Vink" now specifically recognizes
a duplicate-tap-that-actually-succeeded and proceeds to the lobby instead of erroring. **203
Node/TS tests** (up from 197) **+ 54 Flutter tests** (up from 27), including a genuine
concurrent-race integration test against real Postgres for the new invite-guest guard.
Re-verified `e1_test.dart` and the Slice 3 setup-recovery test on a real booted simulator
after all changes — clean. Same stale-process pattern as ENG0/Slice 2 bit the verification
pass again (API server on :3000, guest-web's Playwright `webServer` reusing a stale :3100
build) — not new code, same known recurring friction, same fix (kill and let it restart
fresh).

**ENG1 timer semantics done** (`milestone-reports/ENG1-TIMER-SEMANTICS.md`): the real defect
closed was `apps/mobile`'s create-Vink flow computing and sending `now + 24h` as
`submissionDeadline` — a client-hardcoded product-timing decision, exactly what the ENG1
brief warns about ("The current 18–23-hour behavior must not remain accidentally hard-coded").
**Checked first, before changing anything**: `docs/spec/open-questions.md` G9 is still OPEN;
the Spec's own §14 "Recommended initial timing" (T-15s/T+60s) is a default to implement, not a
closed decision; no doc anywhere (including the concurrent UX-track's phase-0–10 docs, D36 as
of this pass) specifies a target open-window duration — no "5–7 minutes" decision exists to
apply. So values were preserved exactly (`VINK_OPEN_DURATION_SECONDS` defaults to `86400` =
24h, `VINK_PROCESSING_GRACE_SECONDS` to `60`, `VINK_SWEEP_INTERVAL_SECONDS` to `10` — all
matching prior hardcoded behavior) while making them real, server-side, Zod-validated config
(`apps/api/src/config/env.ts`); `CreateVinkInput.submissionDeadline` is now optional
(`CommandContext.timers` threads config in, defaulting identically when omitted), and the
Flutter client stopped computing/sending it — the server is now the one source of truth.
`VINK_CONTRIBUTION_CUTOFF_SECONDS` (named in the brief's own env-var list) was deliberately
**not** added: the Spec's T-15s soft-close doesn't exist as enforced behavior yet, and a config
value with nothing behind it would be dead/misleading config, not a decision to guess at
silently — flagged as an honest gap instead. **237 Node/TS tests** (up from 203) **+ 54
Flutter tests**, plus a real-device re-run of the full E1 golden path with the client
genuinely no longer sending a deadline — clean. Verification surfaced (and this milestone
fixed as a byproduct, since they were blocking it, though **neither is this milestone's own
defect**) two more flavors of accumulated same-session cruft: 5,616 stale BullMQ repeat-job
keys in Redis from a full day of `kill`-without-graceful-shutdown server restarts, and Postgres
rows from earlier restarts colliding with the in-memory mock provider's reset ID counters
(one poisoned row was aborting the sweep mid-loop before it ever reached healthy newer
vinks — the actual cause of what first looked like "card provisioning is broken"). Both
cleaned up; a documented dev-data-reset habit is worth adding if long multi-restart sessions
keep recurring — this is the third distinct cruft flavor this ENG1 pass alone.

**ENG1 §7 done — already satisfied, no code change**
(`milestone-reports/ENG1-MERCHANT-PAYMENT-SPLIT.md`): audited whether "organizer contributes
personal share" and "organizer spends the completed pooled payment" are unambiguous, distinct
engineering intents. They already are: `authorizeContributionCommand` (organizer's own share
— the same command every participant uses, PV13's "no shortcut" rule),
`authorizeMerchantPurchaseCommand` ("RequestMerchantAuthorization"), and
`settlePurchaseCommand` ("CaptureMerchantPurchase") are three distinctly-named commands with
no naming or code-path overlap, and both the simulator surface and the PV11 operations
console call the same two merchant-side commands under the same names. **One real finding,
flagged to the owner rather than resolved silently**: the brief's own "organizer spends"
framing implies an organizer-initiated in-app action, but VinkIn's actual design has the
organizer tap a physical/virtual card at a real register — the *merchant's* terminal (ops
console, standing in for it during the pilot) triggers authorization/capture, not the
organizer. Confirmed with the owner: no organizer-facing "spend" trigger needed; the existing
architecture already correctly reflects this. This closes out ENG1's own numbered list (§1
Connecting-hang fix, Slice 2 idempotent creation, Slice 3 setup recovery, Slice 4 retry
classification, timer semantics, §7 merchant-payment split).

**ENG2 Slice A done** (`milestone-reports/ENG2-SLICE-A-BOUNDARY-VALIDATION.md`, owner-approved
scope: "the 3 concrete gaps"): every one of the 28 blind `request.params as {...}` casts across
`vinks`/`contributions`/`purchases`/`recovery`/`realtime`/`sharing` routes replaced with real
Zod validation (`apps/api/src/middleware/params.ts` — `z.uuid()` for every domain id, all
confirmed `randomUUID()`-backed; a deliberately loose schema for the public join surface's
`publicCode`, since a strict-format 400 would leak the valid code shape to an anonymous prober
where today's uniform 404 doesn't). Malformed params now get `400 VALIDATION_FAILED` for real
HTTP routes (reusing `app.ts`'s existing global `ZodError` handler — no new response-shaping
code needed) or a dedicated `4400` WebSocket close code for the one route that can't send an
HTTP body (`GET /api/v1/vinks/:vinkId/live`). `POST /api/v1/vinks/:vinkId/{share-links,qr}` →
`GET`, matching the handler's own long-standing "this is a query, not a command" comment;
confirmed zero client impact first (no app in this repo called either route yet). New:
`docs/architecture/api-versioning-policy.md` — additive-vs-breaking rules for `/api/v1/*`,
explicit non-versioning of the two internal-only surfaces, a deprecation process sized to
VinkIn's actual three-first-party-caller reality. New tests for both the HTTP 400 path and the
WebSocket close-code path; `pnpm typecheck/lint/format:check/guard` clean repo-wide, `apps/api`
84/84 tests green (including the UX-track's own Slice I4 automatic-invitation-delivery tests,
which landed mid-milestone in the same route file this slice was editing — merged with no
conflict, re-verified after). The only failures anywhere in the repo-wide suite are 8
pre-existing `apps/guest-web` Slice I3/I3A terminal-copy tests from that same concurrent
session's own just-landed, not-yet-green work — confirmed via `git log` as already-committed,
untouched by this slice.

Next: ENG2's own remaining scope — typed per-screen API contracts (§1) and interaction event
contracts (§3) — stays deferred pending alignment with the UX-track's own Button Interaction
Contracts work (the owner's explicit scoping decision when Slice A was approved). Otherwise,
per the owner's original ENG0–ENG15 milestone sequence, ENG3+ is next in line — awaiting the
owner's direction on which one. `PV12` (the actual closed pilot) remains an owner/operational
decision deferred until ENG0–ENG9 close.

## Hard rules (from the Spec — never relax to make something pass)

- Ledger is append-only, balanced, integer minor units; DB triggers enforce it
  (`docs/architecture/04-database-schema.md` §5). Corrections are reversals.
- Idempotency keys are server-derived stable operation ids (§12; builders in
  `packages/payment-provider/src/operation-ids.ts`); PostgreSQL uniqueness is the final
  guard, Redis only an optimization.
- Every financial transition: single PG transaction, row lock, outbox event (§27, §29).
- One resolver code path decides FUNDED/EXPIRED exactly once (doc 03 §1, D5).
- Participants are never charged beyond their explicitly approved maximum (§4.7).
- Provider SDKs importable only inside `packages/payment-provider` adapters (§42/§43).
- **Every adapter must pass `packages/payment-provider-contract-tests` before sitting behind
  the orchestrator; skipped tests need written justification** (D7).
- **The app branches on `provider.capabilities` flags — never assumes a capability because
  one provider has it** (§21, D7).
- Webhooks: verify signature, store raw, dedupe on `(provider, provider_event_id)`, decide by
  provider `occurred_at` — never arrival time (§28).
- **State names**: the PV plan's vocabulary is canonical everywhere (D11); never reintroduce
  retired names (doc 03 appendix has the mapping). Every transition emits its named domain
  event atomically (D12); all business behavior goes through application commands — no
  transport mutates an aggregate (D13).
- Spec/product changes are flagged to the owner, never made silently (§9). New
  interpretations get a decision-log entry (PROPOSED until ratified).

## How to work here

- Owner runs all git commands themselves (explicit preference — never `git init`, commit, or
  push for them; provide commands instead).
- Milestone discipline per §9/§45: no milestone is done backend-only or UI-only; each ends
  with a report in `docs/architecture/milestone-reports/`.
- Tests: `npm test` in each package (Node ≥ 23.6, zero deps — native TS type-stripping; code
  is erasable-syntax-only, so no TS enums/namespaces/parameter properties). Typecheck needs
  `npm install --no-save typescript@^5.8 @types/node@^24` at repo root (commands in README).
- Machine notes: Node 25, pnpm 11, Flutter SDK all installed. The repo now lives at
  `~/code/vinkin` (D9 executed — space-in-path caveat gone).
- Be explicit about what is unverified; prefer running the real tests over describing them.
