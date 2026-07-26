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

**ENG2 closed** (`milestone-reports/ENG2-CLOSURE-TYPED-CONTRACTS.md`): the UX-track's Phase 5
(Button and Interaction Contracts, `docs/design/phase-5-button-interaction-contracts.md`)
landed and unblocked ENG2's deferred remainder — typed screen/view-model contracts and typed
interaction-event contracts, owner-directed with "ground every type and event in the approved
Phase 4/Phase 5 contracts, do not invent screens, actions, analytics events, or payloads."
New package `packages/client-contracts`: 17 screen/view-model contracts tracing to Phase 4's
14 sections (§5 expanded to §5a–c, §6 split into its organizer/member branches — four of the
17 are bare type aliases to real `packages/application` types, compile-time-proven never to
drift via `Expect<Equal<...>>`); a 46-distinct-name analytics event vocabulary tracing to
Phase 5's 31 `Analytics:`-bearing contracts out of 45 (the other 14 verifiably carry none);
ownership/privacy rules (`client-contracts-ownership-and-privacy.md`); a versioning policy
relating to, not duplicating, ENG2 Slice A's `api-versioning-policy.md`
(`client-contracts-versioning-policy.md`); a traceability map mechanically cross-checked
against the code (`client-contracts-traceability.md`); 14 tests (12 compile-time/contract
tests in the new package, 2 in `apps/api` Zod-parsing real event literals against the actual
wire schema). Two real gaps surfaced and flagged rather than silently resolved: the domain
`Vink` has no freeform purpose/name field at all (Phase 4 requires one visibly on four
screens — same gap PV13 already flagged), and today's shipped analytics event names
(PV9/PV12-prep) predate Phase 5 and don't match its vocabulary (documented as a known-drift
table, not silently renamed, since `apps/operations-console`'s PV12-prep dashboard may already
key on the old names). Explicitly does not rewire `apps/mobile`/`apps/guest-web` to consume
these types — that's implementation work, out of scope by the owner's own "stop after ENG2,
do not begin ENG3" instruction. `pnpm typecheck/lint/format:check/guard` clean across all 10
packages; `apps/api` 97/97, `packages/client-contracts` 12/12,
`apps/operations-console` 2/2 (server up with the documented CORS env vars); the 10 `apps/
guest-web` failures under the same run are the concurrent UX-track session's own pre-existing,
not-yet-green Slice I3/I3A work — confirmed unrelated via `git log`/`git status`.

**ENG2 is fully closed.**

**ENG3 in progress** (the owner supplied ENG3's full original brief this session — "Client
Reliability Architecture," covering `apps/mobile`, `apps/guest-web`, and the realtime layer,
without making visual/UX decisions). Before writing any code, three audits (two backgrounded
`Explore` agents, one done directly) checked ENG3's ~30-item checklist against real code; the
owner chose a 6-slice execution order via `AskUserQuestion`.

**ENG3 Slice 1 done** (`milestone-reports/ENG3-SLICE-1-REALTIME-BACKBONE.md`): realtime
backbone hardening — reconnect backoff+jitter (replacing a flat 2s retry on both
`apps/mobile`'s `RealtimeClient` and `apps/guest-web`'s `useGuestRealtime`), an
application-level ping/pong heartbeat (browsers/Dart don't expose the WebSocket protocol's own
ping/pong to app code, so a new `apps/api/src/modules/realtime/routes.ts` message handler
answers one built at the app layer instead), and lifecycle-aware reconnection (a Flutter
`AppLifecycleListener` embedded directly in `RealtimeClient` pauses retries while backgrounded
and reconnects on resume; a guest-web `visibilitychange` listener does the same on tab
return). **Caught and fixed a real bug the audit surfaced**: guest-web's per-live-message
session refetch had no request-sequence guard, so an older-issued request that resolved later
could overwrite fresher state with stale data — the exact bug class `vink_lobby_screen.dart`'s
`_snapshotRequestId` already guarded against on the organizer side (PV13-SCREENSHOTS.md), never
applied to guest-web until now. The regression test for this fix was verified to actually catch
the bug (reverted the fix, confirmed the test fails; restored it, confirmed it passes). Also
surfaced and resolved (environment, not product): the exact "poisoned dev database" cruft
`milestone-reports/ENG1-TIMER-SEMANTICS.md` already documented once, this time compounded by a
stale server process silently squatting on port 3000 across a "restart" — fixed by actually
killing it and resetting the local dev DB/Redis. **98/98 `apps/api`, 111/111 `apps/mobile`
(flutter analyze clean), 41 passed/8 pre-existing-failed `apps/guest-web`, 2/2
`apps/operations-console`**, `pnpm typecheck/lint/format:check/guard` clean across all 10
packages. One known gap flagged, not fixed (another session's in-flight work, out of scope):
`e1_test.dart`'s real-device Register flow now mismatches `register_screen.dart`'s 5-field
layout (a D19/D27 contact-capture addition), blocking a full real-device Lobby re-run for this
slice specifically — Flutter changes were instead verified via `flutter analyze` + the full
`flutter test` suite.

**ENG3 Slice 2 done** (`milestone-reports/ENG3-SLICE-2-TYPED-REPOSITORY.md`): Flutter typed
repository + command-state layer — addressed the audit's "no repository files exist anywhere
under `lib/`" and "three separate ad hoc `bool _busy` + `String? _error` pairs on
`vink_lobby_screen.dart` alone" findings. New `lib/core/commands/command_state.dart`
(`CommandState<T>`/`CommandRunner<T>`, a typed idle/in-progress/success/failure lifecycle
replacing ad hoc bool+String pairs, with two deliberate design choices preserving exact
pre-existing per-call-site behavior: `onFailure` can suppress a failure to idle — reproducing
cancel's refresh-and-suppress-on-conflict rule — and `onSuccess` is awaited *before* `state`
becomes `Success`, matching handlers that kept their spinner on through a follow-up refetch)
and `lib/core/repositories/vink_repository.dart` (typed methods over `ApiClient`, scoped to
exactly what Home/Activity/Lobby call today, not a speculative full REST client). Migrated
`home_providers.dart`, `activity_providers.dart`, and `vink_lobby_screen.dart` (its three
command flows now use `CommandRunner`; its read paths call the repository; the presentational
`_LobbyBody`/`_ParticipantLobbyBody` widgets untouched via backward-compatible getters).
**Deliberately did not migrate Create Vink** (legacy or canonical) — both are actively being
extended by the concurrent UX-track session this same day (new "Slice I5B (D40)" tests
appeared mid-session); touching them risked a real conflict with in-flight work, so that
migration is flagged as follow-up, not silently skipped. One intentional, flagged behavior
change: `CommandRunner` catches `Object`, not narrowly `ApiException` (two original handlers
did), closing a latent gap `classifyFailure` was already designed to handle gracefully. **7 new
tests** for `CommandRunner` (including a dedicated test proving `onSuccess` is genuinely
awaited before success, not fire-and-forget) — `flutter analyze` clean (same 11 pre-existing
info-level issues), `flutter test` 127/128 (the one failure is a confirmed pre-existing,
non-deterministic flake in an untracked, concurrent-session-owned test file that fails even
run alone with nothing else involved — every test this slice's own files are exercised by
passes consistently).

**ENG3 Slice 3 done** (`milestone-reports/ENG3-SLICE-3-RESILIENCE-PRIMITIVES.md`): Flutter
resilience primitives — request cancellation, network reachability handling, app-version
enforcement, the three Flutter checklist items the original audit found entirely Missing.
`ApiClient` gained an optional `CancelToken` on every method (additive) plus
`ApiException.isCancelled`; wired into the Lobby's read paths (cancelled on `dispose()`),
deliberately not the mutating commands (a sent financial command should complete server-side
regardless of screen lifetime). New `ConnectivityService`/`isOnlineProvider` (new
`connectivity_plus` dependency) — deliberately not wired into any screen's visual "you're
offline" presentation (out of scope, no visual/UX decisions per ENG3's own brief), but
`RealtimeClient` now reconnects immediately (bypassing backoff) on a genuine offline→online
transition, the connectivity half of ENG3's "Wi-Fi to cellular" exit-gate scenario. App-version
enforcement end-to-end: a new `VINKIN_MINIMUM_APP_VERSION` env var (unset by default, fail-open
on anything malformed) gates a new `app.ts` `onRequest` hook returning `426` for a client below
it; `ApiClient` now sends `x-app-version` on every request (new `package_info_plus`
dependency); `APP_VERSION_UNSUPPORTED` reuses the existing `terminal` failure category and
`human_errors.dart`'s table — no new UI screen invented. One required fix, not scope creep:
adding `CancelToken` broke override-compatibility for the shared `FakeApiClient` test double,
fixed as a direct consequence of the signature change. **38 new tests** across six files (4
`ApiClient`, 9 `ConnectivityService`, 5 `RealtimeClient`, 1 `failure_classifier`, 19
`app-version.ts` + `app.ts`) — `flutter analyze` clean (same 11 pre-existing issues), `flutter
test` 148/148, `apps/api` 131/131, `pnpm typecheck/lint/format:check/guard` clean across all 10
packages.

**ENG3 Slice 4 done** (`milestone-reports/ENG3-SLICE-4-DEEP-LINK-ROUTING.md`): deterministic
deep-link routing — but corrected the original audit's own framing first. `/g/:token` is
`apps/guest-web`'s route (Phase 4 §13), never the organizer app's — guests don't use
`apps/mobile` at all (Phase 0 §1); building guest-token handling into the organizer app would
have been inventing scope, not fixing the flagged gap. The actually-meaningful target is
`/vinks/:vinkId`, the existing Lobby route, reachable now via a new custom URL scheme
(`vinkin://vinks/:vinkId`, new `app_links` dependency) — deliberately not Universal Links/App
Links, which need a real owned domain + Apple Developer Team ID that don't exist until ENG4
stands them up; guessing at that infrastructure now was explicitly avoided. New
`lib/app/deep_links.dart` (`deepLinkRouteFor`, a pure top-level function, same pattern as
Slice 1/3's `reconnectDelay`/`shouldReconnectOnConnectivityChange`) and
`lib/app/deep_link_listener.dart` (`DeepLinkListener`, injectable functions not the `AppLinks`
class itself, mirroring Slice 3's `ConnectivityService` pattern — no platform-channel mocking
needed in its tests). No UI change — no existing "share with a co-organizer" feature exists to
attach a button to; this is capability-only infrastructure, the same "built, not yet consumed
by a screen" pattern as Slice 2's repository layer and Slice 3's `isOnlineProvider`. **10 new
tests** across two files — `flutter analyze` clean (same 11 pre-existing issues), `flutter
test` 158/158, re-verified twice including once after a concurrent-session change landed on
`vink_lobby_screen.dart` mid-slice (Slice I2C, participant realtime support) — merged cleanly.

**ENG3 Slice 5 done** (`milestone-reports/ENG3-SLICE-5-GUEST-WEB-HARDENING.md`): guest-web
hardening. One of the three flagged items — mobile-browser tab-resume recovery — turned out
already resolved as a side effect of Slice 1's own `visibilitychange` work; verified, not
re-built. Server-rendered invite context + immediate first render fixed together: a new
Server Component fetch in `app/join/[publicCode]/page.tsx` seeds `JoinExperience`'s React
Query as `initialData`, so the organizer/purpose/amount are in the actual server HTML — proven
by a new Playwright test with JavaScript disabled entirely, not just "loads fast after
hydration." The blanket `!hasMounted` render gate was narrowed to the one case it was ever
actually needed for (a *returning* guest's own session lookup), since `effectiveSession` is
provably always `null` pre-mount. Expired-token handling made consistent: a returning guest
whose stored token has since expired now sees the same `GUEST_UNAUTHENTICATED` copy the
initial `/g/:token` redemption path already showed, reusing existing copy and an existing UI
pattern — previously it silently fell through to a bare join form. Both new tests initially
failed for an unrelated, mundane reason (the test setup's own `/open` call omitted a required
empty JSON body, leaving the Vink stuck in DRAFT) — root-caused against `e9.spec.ts`'s own
working call and fixed in the test files. **2 new tests** — `pnpm typecheck/lint/format:check/
guard` clean, `apps/guest-web` 43 passed/8 pre-existing-failed (same confirmed-unrelated Slice
I3/I3A gap as every prior ENG3 slice), including the full E9 golden path passing.

**ENG3 Slice 6 done** (`milestone-reports/ENG3-SLICE-6-ERROR-MAPPING.md`): typed error mapping
completion — the last of the six owner-approved slices. `login_screen.dart`/`register_screen.dart`
were the only two mutating screens still bypassing `failure_classifier.dart`/`CommandRunner`,
hand-rolling their own `bool _submitting`/`String? _error` pairs and ad hoc code comparisons;
both migrated to the same `CommandRunner` pattern Slice 2 established. Found and fixed a real,
disclosed ordering bug along the way: `classifyFailure()` checked the blanket `error.isAuthError`
(401) before any specific-code-set check, safe only by coincidence until login needed it —
`apps/api`'s `authErrorStatus` sends `INVALID_CREDENTIALS` at a genuine 401, which the old
ordering would have misclassified as "your session died" instead of "wrong password, try again."
Reordered so specific codes (`_alreadyCompletedCodes`/`_conflictCodes`/`_expiredCodes`/
`_terminalCodes`/`_validationCodes`) are all checked before the blanket auth fallback; added
`INVALID_CREDENTIALS`/`USERNAME_TAKEN` to `_validationCodes` and `human_errors.dart`, preserving
the exact copy the two screens' old ad hoc strings already used. The same reordering fixed a
second, previously-uncaught latent bug for free: `GUEST_UNAUTHENTICATED` was already in
`_expiredCodes` but unreachable at its real 401 status (the pre-existing test only ever exercised
it at an artificial 410) — now correct and regression-tested at the real status. One deliberate,
disclosed simplification on register: `VALIDATION_FAILED`'s old screen-specific copy ("Username
needs 3+ letters/numbers...") is now the shared generic message, since `ClassifiedFailure`
doesn't carry the original error code and widening it for one screen's preference wasn't worth
it — flagged in a code comment, not hidden. Caught a real, previously-undiscovered layout bug
while writing the register widget test: no `SingleChildScrollView` around its 5-field form,
overflowing on a phone-sized viewport — Phase 4 §3 already required scroll behavior for this
exact screen ("more fields so more likely to need it"), evidently missed when the D19/D27
email/phone fields landed; fixed by implementing that already-approved requirement, not by
inventing new layout. **168/168 Flutter tests green** (up from 158), `flutter analyze` clean
(same 11 pre-existing issues), `pnpm typecheck/lint/guard` clean repo-wide; the only
`format:check` warnings are in three files this slice never touched, confirmed as the concurrent
UX-track session's own in-flight work.

**ENG3 is fully closed.** All six owner-approved slices are done: realtime backbone hardening
(reconnect backoff+jitter, app-level heartbeat, lifecycle-aware reconnection), the Flutter typed
repository + `CommandRunner` command-state layer, resilience primitives (request cancellation,
network reachability, app-version enforcement), deterministic deep-link routing, guest-web
hardening (server-rendered invite context, tab-resume, token-expiry consistency), and typed error
mapping completion. Every slice shipped with real tests (never simulated), caught and fixed at
least one genuine pre-existing defect along the way (several latent, previously-undiscovered —
the `classifyFailure` ordering bug, the register-screen overflow, the guest-web stale-refresh
race, the port-3000 double-heartbeat issue, and more, each documented in its own report), and
verified clean against the full repo-wide suite. No visual/UX decisions were made per the brief's
own explicit constraint — layout fixes were grounded in already-approved screen contracts
(Phase 4), never invented.

**UX-track Slice I6 done** (`milestone-reports/I6.md`), running concurrently with the ENG track:
Home (tagline/greeting removed unconditionally, two-section needs-attention/waiting-on-others
layout, compact progress now sourced from the server-projected `contributionProgress`
(D20/D24) rather than `fundedAmountMinor`), Activity (outcome-summary list, partial-failure
resilience on both the old and new list), and a new Vink Details screen. **D43** corrects this
slice's own first-pass Vink Details implementation before it shipped: the organizer sees only a
customer-safe AGGREGATE summary, never a per-participant breakdown; a participant sees only
their own share/outcome — matching D24/D25/D42's own "own-contribution-only" boundary
everywhere else in this app, not the wider per-participant roster the first draft built. **204
Flutter tests green** (up from 168), `apps/api` 137/137, `packages/application` 120/120,
`flutter analyze` clean at the 11-issue baseline; verified on a real iOS Simulator against the
real local backend across all three required flows (organizer, participant, and a genuinely
mixed-role account whose Activity tab renders both roles without crashing). Caught and fixed
along the way: a real regression this slice's own `VinkSnapshot.contributionProgress` field
introduced in two other tests' raw JSON fixtures, and a real disk-full environment issue
(freed with explicit owner approval — pure build caches, no project files touched).

**Invites done** (`milestone-reports/INVITES.md`, D44) — new scope outside the original I1–I11
sequence, owner-directed after comparing two aspirational mockups against the shipped post-I6
app. A real `INVITED → accept/decline` gate before an organizer-added existing member becomes
`JOINED` (`ParticipantStatus.INVITED` existed in the domain type since PV3, never assigned
until now), flag-gated end to end (`VINKIN_INVITES_ENABLED`/`FeatureFlags.invitesEnabled`): new
`acceptInviteCommand`/`declineInviteCommand` (decline reuses `removeParticipantCommand`'s exact
allocation-zeroing, landing on the canonical `REMOVED` state per D11, distinguished only by its
own outbox event per D12), a new `GET /api/v1/invites` read (deliberately separate from `GET
/api/v1/vinks`, not an overload of its `role` field), and a 4th mobile "Invites" tab plus a Home
"You're invited to…" card. The one required fix, not optional polish:
`listVinksByParticipant`'s filter changed from "non-removed" to `JOINED`-only, since without it
an `INVITED` row would silently leak into Home/Activity's normal vink list the moment the flag
went live. **Real operational finding, documented in D44, not a code defect:** the server flag
and client flag must roll out together — turning the server flag on against a client build that
still lacks the Invites tab leaves an added member permanently stuck `INVITED` with no way to
ever accept, reproduced directly by running `e1_test.dart` against a mismatched flag pair.
**219 Flutter tests green** (up from 204), `apps/api` 143/143, `packages/application` 137/137;
real-device verified end to end (organizer adds a member → member sees a real backend-confirmed
`INVITED` status → accepts through the real UI → backend confirms `JOINED` and real `GET
/api/v1/vinks` membership), plus the `e1_test.dart` rollback contract re-confirmed clean with
the flag off.

**I7 done** (`milestone-reports/I7.md`) — the second slice of the mockup-gap plan, built to
the already-ratified Phase 8 §15 spec (calm level-rise fill, explicitly not the mockups' own
liquid-physics animation, per the owner's own earlier decision this session). New
`VinkProgressVessel` (`design_system/components/vink_progress_vessel.dart`) replaces
`VinkProgressIndicator` entirely on the Lobby (organizer + participant) and Home's compact
card, flag-gated (`ink_progress_vessel`/`FeatureFlags.inkProgressVessel`), driven only by
`contributionProgress` (D20/D24) — never `fundedAmountMinor`. Two waiting-clause helpers, not
one: real names for the organizer's own Lobby (D24/D25's organizer-sees-all boundary) vs.
count-only for the participant/guest privacy-scoped view (a disclosed adaptation of Phase 6
§12's table, which assumes name data that view structurally doesn't have). **Caught and fixed
a real pre-existing gap along the way**: the organizer Lobby's progress bar had been reading
raw `fundedAmountMinor` all along, not `contributionProgress` — still exhibiting the exact
"jumps 0→100%" problem (P0-3) this slice exists to fix, undetected until this pass compared the
two fields on that specific screen. Also did the participant-row consolidation Phase 8 §13/§27
flagged (the organizer's own duplicate row in the Participants list, skipped only while the
standalone "Your share" card is also showing). **233 Flutter tests green** (up from 219,
including 14 new tests covering every Phase 8 §15 fill state and the full Phase 6 §12 waiting-
clause table), `flutter analyze` clean at the 11-issue baseline; real-device verified — an
organizer's Lobby vessel observed rising $0 → $40 → $80 live as each participant confirms,
never jumping straight to full, with the flag-off rollback re-confirmed via `e1_test.dart`.
Guest Web's own vessel remains I8's scope, unstarted, matching the original phase-10 entry.

**Home/category visual polish done** (`milestone-reports/HOME-VISUAL-POLISH.md`) — the third
and final slice of the mockup-gap plan. Participant avatar circles on an organizer-role Home
card only (`ActiveVink` gained `participantNames`, deliberately empty for a participant-role
entry — D24/D25 means there's no other participant's identity to show safely there, so that
card keeps its plain "N people" icon+text instead), reusing the existing `VinkAvatar` component
rather than inventing a new one. Category icons (`purchaseCategoryIcon`, plain Material icons,
no new assets). A repo-wide grep guard for wallet/balance-adjacent copy came back clean,
confirming the earlier "relabel, don't build a wallet" decision never needed a real fix.
**237 Flutter tests green** (up from 233), `flutter analyze` clean at the 11-issue baseline.
This closes the full three-slice mockup-gap plan (Invites → I7 → this slice) the owner
commissioned after comparing two aspirational mockups against the shipped post-I6 app.

**ENG4 in progress** ("Hosted Pilot Infrastructure," owner-supplied full brief — 10 slices,
config/deploy/logging/metrics/tracing/deep-links/secrets/release-pipeline/crash-reporting/
certification). Owner approved doing the four pure-application-code slices (1, 3, 4, 5) first,
since none need an infrastructure/vendor decision; the six that do (2, 6, 7, 8, 9, 10) will
surface those questions when reached rather than blocking now.

**ENG4 Slice 1 done** (`milestone-reports/ENG4-SLICE-1-PRODUCTION-CONFIGURATION.md`): production
configuration. Audit found `apps/api/src/config/env.ts` already Zod-validated and fail-fast with
real boot-refusal checks for unsafe dev-default secrets — a solid foundation, not greenfield.
The real gap: `apps/guest-web`/`apps/operations-console` read `NEXT_PUBLIC_API_BASE_URL` with a
bare, unvalidated fallback — a staging/production deploy missing it would silently serve traffic
against a loopback address instead of refusing to start. New `lib/env.ts` in both apps (Zod,
mirroring `env.ts`'s pattern) plus `scripts/validate-env.ts` wired into `npm start` via `&&` —
deliberately kept separate from `lib/config.ts`'s existing literal `process.env.NEXT_PUBLIC_X`
reads, since Next.js only inlines those into the browser bundle via static literal replacement;
routing the same value through a dynamically-parsed schema would have silently broken it
client-side. Both `tsconfig.json`s gained `allowImportingTsExtensions: true` (safe given both
already have `noEmit: true`) so the new scripts' `.ts`-extensioned imports — required for Node's
native execution, matching `apps/api`'s own convention — typecheck under Next's bundler
resolution mode. Root `.env.example` re-synced (was documenting 4 of `env.ts`'s ~19 real
variables). **12 new tests** (7 guest-web + 5 operations-console), `pnpm typecheck/lint/
format:check/guard` clean. Verified against real running processes, not just unit tests: `next
build` + `npm start` with valid config serves a real `curl` 200; the same command in a
staging-shaped misconfiguration exits 1 with the port confirmed never bound; setting the missing
value then boots clean — proven in both directions, for both apps independently.

**ENG4 Slice 3 done** (`milestone-reports/ENG4-SLICE-3-STRUCTURED-LOGGING.md`): structured
logging. Audit found "every request/command carries a correlation ID" already true and already
the same ID (Fastify's `request.id` was already threaded into `CommandContext.correlationId`
everywhere) — better than expected. The two real gaps: worker jobs (`jobs/worker.ts`'s
heartbeat used raw `console.log`, no correlation ID at all; `jobs/sweeps.ts` generated one per
tick but never logged it) and provider interactions (`packages/payment-provider` had zero
logging). New `CommandLogger` port on `CommandContext`/`PublicCommandContext` (dependency-free,
optional, same convention as `timers`/`invitesEnabled` — keeps `packages/application` "pure
orchestration"). New `withProviderLogging`: a `Proxy` decorator around `FinancialProvider`
logging `provider_call_start/end/error` — deliberately NOT a change to the interface itself,
since it's a spec-verbatim (§43) contract shared with the D7 conformance suite; wrapping the
instance at construction time respects "do not bypass existing architecture" while still
achieving per-call correlation logging, and special-cases `parseWebhookEvent` (the interface's
one synchronous method) to avoid silently changing its call contract. Wired into 6 route-module
context-builders plus `sweeps.ts`/`worker.ts` (the latter two via a new shared `createLogger`
Pino factory, `pino` promoted from transitive to a direct `apps/api` dependency). **12 new
tests**, `apps/api` 153/153 (up from 148), `packages/application` 137/137 unchanged (confirms
the additive field broke nothing), `pnpm typecheck/lint/format:check/guard` clean. Verified
against real infrastructure, not just unit tests: the existing recovery-integration suite's E8
scenario now visibly prints a real `provider_call_error` log line during its normal run; a real
`node src/jobs/worker.ts` smoke test against local Redis shows structured JSON replacing the
old console.log; a real `node src/server.ts` boot against local Postgres/Redis confirms the
6-file route refactor didn't break startup. Audited every new log call site: only event names +
correlation IDs + provider/method names + error messages are ever logged, never raw
input/output payloads — confirmed `MockFinancialProvider`'s own error-message text embeds only
opaque provider-reference IDs, never actual payment credentials.

**ENG4 Slice 4 done** (`milestone-reports/ENG4-SLICE-4-METRICS.md`): metrics. Fully greenfield
(zero metrics infra existed). Built on the existing OTel setup (`otel.ts`) rather than a
separate library like `prom-client` — new `observability/metrics.ts` (`MeterProvider` +
`PrometheusExporter`), deliberately **not** gated by `VINKIN_OTEL_ENABLED` (that flag stays off
because a push exporter needs a collector to be useful; this is pull-based and self-contained)
but still its own default-off flag (`VINKIN_METRICS_ENABLED`) since it opens a new port. Five
real instruments (API latency, provider/authorization call latency, worker failures, invitation
delivery, realtime connections) plus a generic `registerObservableGauge` for polled facts
(queue depth, health status) — wired at 7 real choke points, all additive
(`= NOOP_METRICS` default, zero pre-existing call sites touched): `app.ts`'s new `onResponse`
hook (using the route *pattern* via `request.routeOptions.url`, never the resolved URL, to
avoid unbounded UUID-cardinality labels); Slice 3's `withProviderLogging` wrapper now also
times each call (one wrapper, two concerns, since both fire around the identical call);
`sweeps.ts`/`worker.ts`'s BullMQ workers (the latter — a genuinely separate OS process — gets
its own metrics port, `+1` offset, to avoid a bind conflict with the main server); realtime
connection open/close in `realtime/routes.ts`; guest-invitation delivery outcomes in
`vinks/routes.ts` (mirroring the audit-row write that already exists, not a new determination);
a health-status gauge in `server.ts` reusing the exact `checkDb`/`checkRedis` closures
`/health/ready` already runs. **4 new tests** (including a real HTTP scrape against a real
ephemeral-port server, not mocked), `apps/api` 157/157 (up from 153),
`pnpm typecheck/lint/format:check/guard` clean despite the 7-file wiring surface (10/10
packages typechecked clean on the first pass). Verified against real running processes: a full
server boot with metrics on shows live latency/health/queue values from real requests; a
separate worker-process boot confirms no port conflict running alongside the main server.
**Two disclosed, deliberately unbuilt gaps**: database latency (the `postgres` npm client
exposes no per-query duration hook; the only alternative — wrapping the single most pervasively
used object in the entire backend, including inside financial transactions — was judged too
risky for an additive-metrics slice) and reconnect frequency (a client-side fact the backend
structurally cannot observe without clients reporting it, likely through the existing PV12-prep
analytics pipeline — a bigger decision flagged, not invented here). A third, smaller gap:
member-invitation delivery (as opposed to guest-invitation delivery, which is instrumented)
lives entirely inside `packages/application` with no apps/api-visible outcome, and is boot-
refused outside dev/test anyway.

**ENG4 Slice 5 done** (`milestone-reports/ENG4-SLICE-5-DISTRIBUTED-TRACING.md`): distributed
tracing — the fourth and final owner-approved pure-application-code slice. Key design decision:
a Vink's lifecycle can span up to 24h+, and OTel traces are shaped for bounded operations, not
multi-day business processes — forcing one trace across a whole Vink would be a real
anti-pattern. Built instead on the standard pattern: every individual operation (one HTTP
request, one job tick, one provider call) gets its own normal-shaped span, tagged with a stable
`vink.id`/`correlation.id` attribute for cross-trace correlation in a real backend. New
`observability/tracing.ts` (`withSpan`, `tagActiveSpan`) built directly on `@opentelemetry/
api`'s `trace` namespace — deliberately not a custom no-op wrapper like `metrics.ts`'s, since
the OTel API is already safely no-op by its own design when no SDK is running. Wired at the real
gaps the audit found (HTTP already gets spans free from `otel.ts`'s existing auto-
instrumentation): `sweeps.ts`'s whole tick and `worker.ts`'s heartbeat each get a root span
(nothing triggers them via HTTP); `withProviderLogging` (Slice 3/4's wrapper) now also spans
each provider call — one wrapper now serving logging, metrics, and tracing, since all three fire
around the identical call — which is what makes provider-call propagation real from both the
HTTP and job paths; `dispatchGuestInvitation`'s delivery-provider send is spanned; seven HTTP
route context-builders tag the real per-request auto-span with `correlation.id`. One deliberate,
disclosed lower-risk choice: the realtime WS connection-setup handler (five interleaved
early-return rejection branches) gets `tagActiveSpan` only, not a restructured dedicated span —
judged not worth the regression risk in security-sensitive auth code for this slice. Caught a
real test-infrastructure detour along the way, not a product defect: the first test attempt
using `NodeSDK` (matching `otel.ts`'s own class) showed zero exported spans even after shutdown;
root-caused to `NodeSDK`'s default `BatchSpanProcessor` (~5s buffering, correct production
behavior, wrong for a synchronous test check) — confirmed no defect in `otel.ts` itself, and
switched the test to the lower-level `NodeTracerProvider`/`SimpleSpanProcessor` (synchronous,
the standard pattern for this), which resolved cleanly. **5 new tests** including a real
parent-child span-nesting proof, `apps/api` 162/162 (up from 157), `pnpm typecheck/lint/
format:check/guard` clean. Verified with a real server boot under `VINKIN_OTEL_ENABLED=1` —
real requests served, no unexpected errors. Disclosed gaps: WS-upgrade auto-instrumentation
coverage wasn't independently confirmed; no live trace backend exists locally to visually
confirm the exit criteria's "visualized end-to-end" claim — structural correctness is proven,
visual confirmation isn't.

**ENG4 status**: all four owner-approved pure-application-code slices (1 production config, 3
structured logging, 4 metrics, 5 distributed tracing) are done. The remaining five brief items —
Slice 2 (deployment topology), Slice 6 (Universal Links/App Links), Slice 7 (secrets
management), Slice 8 (release pipeline), Slice 9 (crash reporting) — each need a real
infrastructure/vendor decision (hosting platform + staging domain, secrets manager,
crash-reporting vendor) not guessed at here; Slice 10 (certification) depends on those.

Next: awaiting owner input on the ENG4 infrastructure/vendor decisions above before continuing
Slices 2/6/7/8/9/10.
`PV12` (the actual closed pilot) remains an owner/operational decision deferred until
ENG0–ENG9 close.

**ENG4 Slice 2 implemented locally** (`milestone-reports/ENG4-SLICE-2-RAILWAY-TOPOLOGY.md`,
2026-07-25): owner selected Railway for the hosted pilot after rejecting Render's estimated
cost. Three service-local `railway.json` files define the API, Guest Web, and Operations
Console builds from the shared pnpm monorepo; Railway managed PostgreSQL and Redis complete the
five-service, production-only initial topology. A separate worker is deliberately deferred
because the API already runs the real sweep/outbox work while today's worker is only a
heartbeat. The API alone applies advisory-locked migrations in a pre-deploy command, then its
startup schema check and `/health/ready` fail closed. Topology is code-complete but not
provisioned: Railway/GitHub access, variables, generated domains, cost controls, and DNS are
external actions. Next infrastructure slices: 6/7/8/9, then 10.

**ENG4 hosted activation verified** (2026-07-25): Railway API, Guest Web, Operations Console,
PostgreSQL, and Redis are live behind `api.vinkin.org`, `join.vinkin.org`, and `ops.vinkin.org`.
`/health/ready` reports both dependencies healthy. Hosted smoke record
`0d899263-bc2b-43e9-8078-57c8d35c3488` completed register → create → manual guest → equal split
→ open → organizer contribution → guest contribution → `FUNDED`; Guest Web and Ops returned
HTTP 200. Runtime deliberately remains `VINKIN_ENV=demo` until a real provider is certified.
Mobile hosted-pilot endpoints and flags are now checked into `apps/mobile/config/pilot.json`
(non-secret) for `--dart-define-from-file`.

**ENG4 Slices 6–9 implemented; Slice 10 certification pending** (2026-07-25): Universal Links
are configured for `join.vinkin.org` and the iOS bundle; Android App Links are implemented but
the association file correctly awaits the real Google Play signing SHA-256 fingerprint.
Railway remains the pilot secrets store and CI now rejects tracked credential artifacts.
GitHub workflows cover PR verification, scheduled hosted readiness, and manual unsigned mobile
release builds. Sentry is conditionally integrated across API, Guest Web, Operations Console,
and Flutter without making local/runtime startup depend on a DSN. See
`milestone-reports/ENG4-SLICE-{6-DEEP-LINKS,7-SECRETS,8-RELEASE-PIPELINE,9-CRASH-REPORTING,
10-CERTIFICATION}.md`. ENG4 is **not closed** until the external certification blockers in
Slice 10 are completed.

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
