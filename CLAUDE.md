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

**ENG4 Slice 9 certified** (2026-07-26): controlled Sentry events were received from the live
Railway API container, Guest Web browser, Operations Console browser, and Flutter app in the
iOS simulator. The simulator check caught an actual `sentry_flutter 8.14.2`/Sentry Cocoa
compile incompatibility; upgrading to stable `sentry_flutter 9.25.0` restored the iOS build and
the Flutter event was received. Slice 10 remains open only on the non-Sentry release blockers
listed in its certification report.

## ENG6 — Financial Provider Readiness and Integration Boundary

Owner-directed, running concurrently with the ENG track above (does not replace it). Full
8-slice brief with an explicit "hard boundaries" section: must not become a public real-money
launch, fee-model implementation, KYC/AML policy invention, merchant acquiring, bank-account
infrastructure, production card credential exposure, UI redesign, a Stripe-specific rewrite of
the domain, or automatic reconciliation repairs without reviewed rules.

**M0-gate scoping was decided twice.** First (D45, now `SUPERSEDED (by D46)`): the owner chose
provider-independent work only, leaving any real provider SDK/sandbox integration until the M0
gate's own 10 conditions are satisfied. Then reversed, having identified a real distinction
D45 hadn't drawn: Stripe issues sandbox/test-mode keys freely, decoupled from the gate's actual
concern (live funds-flow approval). **D46** (ACCEPTED) amends
`docs/architecture/06-milestone-0-gate.md` with a narrow **Sandbox-only exception**: sandbox/
test-mode Stripe integration is permitted for technical validation and demos, with hard code-
level guards (a live-mode key must fail to boot, isolated webhook config, existing off-by-
default/boot-refused-outside-dev-test flag discipline) — this does **not** satisfy any of the
gate's 10 conditions and does **not** authorize real-money movement, live card issuance,
consumer fund custody, or public launch.

**ENG6 Slice 1 done** (`milestone-reports/ENG6-SLICE-1-PROVIDER-CAPABILITY-AUDIT.md`): full
capability matrix against Stripe; surfaced the M0-gate-vs-brief conflict above before any code
was written.

**ENG6 Slice 2 done** (`milestone-reports/ENG6-SLICE-2-ADAPTER-CONTRACT-HARDENING.md`):
completed the provider error-classification vocabulary (`INVALID_REQUEST`,
`COMPLIANCE_BLOCKED`, `UNKNOWN_OUTCOME`), typed `ContributionDeclineReason` (declines are data,
never a thrown error — kept distinct from `ProviderError`, an operational failure), 5 new
shared-conformance-suite tests against the mock (25/25). Bundled the D46 amendment above.

**ENG6 Slice 3 done** (`milestone-reports/ENG6-SLICE-3-STRIPE-SANDBOX-ADAPTER.md`): a real
`StripeFinancialProvider` (`packages/providers`, the second — and only legal, per D7/§42 —
home for a provider SDK besides `packages/payment-provider/src/adapters`) passing the *same*
shared conformance suite the mock passes, against a real Stripe sandbox account: **14/14
passing, 0 failing, 11 disclosed skips**. The D46 hard guard (`assertSandboxModeKey` —
unconditional live-key rejection) has its own 8-test unconditional unit suite requiring no
credentials, closing a real gap (the guard previously had zero test coverage outside the
credential-gated sandbox suite, meaning it was unverified in any environment without real
keys, including CI). Real bugs found and fixed via the live sandbox, not guessed: the shared
suite's `freshSlotId()` collided with itself against Stripe's real 24h-persistent idempotency
store (fixed with `randomUUID()`); the provider-import guard (`tooling/scripts/check-provider-
imports.mjs`) had no approved-directory exemption for `package.json` dependency checks at all,
making it structurally impossible to ever legally declare a provider SDK dependency anywhere
(fixed, verified both directions). Specific Stripe error-code mappings
(`amount_too_large`→`AMOUNT_EXCEEDS_AUTHORIZATION`, `payment_intent_unexpected_state`→
`INVALID_STATE`, refund-over-amount's undocumented code-less case) were all confirmed live
against the sandbox, never guessed from docs. **Disclosed gap, not an adapter defect**: the
4 issuing-side contract tests stay skipped — Stripe requires the *account* (not just the
adapter) to complete Issuing Terms-of-Service acceptance before any card can be *activated*
(confirmed via `GET /v1/account`: `capabilities: {}`, `card_issuing.tos_acceptance: null`),
an owner-side Stripe Dashboard action outside any code change; card/cardholder *creation*
already succeeds. `apps/api/src/server.ts` still hardcodes `MockFinancialProvider` — wiring the
real adapter into a running app is Slice 7's scope, not built early here. `apps/api` 221/221
unchanged, confirming zero regression. `pnpm typecheck/lint/format:check/guard` clean, 11/11
packages. Disclosed, unrelated environment gap: `apps/guest-web`/`apps/operations-console`'s
own Playwright suites fail here on a missing Chromium binary, and installing it hit `ENOSPC`
(disk at 99% full) — not caused by this slice, not fixed here.

**ENG6 Slice 3 update (same day)**: the owner completed Stripe's general-payments onboarding,
then the Issuing-specific requirements too. Re-checked live: `card_issuing`'s requirements
gate is now clear, but requesting the capability itself is a live-key-only Stripe operation
(confirmed via a real rejected call — no live key was ever used, that would violate D46).
Retrying card issuance after that surfaced a **new, bigger** wall: this account now needs
Stripe's newer **v2 Financial Account** primitive before any Issuing card can be created
(`financial_account_v2` required, its own distinct API-version header) — Stripe's own
money-movement/balance object, not a settings toggle. That sits close to, arguably inside,
ENG6's own declared hard boundary ("must not become... bank-account infrastructure").
Stopped and flagged to the owner (§9) rather than building Financial Account plumbing
unilaterally — the 4 issuing-side contract tests remain disclosed skips pending an explicit
owner call on whether adopting Stripe's v2 model is in scope. Full detail in the amended
`ENG6-SLICE-3-STRIPE-SANDBOX-ADAPTER.md`.

**ENG6 Slice 4 done** (`milestone-reports/ENG6-SLICE-4-WEBHOOK-INGESTION.md`): a durable,
provider-agnostic webhook ingestion route — §28's order (verify signature, store raw, dedupe
on `(provider, provider_event_id)`) — plus a dead-letter path for signature-valid-but-
unmappable events. New migration `0019_webhook_events.sql`; new
`apps/api/src/modules/webhooks/routes.ts`, a thin binding over `FinancialProvider.
parseWebhookEvent` proven generically against the mock (6/6, no credentials — what CI runs)
and, separately, against the real Stripe sandbox (a 7th test, real HMAC-signed Stripe event
envelope, credential-gated). Wired into `server.ts` behind a new
`VINKIN_STRIPE_WEBHOOKS_ENABLED` flag constructing a **separate** `StripeFinancialProvider`
instance used only for webhook verification — the command-execution `provider` stays Mock,
unchanged, per Slice 3's own documented boundary. Deliberately **not** environment-boot-
refused like its ENG5 siblings (Apple/Google/email flags) — this one guards a real, working
sandbox capability D46 explicitly permits without scoping it to `VINKIN_ENV`; the actual
safety mechanism is `assertSandboxModeKey`'s unconditional live-key rejection, disclosed as a
deliberate deviation, not an oversight. **Real bug caught by a dedicated test**: the
dead-letter dedupe-key fallback used `randomUUID()`, so two deliveries of the byte-identical
unparseable body produced two rows instead of one — fixed by hashing the raw body (SHA-256)
instead, since a dedupe key must be a deterministic function of content. Verified against a
real running server both directions: flag on with real credentials → route genuinely live
(`400 MISSING_SIGNATURE`, not 404); flag off with Stripe credentials deliberately unset →
boots clean, route genuinely absent (404), zero Stripe dependency. **`apps/api` 227/227** (up
from 221), **`packages/application` 137/137** unchanged (confirms this stayed entirely inside
the transport layer), `pnpm typecheck/lint/format:check/guard` clean, 11/11 packages. No
processor reads these rows yet — that's Slice 5's explicit job, not built early here per
ENG6's own hard boundary against inventing reconciliation behavior.

**ENG6 Slice 5 done** (`milestone-reports/ENG6-SLICE-5-RECONCILIATION.md`, owner-scoped brief
with explicit exclusions: no Stripe Financial Accounts v2, no Stripe command adapter wired
into the running app, no bank-account infrastructure). New `packages/reconciliation`
(zero-dependency, mirrors `@vinkin/ledger`'s pure-rules/DB-persistence split) — a
`correlationTargetFor(eventType)` map plus pure `classify(event, lookup)` rules implementing
the owner's exact five-classification vocabulary (`EXPECTED`/`PENDING`/`MISMATCHED`/
`ORPHANED`/`UNRECOGNIZED`), tested against both hand-written provider-neutral fixtures (12
tests) and real Stripe-translated events (4 tests, fully offline — `Stripe.webhooks.
constructEvent` is pure local crypto, so a throwaway sandbox-shaped key with a locally-
computed HMAC signature exercises the real Stripe translation path with zero network calls
and zero live credentials). New migration `0020_reconciliation.sql`
(`reconciliation_runs`/`reconciliation_findings`, `webhook_event_id UNIQUE` as the real
idempotency guard); `apps/api/src/modules/reconciliation/{store,runner}.ts` — `runReconciliation`
deliberately mirrors `outbox-publisher.ts`'s own proven `FOR UPDATE SKIP LOCKED` pattern
(claim a batch ordered by `occurred_at`, never `received_at` — §28's own rule — process,
commit), which delivers concurrent-run safety, crash-safe resumption, and idempotent replay
all from one already-proven pattern rather than three separate mechanisms. **13/13 new
integration tests** against real PostgreSQL prove every owner-required scenario by name (late
capture, reversal, refund mismatch, missing predecessor, unknown provider object, out-of-order
processing order via a `seq` proof, replay producing zero duplicate findings, two concurrent
runs processing a 30-row batch exactly once combined, full audit-trail linkage, and a dedicated
test proving reconciliation never writes to `contributions`/`settlements`/any ledger table).
**`apps/api` 240/240** (up from 227), **`packages/reconciliation` 16/16**, **`packages/
application` 137/137 unchanged** (confirms zero domain/command code touched),
`pnpm typecheck/lint/format:check/guard` clean, 12/12 packages. No HTTP surface or scheduled
trigger yet — `runReconciliation` is callable programmatically only; that's Slice 6's own
explicit scope, not built early here.

**Stripe Financial Account finding, formally documented** (separate decision note,
`milestone-reports/ENG6-SLICE-5-STRIPE-FINANCIAL-ACCOUNT-NOTE.md`, per explicit owner
instruction): mid-Slice-5, the owner reported completing Stripe's Issuing-specific
requirements (confirmed live: `card_issuing` capability `currently_due` is now empty).
Retrying card creation surfaced a **new, bigger** wall — `POST /v1/issuing/cards` now requires
`financial_account_v2`, a Stripe v2-API primitive (`/v2/financial_addresses` needs its own
distinct API-version header entirely) — not a settings toggle. The note documents, precisely
and without guessing: the exact request/response pair; that requesting the `card_issuing`
capability itself is confirmed live-key-only (no live key was used); that whether this is
platform-vs-connected-account-vs-card-program-specific, whether an ordinary Dashboard Issuing
balance sidesteps it, and the true minimum architecture cost are all **explicitly unknown**
without further Stripe confirmation — stated as open questions, not guessed at. No Financial
Account code was written anywhere; the 4 issuing-side contract-suite skips remain exactly as
disclosed in Slice 3's report.

**ENG6 Slice 6 done** (`milestone-reports/ENG6-SLICE-6-OPS-CONSOLE-RECONCILIATION.md`,
owner-scoped brief: "operational visibility, not financial control" — explicit prohibition on
any button that moves money, approves a payment, issues a refund, creates a card, or edits
provider/financial data). Read-only operator console over the webhook inbox and Slice 5's
reconciliation engine: new migration `0021` (`signature_header`/`delivery_count` on
`webhook_events`); `webhooks/routes.ts` refactored so the entire ingestion decision is one
exported `ingestWebhookEvent` function, called identically by the live route AND the new
replay endpoint — the literal mechanism making "replay always goes through the normal
ingestion path" true rather than asserted; `modules/reconciliation/{ops-queries,routes}.ts`
(list/filter/paginate webhook events and findings, finding detail with linked Vink/ledger
entries/reconciliation history/audit history, acknowledge/resolve reusing PV11's existing
`operator_audit_log`, a concurrency-guarded manual run trigger). New
`apps/operations-console` pages (`/reconciliation`, `/reconciliation/findings/:id`) matching
the app's existing conventions exactly (raw DB-shaped rows, `DataTable`, React Query,
operator-token auth). **Three real bugs found and fixed**: an auth-ordering bug where
acknowledge/resolve validated the request body before checking the operator token (an
unauthenticated caller got a body-shaped `400` instead of a uniform `401` — caught by the
AUTHZ test itself); a genuine TOCTOU race in the concurrency guard (checking `runInProgress`
after an `await` would let two truly concurrent requests both pass — fixed by claiming the
flag as the first synchronous statement, before any await); and a frontend/backend
content-type mismatch (`replayWebhookEvent` sent a bodyless POST, but the shared `request()`
helper always sets `Content-Type: application/json`, which Fastify rejects on a truly empty
body with a raw 500 — caught live in a real Chromium browser driving the real production
console against the real API, not by any `app.inject()`-based test, since that harness
doesn't replicate real `fetch()` header behavior). **`apps/api` 254/254** (up from 240 — 14
new, including concurrent-run prevention via `Promise.all`, replay-through-the-normal-pipeline,
and a dedicated no-financial-mutation proof), **`packages/application` 137/137** unchanged,
`pnpm typecheck/lint/format:check/guard` clean, 12/12 packages. Verified end-to-end with a
real Playwright-driven browser (login → findings list → detail → acknowledge → dead-letter
browser → replay refusal) against real running processes — the run that caught the
content-type bug. No HTTP-level financial mutation is possible from this module by
construction (verified by a dedicated integration test and by reading every query in
`ops-queries.ts`: none write to `contributions`/`settlements`/`purchase_authorizations`/
`temporary_cards`/any ledger table).

**ENG6 Slice 7 done** (`milestone-reports/ENG6-SLICE-7-SANDBOX-GOLDEN-PATH.md`): the
end-to-end proof, closing ENG6's own numbered slice sequence. A real Stripe sandbox
object (customer, payment method, authorized-then-captured PaymentIntent — every id genuine,
via a real `api.stripe.com` call) created by calling `StripeFinancialProvider` directly
(never through a command, M0/D15 unchanged); a real `payment_intent.succeeded` event
referencing it submitted to the live `/webhooks/stripe/sandbox` route; reconciliation
correctly classifies it **ORPHANED** — the accurate outcome, since no `contributions` row
references an object the command layer never touched, not a gap; the finding is visible,
correctly detailed (`linkedVinkId: null`, real payload), and acknowledgeable through the real
operations console endpoints Slice 6 built. **`apps/api` 254/254** without Stripe
credentials (44 suites, the new golden-path suite skips cleanly), **259/259** with real
credentials, `pnpm typecheck/lint/format:check/guard` clean, 12/12 packages.

**Genuine live Stripe delivery verified same day**, after the owner authenticated the Stripe
CLI (`stripe login`): `stripe listen --forward-to .../webhooks/stripe/sandbox` (fresh
ephemeral webhook secret captured straight into `apps/api/.env`, never displayed) +
`stripe trigger payment_intent.succeeded` — Stripe's own servers delivered 4 real events over
real HTTP; 3 were correctly dead-lettered (no `mapStripeEventType` mapping, accurate, not a
bug) and `payment_intent.succeeded` was correctly verified/stored/mapped to `payment.captured`
with its real `occurred_at`. Reconciliation (via the real `/internal/ops/reconciliation/run`
endpoint) created exactly one `ORPHANED` finding, correctly reasoned, visible through the real
findings API. This closes the one disclosed gap in the automated test. Two secret-handling
slips happened during this pass (an unredacted CLI `config --list` printing the test-mode key;
a log `tail` re-displaying the webhook signing secret) — both immediately disclosed; owner
confirmed no rotation needed (test-mode key; a webhook signing secret can't be used to derive
what it's computed from). Temp log files deleted after use.

**ENG6 Slice 8 (closure report) done** (`milestone-reports/ENG6-SLICE-8-CLOSURE.md`,
documentation only, no new code). Summarizes all seven implementation slices, the M0-gate
D45→D46 resolution sequence, and confirms every hard boundary from the original brief held
throughout: no live-mode credentials anywhere (`assertSandboxModeKey`'s unconditional guard,
never bypassed), no Stripe command adapter wired into the running app (`server.ts` still
hardcodes `MockFinancialProvider`), no Financial Accounts/bank-account infrastructure, no
automatic reconciliation repairs (proven by dedicated tests in both Slice 5 and Slice 6), no
KYC/AML/merchant-acquiring/fee-model/UI-redesign/domain-rewrite scope creep. Two gaps carried
forward as genuinely open, not silently resolved: Issuing's Stripe v2 Financial Account
requirement (separate decision note, 4 contract tests remain disclosed skips) and no
scheduled/recurring reconciliation trigger (manual-only, by the owner's own Slice 6 scope).
Final tally: **`apps/api` 254/254** without Stripe credentials, **259/259** with;
`packages/application` 137/137 unchanged across all seven slices (confirms zero domain/command
code was ever touched by ENG6); `pnpm typecheck/lint/format:check/guard` clean, 12/12
packages.

**ENG6 is fully closed.** All eight slices (capability audit, adapter contract hardening,
sandbox adapter, webhook ingestion, reconciliation scaffolding, operations console, sandbox
golden path, closure report) are done.

**Track note (2026-07-26):** ENG4's remaining Slice 10 external blockers (Play signing
fingerprint, GitHub branch protection, Railway spend alerts/backup drill, signed TestFlight/
Play builds, staging environment) are owner/ops actions, not code — deferred per owner
direction, revisit when reached. The owner also supplied the full ENG0–ENG15 engineering
roadmap this session; reconciled against actual repo state (a sweep found ENG1 Slices 4–7,
ENG2, and ENG3 already done under those exact names, and large parts of the plan's ENG6/ENG7
already substantially built as PV4/PV11/D44/ENG4 Slices 3–5) — the roadmap's own ENG4 hosting
section (Fly.io + Vercel + separate worker) is superseded by the already-live Railway topology
(owner confirmed: keep Railway). Net position: **ENG5 (Authentication and Identity)** is the
actual next unbuilt milestone. Owner directed: continue with VinkIn's native auth platform
(not a managed identity provider — Clerk/Auth0/Supabase Auth etc. — reevaluate only after
public launch if operational complexity justifies migrating), adding email verification,
password reset, magic links, and Sign in with Apple/Google on top of the existing PV1
username/password + rotating-refresh-token auth.

**ENG5 Slice 1 done** (`milestone-reports/ENG5-SLICE-1-EMAIL-VERIFICATION.md`): email
verification. New `email_verification_tokens` table (migration 0015) + `users.email_verified_at`,
hashed-only single-use tokens (D14 hard rule applied to this new secret too, snapshotting their
own target email so a later email change can never be verified by an in-flight token minted for
the old address — `updateContactInfo` now resets `email_verified_at` on a real email change,
the guard that makes this possible). `packages/delivery`'s `DeliveryTemplateInput` became a
real discriminated union (invitation-shaped vs. the new account-security shape) rather than
widening the shared interface. New `VINKIN_EMAIL_VERIFICATION_ENABLED` — same off-by-default,
boot-refused-outside-development/test discipline as `VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED`,
for the identical reason (no real email provider selected yet, §4); registration auto-sends
best-effort (never blocks on failure, Phase 5 §2), plus a self-serve `POST .../email/verify/
request` resend route and a public `GET .../email/verify/confirm` the emailed link points at
directly (returns HTML, not JSON — a browser hits it, not a client app). Mobile: Profile screen
gained a verification-status card with a `CommandRunner`-driven resend button (ENG3's typed
command-state pattern). **`apps/api` 176/176** (up from 165) **, `packages/application` 137/137
unchanged** (confirms the work stayed inside auth's own PV1-era module, disclosed as sitting
outside the D13 command layer since that module's own header comment) **+ 245 Flutter tests**
(up from 241), `flutter analyze` unchanged at the 26-issue baseline,
`typecheck`/`lint`/`format:check`/`guard` clean across all 10 packages. Known, disclosed gaps:
verification is provable but not yet enforced anywhere (no product decision requested one); no
in-app contact-info-editing screen exists yet to attach this to on mobile (pre-existing gap
since Slice I4, not created or closed here).

**ENG5 Slice 2 done** (`milestone-reports/ENG5-SLICE-2-PASSWORD-RESET.md`): password reset.
New `password_reset_tokens` table (migration 0016, hashed-only/single-use, no email snapshot —
resetting isn't verifying an address). `requestPasswordReset` returns `null` for every reason
nothing should send (unknown account, inactive, cooldown) so the route can reply with the
byte-identical `202` regardless — the actual account-enumeration defense, proven by a test
asserting identical responses, not by inspection. `confirmPasswordReset` revokes every existing
session on success, reusing `refreshSession`'s reuse-detection family-revocation precedent
rather than inventing a new rule. `VINKIN_PASSWORD_RESET_ENABLED` (own flag, same
boot-refused-outside-dev/test discipline as its Slice 1 sibling); `PASSWORD_RESET_TOKEN_TTL_
SECONDS` defaults to 1h (deliberately shorter than email verification's 24h — a reset token
grants full account takeover). New IP rate limit on the request route (`makeRateLimiter`, same
mechanism the public join surface already uses) as a volume brake, complementary to — not a
substitute for — the enumeration defense. Confirm page stays server-rendered HTML+`fetch()`
(no urlencoded body parser added to an otherwise all-JSON API); mobile gained a "Forgot
password?" entry point (`ForgotPasswordScreen`) whose only job is collecting the email — typing
the new password happens on the emailed link's page, same split as Slice 1's email
verification. **`apps/api` 183/183** (up from 176), **`packages/application` 137/137**
unchanged, **247 Flutter tests** (up from 245), `flutter analyze` unchanged at the 26-issue
baseline, `typecheck`/`lint`/`format:check`/`guard` clean across all 10 packages.

**ENG5 Slice 3 done** (`milestone-reports/ENG5-SLICE-3-MAGIC-LINKS.md`): magic links
(passwordless login). New `magic_link_tokens` table (migration 0017, same hashed/single-use
shape as its siblings). The real design question: a "click and land signed in" magic link
needs a deep link to hand a native app real session tokens, but Android App Links are
disclosed-not-functional (ENG4 Slice 10's own open blocker) — rather than build a flow that's
broken-by-default on one platform, the confirm page requires an explicit click (never
auto-fires, unlike Slice 1's page — nothing else competes to consume that token there) and the
email tells the user they can instead paste the link into the app's own new "Log in with a
link" screen; both paths hit the identical `POST .../magic-link/confirm` JSON route. One-tap
deep-link completion is a disclosed follow-up once the Android gap closes, not built against
unverified infrastructure now. `confirmMagicLink` issues a genuinely real session (same return
shape as login/register — this *is* a login, just via a different credential), verified by a
test that makes a real authenticated call with the issued token, not just checking the
response shape. `MAGIC_LINK_TOKEN_TTL_SECONDS` defaults to 15 minutes — shortest of the three
token families, since this one grants immediate full access with no second factor at all.
Mobile's `AuthController.confirmMagicLink()` extracts the token from either a bare token or a
pasted full URL client-side — tested against the actual request body sent, not just that a
request fired. **`apps/api` 188/188** (up from 183), **`packages/application` 137/137**
unchanged, **251 Flutter tests** (up from 247), `flutter analyze` unchanged at the 26-issue
baseline, `typecheck`/`lint`/`format:check`/`guard` clean across all 10 packages.

ENG5's token/delivery-shaped work is done (Slices 1–3: email verification, password reset,
magic links).

**ENG5 Slice 4 done** (`milestone-reports/ENG5-SLICE-4-SIGN-IN-WITH-APPLE.md`): Sign in with
Apple. Owner confirmed no Apple Developer account access is coming soon, so this ships
**server-side only** — the mobile client's "Continue with Apple" button was deliberately not
built (it would always fail without real Apple capability provisioned, the same "don't build a
button that doesn't work" call ENG3 Slice 4 already made for deep links). New
`oauth_identities` table (migration 0018), generic across providers by design — Slice 5
(Google) is the very next item in the same brief and reuses this table and
`signInWithOAuth(sql, provider, providerUserId, email, displayName)` verbatim, only needing its
own token-verification module. `verifyAppleIdentityToken` checks Apple's real JWKS by default
but takes an injectable key resolver, which is what makes the whole feature genuinely testable
without real Apple credentials: tests generate a local key pair, sign real Apple-shaped tokens,
and inject a local JWKS — proving forged signatures, wrong issuer, wrong audience, and expiry
are all correctly rejected via actual cryptography, not mocks. **A real bug the tests caught
mid-slice**: two different Apple identities reporting the same email crashed on `users.email`'s
UNIQUE constraint instead of failing cleanly — surfaced a genuine, undecided product question
(should this auto-link to the existing account?) that wasn't a call to make silently; resolved
conservatively with a clean `409 EMAIL_ALREADY_REGISTERED` (PostgreSQL's own constraint is the
final guard here too), auto-linking flagged as open, not decided. The route fails closed (503)
whenever the flag is off or `APPLE_SIGN_IN_CLIENT_ID` is unconfigured — deliberately not the
softer no-op pattern its siblings use, since accepting a token with no configured audience to
check would mean accepting one minted for a different app. **`apps/api` 203/203** (up from
188 — 8 real-cryptography unit tests + 7 full-route integration tests, the latter proving a
genuine subsequent authenticated call with the issued token, not just checking response
shape), **`packages/application` 137/137** unchanged, `typecheck`/`lint`/`format:check`/`guard`
clean across all 10 packages. Mobile untouched this slice (no button, no build change).

**ENG5 Slice 5 done** (`milestone-reports/ENG5-SLICE-5-SIGN-IN-WITH-GOOGLE.md`): Sign in with
Google — same owner-directed server-side-only scope as Slice 4 (no real Google Cloud OAuth
client provisioned yet, no client button built). Reused `oauth_identities`/`signInWithOAuth`
verbatim, exactly as Slice 4's own report predicted; only a new `google-identity.ts` and route
were needed. Two real differences from Apple, each with its own test: Google's ID token
carries a verified `name` claim on every sign-in (Apple's never does, at all — that's why only
Apple's route has `givenName`/`familyName` request fields), and an `email_verified: false`
claim is explicitly never trusted as a real email. A cross-provider test proves the shared
`EMAIL_ALREADY_REGISTERED` conflict guard Slice 4's own tests caught is genuinely shared code,
not just structurally identical, by reaching it through the Google route with two Google
identities. **`apps/api` 221/221** (up from 203 — 10 real-cryptography unit tests + 8 full-route
integration tests), **`packages/application` 137/137** unchanged (the fifth consecutive ENG5
slice to stay entirely inside auth's own module), `typecheck`/`lint`/`format:check`/`guard`
clean across all 10 packages. Mobile untouched, same reason as Slice 4.

**ENG5 is complete.** All five slices done — email verification, password reset, magic links,
Sign in with Apple, Sign in with Google — every one server-complete and tested against real
cryptography/PostgreSQL, each disclosed everywhere it stops short of a working end-user button
(three gated on §4's still-unselected email/SMS provider, two gated on unprovisioned Apple
Developer/Google Cloud credentials).

**ENG6 ("Financial Provider Readiness and Integration Boundary") in progress** — owner-supplied
8-slice brief. **Slice 1 done** (`milestone-reports/ENG6-SLICE-1-PROVIDER-CAPABILITY-AUDIT.md`):
capability/gap matrix against the real `FinancialProvider` interface, contract-test coverage,
and every real provider call site (not assumptions). **Headline finding, flagged to the owner,
not resolved silently**: ENG6 Slices 3 ("real provider adapter in sandbox mode... may be
Stripe") and 4 ("hardened webhook boundary") closely match what
`docs/architecture/06-milestone-0-gate.md` — this repo's own stated authority on M0 — names
explicitly in its **Forbidden** list ("Stripe-specific schemas or webhook tables," "real
contribution capture flows") while the gate is open (all ten conditions still `☐ OPEN`,
including #1 "a provider confirms the funds flow" and #7 "sandbox tests pass"). D15 already
ratified today's provider-calls-inside-transaction pattern as intentionally deferred until a
real provider's semantics are known, for the identical reason. Slices 1–2 don't conflict (the
gate's own Permitted list covers both); Slices 3+ need an explicit owner call — supersede/
reopen the gate for ENG6, or hold until conditions 1/7 are met — before proceeding. Other real
findings: webhook ingestion has zero HTTP route and zero `(provider, provider_event_id)` dedupe
table anywhere in this codebase despite `parseWebhookEvent` being fully specified and contract-
tested (Slice 4's infrastructure gap is real and provider-independent — buildable against the
mock's synthetic events regardless of how the M0 question resolves); merchant authorization/
capture today are entirely VinkIn's own in-process simulator decision (PV6/PV11), never a real
provider webhook; zero reconciliation, KYC, or transaction-limit code exists anywhere (expected
— explicitly gate-condition territory, not an unclosed engineering gap).

**ENG6 Slice 2 done** (`milestone-reports/ENG6-SLICE-2-ADAPTER-CONTRACT-HARDENING.md`):
provider error classification. Three new `ProviderErrorCode` values (`INVALID_REQUEST`,
`COMPLIANCE_BLOCKED`, `UNKNOWN_OUTCOME`) and `AuthorizationResult.declineReason` retyped from
bare `string` to a real `ContributionDeclineReason` union — deliberately kept separate from
thrown errors (a normal per-transaction decline is a typed return value, not an operational
failure). `UNKNOWN_OUTCOME` is `retryable: true`, same reasoning as `PROVIDER_UNAVAILABLE`.
New mock chaos hook `simulateUnknownOutcome(sideEffectHappened)` takes ground truth as a
parameter rather than deciding it internally. Shared conformance suite grew 5 tests (20→25),
including `UNKNOWN_OUTCOME` proven in both directions against real committed/uncommitted
state. A real gap the new validation caught immediately: the suite's own shared `authorize()`
helper built metadata without the now-required `vinkId` — one fix cascaded to every dependent
test.

**M0 gate amended (D46, supersedes D45) mid-slice** — the owner reversed D45's "do not amend"
direction after identifying a real distinction: Stripe issues sandbox/test-mode credentials
freely, with no business approval needed, genuinely decoupled from what the gate's ten
conditions govern (live funds-flow approval). `docs/architecture/06-milestone-0-gate.md` now
has a **Sandbox-only exception**: sandbox-mode Stripe integration is permitted for technical
validation/demos, with hard guards specified (live-mode credentials must fail to boot in any
environment; isolated webhook endpoint/secret; existing off-by-default flag discipline) — but
explicitly does not satisfy any of the ten conditions or authorize real-money movement, live
issuance, fund custody, or launch. D45 marked `SUPERSEDED (by D46)`, not deleted — the
historical record (including the reversal itself) is preserved. **`apps/api` 221/221**,
**`packages/application` 137/137** unchanged, contract-tests 25/25 (up from 20),
`typecheck`/`lint`/`format:check`/`guard` clean across all 10 packages.

Next: ENG6 Slice 3 — a real Stripe sandbox adapter, now unblocked by D46 but needing real
(free, sandbox-only) Stripe API keys from the owner before it can build against an actual
sandbox — the same external-credential dependency ENG5's Apple/Google slices hit.

**ENG7 in progress** ("Observability and auditability," owner-directed after asking "go on
with ENG7" with no brief attached — the full ENG0–ENG15 roadmap was requested and saved
verbatim to `docs/architecture/eng-roadmap.md` per explicit instruction, and is now the
authoritative source for every ENG-numbered milestone's exact scope going forward). An
Explore-agent audit (mirroring ENG6 Slice 1's own precedent) checked ENG7's four named
subsections — Logging, Metrics, Alerts, Audit trail — against real code before any change:
Logging's mechanism existed (ENG4 Slice 3's `CommandLogger`) but was wired into almost no
command; Metrics had real gaps against the roadmap's 13 named metrics; Alerts was 100%
unbuilt, no vendor/channel ever selected; Audit trail had two genuine, previously-undiscovered
holes (`createVinkCommand`/`setSplitCommand` wrote to no audit mechanism at all). Asked the
owner narrowly, only for the one piece needing a real vendor/infra decision (Alerts' delivery
channel) — answer: **"Defer alerts, build the rest first."**

**ENG7 Slices A–C done** (`milestone-reports/ENG7-SLICES-A-C-LOGGING-METRICS-AUDIT.md`):
structured logging, metrics, and audit trail completion — the three pure-application-code
subsections, Alerts deferred per the owner's own choice above. New
`packages/application/src/support/command-logging.ts` (`logCommand`) wired into all 18
exported commands across 7 files; new `RELEASE_VERSION` env var (sourced from
`RAILWAY_GIT_COMMIT_SHA` when unset, ENG4 Slice 2's Railway topology already provides it for
free) threaded into the Fastify logger, the shared job-process logger, and Sentry's `release`
tag. **Real bug caught**: Pino's `base` logger option *replaces* rather than merges its
default `{pid, hostname}` binding — setting `base: { release }` would have silently dropped
both from every HTTP log line; fixed by restating them explicitly. New `CommandMetrics` port
on `CommandContext`/`PublicCommandContext` (mirroring `CommandLogger` exactly) plus 7 new
Prometheus instruments (`vinkin_job_duration_ms`, `vinkin_sweep_delay_ms`,
`vinkin_webhook_events_total`, `vinkin_command_replay_total`,
`vinkin_contribution_outcome_total`, `vinkin_merchant_authorization_outcome_total`,
`vinkin_refund_outcome_total`), wired at all real route/job choke points. `createVinkCommand`
and `setSplitCommand` now write real `tx.appendHistory(...)` rows directly (neither is a
domain-legal state-machine transition `applyVinkTransition` could validate, so neither ever
had an audit path before this); migration `0022` adds `provider_reference` to
`contribution_status_history` and `correlation_id` to `operator_audit_log`, both now
populated on every write. Two existing tests updated (not weakened) to assert the now-complete
`['VINK_CREATED', 'SPLIT_CONFIGURED', 'VINK_OPENED']` history sequence instead of the old,
incomplete single-event assertion. **`apps/api` 260/260** (up from 254), **`packages/
application` 137/137** unchanged, `pnpm typecheck/lint/format:check/guard` clean, 12/12
packages. Verified against real running processes: a live server boot with metrics enabled, a
real HTTP-driven command, and a real `curl` scrape confirming the new sweep/job instruments
genuinely populated from the actual running scheduler. Disclosed gaps: reconnect-frequency
metric (needs client-side reporting from `apps/mobile`/`apps/guest-web`, out of scope here),
database query latency (no per-query hook on the `postgres` client without wrapping the most
pervasively used object in the codebase — same reasoning as ENG4 Slice 4's identical gap), and
`apps/operations-console` not yet updated to display the new `correlationId` column.

**ENG7's Alerts subsection remains open**, deferred pending an owner decision on delivery
channel — no code should be written for it without that direction.

**ENG8 done** (`milestone-reports/ENG8-SECURITY-HARDENING.md`,
`docs/architecture/eng8-threat-model-and-security-decisions.md`): security hardening, the
roadmap's own "before any external pilot" gate. An Explore-agent audit against all 17 named
items found token rotation/webhook verification/CORS/replay-protection/deadline-manipulation
already solid; real gaps in secure headers, input-size limits, least-privilege DB roles,
audit-log DB-level immutability, Redis-backed rate limiting, and dependency/SAST scanning
(neither existed in CI at all). Three genuine policy/tooling decisions resolved via
`AskUserQuestion` before building: Dependabot + `pnpm audit` for dependency scanning, Semgrep
(no-login public rulesets) for SAST, data-retention rules/privacy review deferred (no policy
exists anywhere in this project to build against). **`@fastify/helmet`** wired with two
disclosed deviations from its defaults — CSP off (would break the two real inline-`<script>`
auth confirm pages) and CORP set to `cross-origin` (the default blocks the exact cross-origin
fetches `apps/guest-web`/`apps/operations-console` exist to make — verified live, a real
gotcha). **Real bug caught by live verification**: the global error handler was collapsing
Fastify's own genuine `413 body too large` into a fabricated `500` — pre-existing under the
old implicit body limit, just never exercised until this slice made the limit explicit; fixed
narrowly (only trusts `FST_ERR_*`-tagged errors' own status code). **Redis-backed rate
limiting** closes the gap disclosed since PV4, fails open (not closed) on a Redis error so an
outage degrades rate limiting instead of 500ing real traffic. **Migration `0023`**: a
least-privilege `vinkin_app` DB role (code-complete, not yet provisioned into the running
connection — needs a real password + `DATABASE_URL` swap per environment, same shape as ENG4
Slice 2's Railway topology) plus mirrors the ledger's own append-only trigger onto
`operator_audit_log`/`vink_state_history`/`contribution_status_history` (previously
append-only by convention only). **CSRF: documented as not applicable, not silently
skipped** — no cookie-based auth exists anywhere in this API (confirmed by grep), so there is
no ambient credential for a forged cross-site request to exploit. **Dependency scanning's
first-ever run surfaced 11 real high-severity CVEs**, not theoretical — `find-my-way`
(Fastify's own router, production runtime), 4 separate `next` CVEs (middleware/proxy bypass,
DoS, 2 SSRF variants, both Next.js apps' production runtime), `fast-uri`, `sharp`, `postcss`.
Fixed 10 of 11 via patch/minor bumps only (`next` 16.2.10→16.2.11 direct; the rest via scoped
`pnpm-workspace.yaml` overrides — `next>postcss` scoped specifically since a second,
already-patched postcss lineage existed via `@tailwindcss/postcss`); both Next.js apps
rebuilt clean on 16.2.11. One (`brace-expansion`, ESLint-only, never shipped to runtime)
deliberately left unfixed and disclosed via `auditConfig.ignoreGhsas` — its patch is a
major-version jump its own direct dependent declares incompatible. Full 10-scenario threat
model written with file:line citations; 7 mitigated, 3 partial-with-disclosed-gap (including
the pre-existing WS-token-in-URL issue already flagged in `realtime/routes.ts`'s own header
comment, not new to ENG8, not fixed here). **`apps/api` 263/263** (up from 260), `packages/
application` 137/137 unchanged, `pnpm typecheck/lint/format:check/guard` clean, 12/12
packages. **Real environment incident mid-verification**: local disk hit 0 bytes free; asked
the owner before any cleanup (per house rule, same precedent as I6.md), then freed ~1.8GB via
`pnpm store prune` + build-cache deletion — reversible, no project files touched. Disclosed,
not claimed done: the full Playwright regression suite wasn't re-run end-to-end this pass
(the disk incident); `e9.spec.ts` specifically — the suite most exposed to the CORS/CORP/
helmet changes — was re-run twice via `git stash` isolation and confirmed unaffected (same 6
pre-existing, unrelated failures both times); Semgrep's real findings against this codebase
are unverified until its first live CI run (local disk too constrained to install its
toolchain).

Separately, mid-session the owner asked about attaching a 1TB external drive to relieve local
disk pressure going forward. Found the actual internal-disk offenders were Xcode DerivedData
(3.7GB, safe to delete — rebuilds from source) and two disposable, unnamed duplicate iOS
Simulator devices left over from repeated setup/erase cycles (5.5GB combined; kept the
one named device, "iPhone 16 Pro (Screenshots)," used by the PV13 screenshot pipeline) — not
pnpm/turbo caches, which were already small post-prune. Freed 5.2GB this way alone, resolving
the crisis without needing the drive. The attached drive (`/Volumes/My Passport`, 931GB free)
is NTFS — fine for cold/archival storage (e.g. Downloads) but a poor fit for actively-used
dev caches (pnpm store, Xcode DerivedData) given no real Unix permissions/symlinks and likely
spinning-disk speed; reformatting to APFS would be needed to safely relocate those, and would
wipe the drive, so it wasn't done unprompted. Owner declined moving Downloads (446MB,
contains personal files) since it wasn't the actual problem.

**ENG9 done** (`milestone-reports/ENG9-REMOTE-WORKFLOW-CERTIFICATION.md`): remote workflow
certification — 17 named failure scenarios, formal pass/fail evidence. An Explore-agent audit
found 9 already solidly proven by existing tests, 4 proven only by design reasoning with zero
test evidence, and 2 genuinely open gaps. Two owner decisions resolved before building:
**contribution-during-cutoff (#15) stays undocumented as a gap, not built** (would be new
product/business behavior, no soft-close window exists anywhere in this codebase); **API/
worker/Redis/Postgres restart + deployment-during-active-Vink (#1–4, #17) are certified via
equivalent LOCAL tests, not the live hosted Railway deployment** — this environment has no
Railway CLI/credentials at all, confirmed before asking. New test infrastructure:
`testing/child-server.ts` (spawns real `node src/server.ts`/`jobs/worker.ts` OS processes,
HTTP-poll or real-log-line readiness detection) and `testing/child-process-db.ts` (a
dedicated full PostgreSQL database per spawned-process suite, since a real child process
needs its own connectable `DATABASE_URL`). **A real, previously-undiscovered production
defect found and fixed**: the first live SIGTERM-mid-request test failed consistently (not
flakily) — Fastify's default `forceCloseConnections: 'idle'` force-closes any connection
Node's own idle-heuristic considers inactive, and that heuristic looks at socket-level I/O,
not the application handler's lifecycle, so a request whose handler was still mid-database-
transaction (no socket I/O at that instant) was silently killed on every graceful shutdown —
a defect present since `server.ts` was first written in PV1, never caught because nothing had
ever exercised a real OS-level kill against a real in-flight request before. Root-caused with
a minimal reproduction outside this app before touching production code. Fixed with the
standard "grace period, then force" pattern (`server.ts` only — dozens of existing test files
rely on Fastify's normal idle-connection-closing behavior for their own WebSocket-test
cleanup, so the override is scoped narrowly via a new `AppDeps.forceCloseConnections`, not
applied globally): a 500ms grace window lets a genuinely in-flight request finish naturally,
then any still-open connection gets force-closed, with a 10s hard backstop. Tuning this took
two more iterations, both caught live: the naive all-or-nothing fix reintroduced a full
10-second delay on *every* shutdown (confirmed by the test's own timing pinning to the hard
timeout), and the first version of the fix hung the entire `apps/api` test suite (a
concurrently-running WebSocket test's own `app.close()` call never returned) before being
scoped to `server.ts` only. Also closed two real, previously-untested coverage gaps: **#14**
(the existing concurrent-contribution test only raced one participant against itself — a new
test races two genuinely different participants, proving the D5 single-resolver fires exactly
once even when two independent requests could each plausibly believe they completed funding)
and **#16** (the existing token test only covered reuse of an already-rotated refresh token —
new tests age a real refresh token's `expires_at` into the past directly in PostgreSQL and
construct a real backdated-`exp` JWT access token, proving actual TTL expiry is enforced, not
just reuse detection). **#6** (app backgrounding) went from zero test coverage of the real
`AppLifecycleListener` wiring (only its pure backoff/connectivity helper functions were
tested) to three new tests walking the actual Flutter lifecycle transition sequence — caught
a real test-writing gotcha along the way: `AppLifecycleListener` enforces the genuine OS
sequence (`resumed → inactive → hidden → paused`) via internal asserts, and a direct
`resumed → paused` jump is silently a no-op, not an error, which is what made the first
version of this test fail confusingly until diagnosed by reading Flutter's own SDK source.
**`apps/api` 269/269** (up from 260), **`apps/mobile` 254/254** (up from 251, `flutter
analyze` unchanged at the 26-issue baseline), **`packages/application` 137/137** unchanged
(confirms this milestone stayed entirely inside the transport/client layers).
`pnpm typecheck/lint/format:check/guard` clean, 12/12 packages. Disclosed gaps: #15 not built
(owner choice); #1–4/#17 certified locally only, not against hosted Railway (no credentials
here); the new Redis/Postgres-restart suite (`eng9-infra-restart.manual.ts`, deliberately
excluded from the default `npm test` glob after it broke a concurrently-running suite on its
first real run — `node --test` runs test files in parallel by default, and this suite stops
shared local infrastructure) is not CI-wired, since `brew services` has no equivalent in
GitHub Actions' Docker-service-container topology.

**Real-Money Beta track opened (D47, 2026-07-28).** The owner supplied and approved a full
"VinkIn Real Money Beta" specification — VinkIn as the legal cardholder, every card spending
from VinkIn's own Stripe Financial Account, a 15-card reusable pool, a dual-timer lifecycle
(7-minute maximum Vink lifetime, a separate 10-minute card usage window once a card is
assigned), wallet-only card exposure (no "View Card Details" screen anywhere, Apple/Google
Wallet is the sole primary action), beta caps (config, not hardcoded), and a manual-review
dispute policy through the Operations Console. Two further clarifications, confirmed via
direct question during implementation planning: participant payments **capture immediately
per payment** (a real change from today's authorize-then-capture-on-completion engine, not
merely the eventual destination of funds), and **authorizations are approved against the
assigned wallet token, not solely the underlying reusable card** — a real security
requirement (a stale device from a prior assignment must never authorize against a card now
assigned elsewhere), not a detail. Recorded as `D47` in `docs/spec/decision-log.md` (owner
directed recording it now, matching the D45→D46 precedent), explicitly amending D32/D35 (their
own named revisit trigger, "M0 gate closure / provider selection," is this decision) and the
reconciliation module's own "no route here can move money or issue a refund" guarantee
(amended to allow one new, narrowly-scoped, audited operator-refund route for disputes — RM6's
job, not built yet). `docs/architecture/06-milestone-0-gate.md` gained a second, narrow
sandbox-only carve-out (alongside D46's) permitting the full Real-Money Beta architecture,
including card-display UI — previously unconditionally Forbidden — against the sandbox
provider only. **This does not close the M0 gate**: it advances conditions #2
(cardholder/account ownership, now defined) and #3 (funds-flow documented —
`docs/feasibility/funds-flow.md` rewritten from a generic placeholder to the actual decided
architecture) and leverages #7's existing passing sandbox suite, but conditions #1/#5/#6/#8/#10
still need external evidence (provider written confirmation, KYC program, counsel review, a
risk register) per the gate's own rule that a condition without a linked evidence artifact is
not met regardless of internal approval. Two things explicitly disclosed as still blocked,
not guessed around: real Apple/Google Wallet push-provisioning needs the same class of
external credential Sign in with Apple/Google (ENG5) and Android App Links (ENG4 Slice 10)
already hit; VinkIn's own real Stripe Financial Account is an owner-side Stripe action, not
code. A 7-slice breakdown (RM1–RM7) was planned and approved (plan file:
`declarative-roaming-hanrahan.md`) — schema/domain model, provider-interface/wallet-token
methods, the capture-timing funding-engine change, the dual-timer Vink/card lifecycle, wallet
provisioning, ops-console dispute review, beta-cap configuration, in that recommended order.

**RM1 done** (`milestone-reports/RM1-CARD-POOL-SCHEMA.md`): the card pool schema and domain
model, built entirely additively — `temporary_cards` and the existing one-shot-per-Vink
`provisionCardCommand`/`authorizeMerchantPurchaseCommand`/`settlePurchaseCommand` flow are
untouched, same "code-complete, not yet wired into the live path" shape as ENG8's `vinkin_app`
role and ENG6 Slice 4's webhook ingestion. New migration `0024`: `cards` (long-lived,
reusable — the structural inverse of `temporary_cards.vink_id UNIQUE`), `card_assignments`
(`UNIQUE(vink_id)` + a partial `UNIQUE(card_id) WHERE status='ACTIVE'` — the actual DB-level
guarantee that a card belongs to one active Vink at a time), and `card_wallet_tokens` as its
own table (not a column) since the token, not the card, is the real authorization-time
identity per D47's clarification. New domain types (`Card`/`CardAssignment`/
`CardWalletToken`) and a new Vink state-machine transition, `CARD_WINDOW_EXPIRED`
(`CARD_READY → FUNDING_REVERSAL`) — the card-phase half of the dual-timer model; the state
machine's own exhaustiveness test and `apps/api`'s exhaustive `DomainEventName →
ClientMessageType` map both caught the gap immediately, exactly as designed. New
`reserveCardFromPoolCommand`/`returnCardToPoolCommand` (`packages/application/src/
card-pool.ts`), with `FOR UPDATE SKIP LOCKED` reservation (the same concurrent-claim idiom the
outbox publisher/reconciliation runner already use) and `returnCardToPoolCommand` enforcing
the load-bearing security property — a card cannot return to (and become reassignable from)
the pool until its assignment's wallet token is confirmed REVOKED, fail-closed on a missing
token row, not assumed harmless. Proven at two levels: 6 in-memory unit tests
(`packages/application`) and 2 real-PostgreSQL integration tests (`apps/api`) — including a
genuinely concurrent 5-way `Promise.allSettled` race for one seeded card (exactly one
reservation wins, the other four see `CARD_POOL_EXHAUSTED`, exactly one `card_assignments` row
exists), proving `FOR UPDATE SKIP LOCKED` is doing real work, not just the application-layer
pre-check. **`packages/domain` 48/48** unchanged (exhaustiveness test updated, not weakened),
**`packages/application` 143/143** (up from 137), **`apps/api` 271/271** (up from 269),
`pnpm typecheck/lint/format:check/guard` clean, 12/12 packages. Disclosed gaps, all
deliberately out of RM1's own scope: not wired into the live FUNDED-Vink flow (RM2/RM3's job);
no provider calls anywhere in this slice (RM2/RM5's job — tests simulate the wallet-token
lifecycle via direct writes, standing in for what RM2's real provider calls will eventually
drive); no pool-seeding mechanism (needs real Stripe Issuing cards, blocked on the same
Financial Account v2 wall ENG6 flagged); `CARD_WINDOW_EXPIRED` has no sweep triggering it yet
(RM4's job).

**RM2 done** (`milestone-reports/RM2-CARD-PROVISIONING-LIFECYCLE.md`): the provider-boundary
half of the card pool lifecycle — enable/disable a pool card, provision/revoke its wallet
token, the token (not the card) as the real authorization-time identity per D47's own
clarification. `FinancialProvider` gained `enableCard` (no prior inverse of `freezeCard`
existed), `freezeCard` renamed `disableCard` (confirmed zero production blast radius before
renaming), `getCardStatus`, and four wallet methods — touching the interface, the D7
conformance suite, the mock, and the Stripe adapter together per the hard rule. New
`walletProvisioning` capability flag (mock: `true`; Stripe: `false`, verified live against the
real sandbox — card creation itself is still blocked on the same Financial Account v2 wall
ENG6 already documented, so there's no real card to provision a wallet token against yet — not
guessed, not simulated). `WalletProvisioningPayload` keeps `provisioningData: Record<string,
unknown>` deliberately opaque rather than encoding Apple/Google-specific field names, per the
owner's own explicit scoping caution. New migration `0025`: `cards.status` gains `QUARANTINED`;
`card_assignments` gains a `provisioning_status` sub-machine (`RESERVED → ENABLING →
AWAITING_WALLET_PROVISIONING → READY_TO_PAY`, teardown `DISABLING →
TOKEN_REVOCATION_PENDING → SANITIZED`) layered *alongside*, not merged into, RM1's own
`status` column — deliberate, to avoid touching RM1's already-proven constraints/tests. New
commands `enableCardCommand`/`provisionWalletTokenCommand`/`disableCardCommand`/
`revokeWalletTokenCommand` (`packages/application/src/card-pool.ts`), each idempotent and each
routing every provider call through `callProviderOrQuarantine`, which quarantines the
underlying card on a genuinely ambiguous (`UNKNOWN_OUTCOME`) provider outcome.

**A real bug, caught by the live-Postgres integration test itself**: the first cut of
`callProviderOrQuarantine` wrote the quarantine and then threw, both from inside
`ctx.uow.run(...)` — throwing from inside `sql.begin(...)` rolls back the *whole* transaction,
silently undoing the quarantine write. The exact same defect class `purchases.ts`'s own header
comment already documents from PV3. Fixed by having the helper return a
`{kind:'OK'|'ERROR', ...}` outcome instead of throwing; all four commands now check the
outcome only after their transaction has committed, re-throwing then. Re-running the
integration test that first caught this (real Postgres, a genuinely ambiguous provider
outcome) now correctly shows `cards.status = 'QUARANTINED'`.

The owner's own specified completion test — Card A serves Vink 1 (reserve → enable → provision
Token 1), is fully torn down (disable → revoke → return to pool), then genuinely serves Vink 2
(reserve → enable → provision Token 2), with Token 1 proven dead forever and only Token 2 valid
— passes at both layers: `packages/application/src/card-pool.test.ts` (in-memory) and
`apps/api/src/card-pool.integration.test.ts` (real PostgreSQL + a real seeded provider card via
`createCardholder`/`issueTemporaryCard`/`disableCard`, real HTTP-created Vinks via
`app.inject()`). **`packages/domain` 48/48** unchanged, **`packages/application` 147/147** (up
from 143), **`apps/api` 273/273** (up from 271), **`packages/payment-provider-contract-tests`
31/31** against the mock (up from 26) and **14/14** passing with 16 disclosed skips against the
real Stripe sandbox (up from 9/9, 11 skips — the 5 new skips are exactly the wallet/enable
tests, all skipped for the same disclosed reason), `pnpm typecheck/lint/format:check/guard`
clean, 12/12 packages. Disclosed gaps, all deliberately out of RM2's own scope: still not wired
into the live FUNDED-Vink flow, `authorizeMerchantPurchaseCommand`'s decision logic still
doesn't check the presented wallet token (RM3's job); Stripe wallet provisioning remains
genuinely blocked, not simulated; no pool-seeding mechanism yet (same Financial Account wall);
`returnCardToPoolCommand`'s own gate is unchanged from RM1 by design.

**RM3A done** (`milestone-reports/RM3A-CAPTURE-IMMEDIATELY.md`, owner-directed split of RM3
into RM3A/RM3B, checkpointed independently): the capture-immediately funding engine — the
single highest-risk slice in the RM plan, since it changes when real money moves. Full audit
first (not assumptions): the contribution state machine already modeled `CAPTURE_RESULT_
UNKNOWN`/`RESOLVED_CAPTURED` but neither was ever fired in application code; `resolve
ContributionCommand` had no branch at all for a provider `CAPTURED` status — both closed by
this slice. **The central design conflict, resolved and disclosed**: the owner's own proposed
`EXPIRED → REFUNDS_PENDING → REFUNDED` sequence would make `EXPIRED` — a tested terminal state
with no exits — non-terminal; resolved by mirroring the existing `RECOVERY_REQUIRED`/
`RECOVERY_PENDING` precedent, with two new **non-terminal** states (`REFUNDS_PENDING`,
`REFUND_RECOVERY_REQUIRED`) sitting before the still-true-terminal `EXPIRED`. New
`captureImmediately` helper (`packages/application/src/contributions.ts`) captures each
contribution the moment it authorizes — same two ledger postings this codebase always inserted
at capture time, just moved earlier per contribution, not batched. `resolveFunding`'s failure
branch now refunds every `CAPTURED` contribution (reusing `refunds.ts`'s newly-exported
`refundOne`) instead of only cancelling holds; a `RESOLUTION_PENDING` contribution is no longer
blindly cancelled there — a new shared `resolveAgainstProviderTruth` helper checks real
provider status first, since that status can now originate from a capture-side ambiguity where
money may genuinely already be captured. A compatibility shim catches up any live contribution
still found `AUTHORIZED` (impossible via the new path, but possible for pre-deploy data) using
the exact original capture logic. New sweep clauses auto-retry `REFUND_FAILED` contributions
and auto-resolve `REFUND_RECOVERY_REQUIRED` vinks. **A real, disclosed finding**: a local
transaction that rolls back after a genuine provider capture but before the contribution row
ever persists cannot be safely retried by a plain client call — the fresh contribution id
changes the provider call's own metadata, so the provider's own idempotency guard correctly
**refuses** the replay (§12's own "different params is a conflict" rule) rather than silently
adopting the earlier capture under an unrelated identity; recovering that specific scenario is
reconciliation's job (proven directly — the same rolled-back capture correctly classifies
ORPHANED), not a client retry. Two of the ten owner-required failure-case tests were already
proven unchanged by existing tests (concurrent-completion race — ENG9 #14; provider capability
gaps — RM2's own tests); two are explicitly out of RM3A's scope (card-pool wiring, deferred to
RM3B); the remaining seven get a new `apps/api/src/rm3a-failure-cases.integration.test.ts`.
**`packages/domain` 48/48** unchanged (5 new states/events, exhaustiveness tests updated not
weakened), **`packages/application` 147/147** unchanged count (4 tests rewritten, not deleted,
to assert the new sequence), **`apps/api` 280/280** (up from 273), Stripe sandbox conformance
re-verified unchanged (14/14, 16 disclosed skips — the interface itself wasn't touched, only
how it's called), `pnpm typecheck/lint/format:check/guard` clean, 12/12 packages. What did NOT
change, by design: `FinancialProvider`, the D7 conformance suite, both adapters, ledger posting
shapes, `packages/reconciliation`, RM1/RM2's card pool, and `provisionCardCommand`/
`purchases.ts` (a FUNDED vink still enters that exact legacy path, unchanged — RM3B's job).

**RM3B done** (`milestone-reports/RM3B-CARD-POOL-CUTOVER.md`): cut the live FUNDED-Vink flow
over to RM1/RM2's card pool and wired the actual security payoff — merchant authorization now
decides against the **presented wallet token**, not just the card's own status. Audit-first
(matching RM3A's own discipline) found this was bigger than "wire the sweep to a new table":
schema surgery (`purchase_authorizations.temporary_card_id` made nullable, new
`card_assignment_id`, mutually exclusive — mirrors the `participants.user_id`/
`guest_identity_id` idiom), a reconciliation-correlation break, an MCC-blocking regression risk
(`enableCardCommand` had no equivalent to legacy `updateCardControls`), and settlement-side
card-pool teardown RM1's own report had already flagged as unbuilt. Owner-confirmed design
choice: the sweep auto-completes reserve → enable → provisionWalletToken (mock-only
synchronous), a disclosed placeholder for RM5's real client-triggered step. New
`provisionCardFromPoolCommand` sequences RM1/RM2's own already-tested commands around the same
Vink transitions the legacy command used (unchanged event names); a best-effort compensating
cleanup (disable/revoke/return) runs on failure so a crash doesn't permanently strand a pool
card, disclosed as not fully crash-resumable (candidate for RM4/production hardening, same
accepted-risk posture as D15). `authorizeMerchantPurchaseCommand`/`settlePurchaseCommand` are
dual-path — a card-pool assignment takes priority, a legacy in-flight vink falls back to the
byte-for-byte-unchanged old path. **A real, additional finding beyond the original 4**:
`getVinkSnapshot` (the organizer's own mobile Lobby) and the PV11 ops console's equivalent
action route/diagnostic view were legacy-card-only — without a fix, every card-pool vink would
show no card at all to the organizer. Found by running the real test suite (the EXIT GATE
test's own snapshot assertion caught it), not by inspection; fixed with new unlocked
`VinkReader` methods and dual-path projections. **`packages/domain` 48/48**,
**`packages/application` 147/147** — both unchanged counts, **`apps/api` 283/283** (up from
280 — 3 new tests: THE SECURITY TEST proving a stale/revoked wallet token is declined even
though the underlying card is still `ACTIVE`; a reassignment-through-the-live-flow test proving
a second Vink's genuine reuse of the same physical card can never be authorized by the first
Vink's old token; and a provider-level MCC-blocking regression test). Stripe sandbox
conformance unchanged (22/22, 16 disclosed skips — the interface itself untouched).
`pnpm typecheck/lint/format:check/guard` clean, 12/12 packages. This closes RM3A's own two
deferred failure cases (#7 pool-exhausted, #8 card-reservation-then-provider-failure), now
reachable through the live sweep. Disclosed, deliberately out-of-scope gap found along the way:
the public simulator route's merchant-authorization endpoint has a pre-existing, RM3B-unrelated
quirk where a provider-side MCC decline doesn't actually stop it from calling VinkIn's own
engine — not fixed here (the new MCC regression test verifies the provider-side control
directly instead, which is what RM3B's own fix actually governs).

**RM4A done** (`milestone-reports/RM4A-DUAL-TIMER-LIFECYCLE.md`): backend dual-timer
lifecycle. An audit found five distinct items: two independent copies of the open-duration
default that could silently diverge (`env.ts`/`commands.ts`); the submission deadline set once
at DRAFT creation and never touched again, burning wizard time into the window; genuinely
inconsistent deadline enforcement (`guest.ts`'s own join check was already strict; member-add
and contribute trusted the sweep alone); the 10-minute card-window sweep 100% unbuilt (RM1
modeled `CARD_WINDOW_EXPIRED`, nothing ever fired it); and a refund auto-chain gap bigger than
the new path alone — the pre-existing RM3B card-provisioning-failure exit had never auto-chained
a refund either. `VINK_OPEN_DURATION_SECONDS` now defaults to `420` (7 minutes, was 24h) in
both `env.ts` and `commands.ts`'s now-exported `DEFAULT_OPEN_DURATION_SECONDS`, guarded by a new
cross-import equality test so the two copies can't silently diverge again;
`VINK_PROCESSING_GRACE_SECONDS` (60s) deliberately unchanged. A shared `computeVinkDeadlines`
helper now backs `createVinkCommand`/`configureVinkCommand`/`openVinkCommand`;
`openVinkCommand` recomputes both deadlines unconditionally at open time — D47's beta model has
no organizer-configurable duration, so whatever DRAFT creation set no longer survives to the
opened row. `addParticipantCommand`/`authorizeContributionCommand` gained the same
`now >= submissionDeadline` check `guest.ts`'s join path already had, so all three entry points
fail closed on the deadline itself, not just on state, ahead of the next sweep tick. New
`expireCardWindowCommand` (`purchases.ts`) fires RM1's own `CARD_WINDOW_EXPIRED` transition for
the first time and tears an unused card back down to the pool, reusing
`settlePurchaseCommand`'s own disable→revoke→return teardown sequence; two new `sweeps.ts`
clauses trigger it and — generically, not scoped to the new path — auto-chain
`refundFailedSessionCommand` for any `EXPIRED` vink with a remaining `CAPTURED` contribution,
closing both the new card-window gap and the pre-existing RM3B one at once. **Disclosed
correction to the plan's own claim**: the plan asserted no more specific error code than
`INVALID_COMMAND` existed for the new contribute-side deadline check — `VINK_NOT_JOINABLE`
does exist (mapped to 410 in the guest-join route), but `INVALID_COMMAND` was kept anyway since
wiring that mapping into two more route modules was judged out of scope; flagged rather than
silently let the inaccurate premise stand. **A second real interaction found only by running
the real tests**: the refund auto-chain fires *inside the same sweep tick* as a
card-provisioning failure, so `recovery.integration.test.ts`'s pre-existing E8 test (written
for a world where only a manual refund call ever refunded anything) started asserting `0 !== 1`
— root-caused to the mock provider's shared failure counter being consumed by
`enableCardCommand`'s failure *and* the compensating cleanup's own `disableCardCommand` call
before ever reaching the auto-chained refund; fixed by queuing three failures with the count
verified empirically, not guessed. Every existing test whose fixtures relied on a short,
explicit creation-time deadline surviving to the opened row (to make sweep-timing tests fast)
broke the same way and was fixed the same way — capturing either sweep outcome, or directly
patching the opened row's deadline via test SQL to simulate time compression, the same
technique this codebase already uses elsewhere for states the command layer wouldn't naturally
produce. One test (`rm3a-failure-cases.integration.test.ts`'s `#4`) had been written
defensively enough to pass vacuously through the regression, silently losing its own intended
race coverage — the fix restores the real race, not just green output. New
`rm4a-dual-timer-lifecycle.integration.test.ts` (4 tests, real PostgreSQL): deadline
recomputed at open (not creation); join/contribute rejected on the deadline itself with **no
sweep ever run**; the card-window sweep reaching `EXPIRED` with the card genuinely back to
`AVAILABLE` and its contribution already `REFUNDED`; the same auto-chain proof for the
card-provisioning-failure path. **`packages/domain` 48/48, `packages/application` 147/147**
unchanged (RM4A stayed entirely inside `commands.ts`/`contributions.ts`/`purchases.ts`/
`sweeps.ts`), **`apps/api` integration 288/288** (up from 284), non-integration 88/88,
`packages/payment-provider-contract-tests` 31/31 and `packages/reconciliation` 16/16 both
unaffected (confirming the provider interface and reconciliation correlation logic are
genuinely untouched), `pnpm typecheck/lint/format:check/guard` clean, 12/12 packages.

**RM4B done** (`milestone-reports/RM4B-COUNTDOWN-TICKING.md`): frontend countdown ticking, the
last piece of D47's dual-timer lifecycle. An audit found the countdown display on both clients
was a pure render-time computation with no periodic re-render — invisible at the old 24h
granularity, would visibly freeze at RM4A's shortened 7-minute default. New
`apps/mobile/lib/design_system/components/vink_deadline_countdown.dart`
(`VinkDeadlineCountdown`, a `Timer.periodic`-driven widget with an injectable clock for
testability, plus `formatTimeRemaining` extending the existing "Xm/Xh/Xd left" format with
seconds below one minute) wired into `_ActiveVinkCardV2` and the Lobby screen — **deliberately
not** the legacy flag-off `_ActiveVinkCard`, which I6 already established must stay
byte-for-byte untouched for rollback. New `apps/guest-web/lib/use-countdown.ts`'s `useNow()`
hook wired into `JoinForm.tsx`, ticking the existing, untouched `countdownLabel` (Phase 6 §13)
instead of evaluating it once. **Disclosed judgment call**: seconds-level display, owner-
approved during RM4A planning, was added on mobile (no ratified copy blocks it) but
deliberately **not** added to guest-web — Phase 6 §13's own ratified, tested copy ("Closes in
under a minute," no numbers) would have been silently overridden by an engineering-track
decision; flagged as open rather than resolved either way. The 10-minute card usage window
remains entirely unsurfaced on both clients — disclosed as out of scope (no existing UI to make
"tick"; adding one would be a new surface, not this slice's narrower fix). **11 new Flutter
tests** (`vink_deadline_countdown_test.dart`, including a widget test proving three real ticks
against an injected fake clock genuinely change the rendered text — not just that the format
function returns the right string), **1 new guest-web Playwright test**
(`rm4b-countdown-tick.spec.ts`) using `page.clock` to deterministically fast-forward the
*browser's* time against a real RM4A-computed 7-minute server deadline — zero real wall-clock
wait, runs in ~540ms, proves the label updates live with no reload. **`flutter test` 265/265**
(up from 254), `flutter analyze` unchanged at the 26-issue baseline; guest-web **44 Playwright
passed** (up from 43), same 8 pre-existing-unrelated failures, `tsc`/`eslint` clean;
`pnpm typecheck/lint/format:check/guard` clean, 12/12 packages. Zero backend files touched.

This closes the full D47 Real-Money Beta dual-timer lifecycle sequence: RM1 (card pool schema)
→ RM2 (provider-boundary lifecycle) → RM3A (capture-immediately funding) → RM3B (card-pool
cutover) → RM4A (backend dual-timer lifecycle) → RM4B (frontend countdown ticking). Remaining
named RM slices: RM5 (wallet provisioning — blocked on external Apple/Google Wallet
credentials, same class of gap ENG5's Sign in with Apple/Google and Android App Links already
hit), RM6 (ops-console dispute review + one scoped, audited operator-refund route), RM7
(beta-cap configuration). Awaiting owner direction on which to take up next.

**SH1 done** (`milestone-reports/SH1-SECURITY-HARDENING.md`, D48) — a new, repeatable
Security-Hardening track (`SH`-numbered, distinct from the fixed ENG0–ENG15 sequence) opened by
an owner-supplied offensive-security brief. Not a rebuild of ENG8 (already closed, one-time,
before the original pilot gate) — a fresh adversarial pass over what changed since, chiefly the
entire RM1–RM4B card-pool/wallet-token/capture-immediately surface, which had never had a
dedicated security review. Two Explore-agent audits mapped the auth surface and cross-checked
existing CI security tooling before any change, matching ENG6 Slice 1/ENG8's own audit-first
precedent. **Real, confirmed IDOR fixed**: `POST .../contributions/:id/resolve` had no
ownership check at all — any authenticated user could resolve, and via RM3A capture-immediately
actually capture money on, any other participant's pending contribution on any vink. Fixed with
a `requester` field on `ResolveContributionInput` (`packages/application/src/contributions.ts`)
enforced for the HTTP route, left `undefined` for the two trusted internal callers
(`jobs/sweeps.ts`, the dev-only simulator resolve-pending route) — proved the regression test
genuinely catches the bug via a `git stash` revert-and-restore, not just asserted. **Real,
confirmed environment-gating gap fixed, flagged to the owner before fixing** (`AskUserQuestion`,
since remediation choice affects legitimate demo/QA flows): all eight `/internal/simulator/*`
dev-utility routes carried zero bearer auth, gated only by an environment allowlist that
includes `demo` — the live hosted pilot's own `VINKIN_ENV` per ENG4's own hosted-activation
note — meaning any internet caller could manipulate any vink's deadline/resolution/refund state
unauthenticated. `MockFinancialProvider` still drives all command execution
(`server.ts:26`, confirmed), so no real money could have moved through it, but it was a live,
unauthenticated cross-tenant hole. Fixed by requiring `requireOperator` (owner's chosen
remediation) on all eight routes; updated all five affected integration test files to
authenticate as an operator. A real local OWASP ZAP scan (installed via Homebrew — this
environment has no Docker, disclosed substitution for the brief's literal docker-compose ask)
found guest-web/operations-console had **zero security headers** at all (ENG8's helmet work
only ever covered `apps/api`) — fixed via `next.config.ts` `headers()` in both apps
(`X-Frame-Options`, a scoped CSP, `X-Content-Type-Options`, `Referrer-Policy`,
`poweredByHeader: false`), deliberately not a full script-src lockdown, the same "don't guess at
a CSP that breaks hydration without dedicated testing" caution ENG8 disclosed for the API's own
CSP. ZAP's one High finding (Path Traversal) was manually reproduced and disproven — a real
false positive. A fresh `pnpm audit` caught **two real CVEs that appeared since ENG8** (a
`brace-expansion` bypass advisory, a second `postcss` lineage via `@tailwindcss/postcss`) — both
fixed via scoped `pnpm-workspace.yaml` overrides, same-major patch bumps with no compatibility
risk (unlike ENG8's rejected major-jump fix for the same package); `pnpm audit` is now clean
with 0 findings and no ignore list at all. Added `.github/workflows/codeql.yml` (the one
concretely-missing CI security item). Secret scanning (gitleaks + trufflehog, full git history
+ uncommitted diff) found 4 raw hits, all confirmed false positives (fake test-fixture secrets,
auto-generated lockfile checksums). **`packages/application` 149/149** (up from 147),
**`apps/api` integration 290/290** (up from 288), guest-web Playwright 44 passed/8 failed
(matches RM4B's own documented pre-existing-failure baseline exactly — no regression),
operations-console Playwright 1/2 (the one failure traced to this local dev database's empty
card pool, a pre-existing environment-seeding gap confirmed via server logs, unrelated to any
SH1 change — the failing test's own comment says "no simulator shortcut," it never touches the
newly-gated routes), `pnpm typecheck/lint/format:check/guard` clean, 12/12 packages throughout.
No Critical/High findings remain unresolved. Disclosed, not built this pass: GitGuardian/Snyk/a
live staging ZAP run (no accounts/URL exist), a full authenticated ZAP crawl behind JWT auth, a
full script-src CSP — each flagged as SH2 follow-up material in the milestone report.

**Email delivery provider done** (`milestone-reports/EMAIL-DELIVERY-PROVIDER.md`) — the owner
supplied a large "RM4D" brief describing the full invitation lifecycle from scratch. Audit
first (RM4D-A) found two things worth flagging before writing code: "RM4D" collides with this
repo's real, unrelated `RM` sequence (Real-Money Beta, D47 — currently on **RM4C**, a hosted
Stripe card-payment-session slice, found actively in progress in a **concurrent session** this
same day, see below); and nearly everything the brief described already exists — guest-specific
D14 hashed `vgt_` tokens, duplicate-send protection (migration `0010`), member-invite
accept/decline (D44), and a provider-neutral `packages/delivery` abstraction, all gated for one
repeatedly-disclosed reason across `env.ts`: "no real delivery provider is selected yet (§4)".
Owner-approved scope via `AskUserQuestion`: close that one real gap — select and wire a real
email provider — not rebuild what already exists. Chose **Resend**; new
`packages/delivery/src/resend/` (`ResendDeliveryProvider`, template rendering for all four
`DeliveryTemplateInput` kinds, HTML-escaped, with a non-production test-mode banner); SMS stays
honestly ungated-as-working (`SMS_NOT_SUPPORTED_BY_RESEND`, no provider selected). `env.ts`'s
four delivery-gated flags (`VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED` et al.) now stay
boot-refused outside development/test **unless** `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are
configured — credential presence is the guard, matching `assertSandboxModeKey`/
`VINKIN_FINANCIAL_PROVIDER`'s own discipline; absent credentials, behavior is byte-for-byte
unchanged. **Real delivery proven, not assumed**: a credential-gated sandbox test
(`VINKIN_RESEND_SANDBOX_TEST=1`, mirrors `VINKIN_STRIPE_SANDBOX_TEST`) sent a real
`guest_invite`-shaped email through the live Resend API using the owner's own verified
`vinkin.org` domain/key; Resend accepted it with a real message id, and **the owner
independently confirmed it arrived** in their real inbox. **Concurrent-session note,
disclosed**: `env.ts`/`server.ts` were found already carrying same-day `RM4C`/`D49` content
when this milestone started editing them; every edit was re-read immediately beforehand and
applied as a clean additive diff (verified via `git diff` after each change) — no RM4C content
was touched or reverted, and `pnpm format:check` warnings in RM4C's own in-flight files
(`webhooks/routes.ts`, `rm4c-payment-session.integration.test.ts`,
`packages/application/src/contributions.ts`) were left alone, not reformatted.
**`packages/delivery` 13/13** offline (+ 1/1 credential-gated real-API test, run manually with
real credentials this session), **`apps/api/src/config/env.test.ts` 12/12** (3 new, 9
pre-existing unmodified), **`packages/application` 149/149** unaffected,
`pnpm typecheck/lint/format:check/guard` clean for every file this milestone touched, 12/12
packages. Every invitation/guest/email-adjacent `apps/api` integration suite re-verified green
individually against real PostgreSQL (`invites` 6/6, `guest-invitation-delivery` 10/10, `guest`
3/3, `email-verification` 9/9, `vinks` 11/11) — a single full-monorepo
`VINKIN_INTEGRATION=1 pnpm test` run hit the same class of shared-local-Postgres parallel-suite
contention `eng9-infra-restart.manual.ts` already documents (worsened by the concurrent
session's own DB activity), disclosed as environment contention, not a regression, and
confirmed by the clean individual re-runs. Not built this pass (already existed, or genuinely
out of scope by the owner's own "close the real gap only" direction): generic share-link
identity isolation, a from-scratch adversarial guest-token-claiming test suite, and SMS
delivery.

**RM4C done, PARTIALLY COMPLETE** (`milestone-reports/RM4C-REALISTIC-PAYMENT-SELECTION.md`,
D49) — "realistic payment selection and Stripe sandbox checkout," an owner brief executed
audit-through-close in one pass per its own "don't stop after the audit" instruction. The
audit found the milestone less greenfield than assumed: a real, tested `StripeFinancialProvider`
sandbox adapter already existed (ENG6, 22/22 contract tests against a real sandbox) with a
working signed webhook route — what was missing was that **neither client ever sent any
payment data at all**; both called a single argument-free
`POST .../contributions/authorize` and the mock decided everything server-side.
**Central design insight**: RM4C-C needed no new resolver — a verified Stripe webhook re-enters
the contribution engine through the EXISTING, SH1-hardened `resolveContributionCommand` (E5's
stuck-pending recovery path) as a trusted internal caller, exactly like `jobs/sweeps.ts`'s own
pattern; the webhook is a TRIGGER to re-check real provider truth (`retrievePaymentStatus`),
never itself the decision — preserving D5 and D15 exactly as ratified, with zero new financial
logic. **`AskUserQuestion`-confirmed architecture decision (D49)**: `VINKIN_FINANCIAL_PROVIDER`
is a single global switch (`mock` default / `stripe_sandbox` opt-in) driving every command's
provider, not per-flow routing — the disclosed trade-off is that RM2/RM3B's card-pool commands
will throw real `NOT_SUPPORTED` in sandbox mode (Stripe's own `walletProvisioning: false`,
unchanged pre-existing gap), never silently emulated. New `FinancialProvider.
createContributionPaymentIntent` (client-secret-based hosted card collection, no pre-attached
payment method) implemented in both the mock and the real Stripe adapter, proven by 3 new
shared contract-suite tests using Stripe's own documented test-PaymentMethod IDs for
server-side confirmation. New `GET /api/v1/payment-methods` (public, pure `paymentModeInfo()`
projection, D13-compliant) reports all four methods with truthful availability — card always
`available`; Apple Pay always `requires_configuration` (no merchant ID/entitlements exist
anywhere, confirmed by audit); Venmo/Cash App Pay always `coming_soon` (no approved adapter,
per D7's own "review before building" rule) — never a button that leads nowhere silently.
**A narrow, disclosed provider-import-guard exception (D49 §3)**: `@stripe/stripe-js`/
`@stripe/react-stripe-js` (browser-only, no secret key, cannot move money alone) were added to
an explicit allowlist in `tooling/scripts/check-provider-imports.mjs` — blocking them would
have made RM4C's own explicit "use Stripe's client-side components" requirement impossible,
since that SDK is designed to be imported straight into the UI; the server-side `stripe`
package guard is completely unaffected. **guest-web**: new Stripe Elements card-entry UI
(`PaymentPanel`/`CardPaymentForm`/`PaymentMethodList`/`SandboxModeBanner`) wired into
`SessionView`'s V2 (flag-on) path only; mock mode renders the pre-existing "Approve $X" button
completely unchanged (`legacyButton`, never touched by new code) — verified via the full
Playwright suite, **44 passed/8 failed, byte-identical to the documented pre-existing
baseline** (confirmed with `git stash` isolation: the same 8 fail identically on unmodified
`main`). **apps/mobile**: `flutter_stripe` added; new `VinkPaymentPanel`/
`VinkPaymentMethodList`/`VinkSandboxModeBanner` wired into both the organizer and participant
Lobby "Pay" buttons the same way (mock mode renders the exact pre-existing `VinkPrimaryButton`
unchanged). **Real native verification, not just static analysis**: a real
`flutter build ios --simulator --no-codesign` succeeded, genuinely fetching Stripe's real
`stripe-ios-spm` Swift package; the built app was installed and launched on a real booted
simulator and confirmed to boot cleanly with no crash (screenshot captured) — proving the
native SDK actually links, not merely that the Dart typechecks. **Adversarial security tests**
(`apps/api/src/rm4c-payment-session.integration.test.ts`, real PostgreSQL, 8 tests) prove: a
provider-side confirmation with no webhook delivered yet never marks a contribution paid; a
duplicate webhook captures exactly once (4 ledger entries, not 8); a non-participant gets 403
creating a payment session; a double-tap session request is idempotent (no fresh secret); a
stale/deadline-passed session is rejected; the guest path works end-to-end through the same
webhook-driven engine. **`packages/payment-provider-contract-tests` 33/33** (up from 30),
**`packages/application` 154/154** (up from 149), **`apps/api` non-integration 97/97** (up
from 91), **`apps/api` integration 307/307** (up from 293), **`apps/mobile` 269/269** (up from
265, `flutter analyze` unchanged at 7 pre-existing issues), `pnpm typecheck/lint/format:check/
guard` clean, 12/12 packages. **PARTIALLY COMPLETE, not COMPLETE**: no Stripe test-mode
credentials exist in this environment — the owner chose (via `AskUserQuestion`) to add them to
`.env` directly rather than paste them into the conversation, but had not done so by session
end, so the real-sandbox-charge/real-webhook/real-screenshot visual-acceptance bar was proven
correct by construction and against the mock, but not exercised against `api.stripe.com`
itself — the milestone report's own "smallest owner-action checklist" names the exact five
steps to close that gap. Apple Pay (no Apple Developer account) and Venmo/Cash App Pay (no
approved adapter, out of scope to build without a review pass) remain genuinely, disclosedly
blocked on external prerequisites unchanged by this milestone.

**RM4C real-sandbox verification, same day**: the owner supplied real Stripe test-mode
credentials mid-milestone. Using them immediately caught **two genuine adapter bugs** the mock
could never have caught: `createContributionPaymentIntent` omitted `allow_redirects: 'never'`
(Stripe rejects a redirect-eligible confirmation with no `return_url` — reproduced live via
`curl` before fixing); and `retrievePaymentStatus` had no way to report a real decline for this
flow at all, since Stripe reverts a declined PaymentIntent's own status to
`requires_payment_method` (retriable), never a terminal state — fixed by inspecting
`latest_charge.status === 'failed'` (the most-recent-attempt-only field, confirmed live, so a
later successful retry on the same intent is unaffected). A **third, real guest-web UX bug**
was found only by manually driving the actual browser: creating a payment session flips
`contributionStatus` to `'processing'` the instant it exists (server truth, delivered almost
immediately over the realtime subscription), which used to correctly mean "nothing left for
the user to do" but for RM4C-C means "still typing the card number" — without a fix the live
update unmounted the real Stripe Elements card form mid-entry; fixed with a new
`paymentInProgress` client flag (`SessionView.tsx`) keeping the panel mounted from session-
creation through confirmation. All three fixes are covered by tests; re-verified 33/33 mock +
17/17 real-sandbox contract tests (16 disclosed issuing-side skips unchanged), **`apps/api`
non-integration 97/97, integration 307/307 (312/312 with credentials present)**,
**`packages/application` 154/154**, guest-web Playwright 44/44 non-baseline. **Real, visual,
browser-driven proof captured** (via `stripe listen` genuinely forwarding Stripe's own
webhooks to this machine): a real Visa test card typed into Stripe's real hosted iframe
resolved to "Everyone's in / $30.00 of $30.00 funded / You're in. / Paid," driven entirely by
the real webhook with zero client-side "mark as paid"; a real always-declining test card
resolved to "Your card has been declined." with a working retry, correctly never counted
toward funding; a separate real-account proof showed a fully-funded single-contributor vink
correctly cascading into RM3B's own pre-existing card-provisioning attempt, correctly failing
(this Stripe account has no Financial-Account-v2 access, the same wall ENG6 already
documented) and correctly auto-refunding via RM4A's own existing refund-auto-chain — proof
RM4C-C's new code integrates cleanly with the entire pre-existing lifecycle, not just in
isolation. **Not captured**: a live on-device `apps/mobile` PaymentSheet interaction — native
`PaymentSheet` is a platform view controller entirely outside Flutter's own widget tree, and
no XCUITest-class automation exists anywhere in this codebase to drive it; the Dart-side code
is identical in provenance to guest-web's now-fully-proven flow and independently verified via
a real `flutter build ios --simulator --no-codesign` (genuinely fetching Stripe's
`stripe-ios-spm` package) installed and launched cleanly on a real booted simulator.
**Disclosed, unrelated**: mid-verification the guest-web Playwright suite briefly showed 8/52
passing instead of 44/8 after a manual API-server restart omitted
`VINKIN_PUBLIC_BASE_URL=http://127.0.0.1:3100` — the exact `localhost`-vs-`127.0.0.1` CORS trap
ENG0/PV13 already flagged as a recurring, still-unfixed footgun; confirmed via git-stash
isolation as environment, not a regression, and resolved by restarting with the documented env
var. **RM4C remains PARTIALLY COMPLETE** by the letter of its own exit criteria (mobile's own
on-device capture is the sole remaining gap — a tooling gap, not a code gap) but every other
criterion, including genuine real-Stripe-sandbox card payments from guest-web, is now fully
met and visually proven, not merely argued correct by construction.

**Product screenshots refreshed** (`milestone-reports/PRODUCT-SCREENSHOTS-REFRESH.md`,
2026-08-05, owner request outside the ENG/RM/PV/SH sequences: "screenshots for all the
workflows in the app"). The PV13-SCREENSHOTS set (2026-07-20) predated the canonical
create flow, the I7 vessel, Invites, and RM4C's real Stripe payment UI. Scoped via
`AskUserQuestion`: core organizer/guest journey + Invites flow, real Stripe sandbox payment,
journey honestly ends at FUNDED (this Stripe account still has no Financial Account v2 access,
so card provisioning can't be faked past that point). **17 real screenshots**, all captured
against a real booted iOS Simulator / real Playwright production build / real local backend +
real `stripe listen` webhook forwarding — 01–07 and 10–13 refreshed, 14–16 new (Invites), 17
new (guest-web's real Stripe Elements card entry — mobile's own native `PaymentSheet` still
can't be driven by touch injection, the same RM4C-disclosed gap). 08–09 deliberately left
stale rather than faked with the mock provider. Caught and fixed/disclosed several real
findings along the way (see the report): a register-screen hit-test-miss now fixed by
`ensureVisible()`-wrapping every tap; a genuine D44×RM4C interaction (an `INVITED` member's
payment-session call is correctly `403` until they accept) never exercised together before;
RM4A's real 7-minute open-window default racing a full real-device capture run; the sweep's
own automatic RM3B card provisioning racing a FUNDED capture and cascading to EXPIRED
(confirmed via direct DB query, not guessed) — worked around for the capture session only,
both reverted after; a byte-identical false-positive screenshot pair caught by diffing MD5s,
not by trusting a passing wait condition; and the exact recurring stale-server-process and
`localhost`/`127.0.0.1` CORS classes of bug this project's own history already documents,
hit again.

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
