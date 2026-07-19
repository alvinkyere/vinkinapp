# Milestone Report — PV12 Prep: Funnel Analytics

Date: 2026-07-19 · Track: product validation · Owner-directed (2026-07-19, in response to a
clarifying question about PV12): "Build funnel analytics instrumentation." Not PV12 itself —
**PV12's exit gate requires an actual closed campus pilot with real people** (≥25 completed
Vinks, ≥75 participant joins, ≥80% organizer task completion, median join-to-contribution
time, top five failure points, no unresolved critical defects), which no amount of code can
satisfy on its own. This milestone builds the instrumentation the pilot will need to measure
its own exit gate — named explicitly as prep work, not a claim that PV12 is done.

## Why this, not something else

Asked directly since PV12 is categorically different from every milestone so far (an
operational/business activity, not an engineering one), the owner chose funnel analytics
over the other options offered (a post-session survey flow, a simulation-disclosure audit).
**D18** records the scoping decision made before writing any code: four of the exit gate's
five measurable numbers are already fully derivable from existing tables — no new
instrumentation needed, only a query (built into PV11's ops console). The one genuine gap is
**failure/abandonment visibility**: a guest who hits "no longer accepting participants" and
leaves, or an organizer whose create-Vink form fails, leaves no trace in `vinks`/
`participants`/`contributions` at all. That gap is what this milestone actually fills.

## What was implemented

**Backend** (`apps/api/src/modules/analytics/`, `apps/api/src/modules/ops/analytics.ts`,
migration `0008_analytics_events.sql`):
- `analytics_events` table: client-reported events, keyed by a client-generated id (not a
  user account — guest-web events happen before any join, so there's often no account yet).
- `POST /api/v1/analytics/events`: public, rate-limited (same `makeRateLimiter` pattern as
  PV4's public join surface), accepts a batch of 1–50 events. No auth — analytics must never
  gate on or be blocked by authentication state.
- `GET /internal/ops/analytics/summary` (operator-gated, PV11's auth): the six-number
  summary. `completedVinks`, `participantJoins`, `organizerTaskCompletionRate`, and
  `vinksCreated` are pure SQL over `vinks`/`participants`. `medianJoinToContributionMinutes`
  uses PostgreSQL's `percentile_cont` over `participants.joined_at` →
  `contributions.updated_at` (at CAPTURED) — a genuine median, not an average, computed
  server-side. `topFailurePoints` aggregates `analytics_events` where `event_name` ends in
  `_failed`.

**guest-web** (`lib/analytics.ts`): a `track(eventName, properties, vinkId?)` function,
fire-and-forget (`keepalive: true`, network failures swallowed — analytics must never break
the actual flow), one event per call. Instrumented: `guest_join_page_viewed` /
`guest_join_lookup_failed` (viewing the pre-join summary), `guest_join_succeeded` /
`guest_join_failed` (the join form), `guest_contribution_approved` /
`guest_contribution_failed` (the approve button).

**mobile** (`lib/core/analytics/analytics.dart`): the `Analytics` interface PV9 already
stubbed (`DebugAnalytics`, wired to three auth events) gained a real implementation,
`HttpAnalytics`, posting to the same backend endpoint — one funnel, two clients, one schema.
Instrumented: `create_vink_submitted` / `create_vink_failed`, `split_applied` /
`split_failed`, `vink_opened` / `vink_open_failed` — the organizer's own E1 task funnel.

**operations-console** (`app/analytics/`): a dashboard page showing all six numbers, with
the pilot's own thresholds (25 / 75 / 80%) checked inline — a ✓ or a plain target label, not
a fabricated pass/fail for the numbers that only carry "measured" as their requirement
(median time) or that this page structurally cannot compute ("no unresolved critical
defects" — noted explicitly as a judgment call to track elsewhere, not silently omitted).

## A real bug found and fixed while building this

`apps/guest-web/features/join/JoinExperience.tsx` still contained a debug loading-state
readout (`Loading… DEBUG hasMounted=... pv.status=...`) left over from PV10's investigation
into Turbopack's dev-mode hydration bug — never actually removed, just no test exercises the
loading state's text content that would have caught it. Found while touching this file to
add tracking, fixed immediately (real users of `apps/guest-web` were seeing internal debug
state in the loading screen since PV10).

## Files changed

New: `apps/api/src/modules/analytics/{routes,store}.ts`, `apps/api/src/modules/ops/analytics.ts`,
`apps/api/src/db/migrations/0008_analytics_events.sql`, `apps/api/src/analytics.integration.test.ts`,
`apps/guest-web/lib/analytics.ts`, `apps/operations-console/app/analytics/page.tsx`,
`apps/operations-console/tests/analytics-dashboard.spec.ts`,
`docs/architecture/milestone-reports/PV12-prep-analytics.md`.
Modified: `apps/api/src/app.ts` (route registration), `apps/mobile/lib/core/analytics/analytics.dart`
(`HttpAnalytics`), `apps/mobile/lib/core/auth/auth_controller.dart` (`analyticsProvider`),
`apps/mobile/lib/features/create_vink/create_vink_screen.dart` (instrumentation),
`apps/guest-web/features/join/{JoinExperience,JoinForm,SessionView}.tsx` (instrumentation +
the debug-text fix), `apps/operations-console/{lib/{api,types}.ts,app/page.tsx}`, status docs.

## Database changes

New migration `0008_analytics_events.sql`: one table, no changes to any existing schema.

## APIs added

`POST /api/v1/analytics/events` (public), `GET /internal/ops/analytics/summary`
(operator-gated).

## UI added

`apps/operations-console/app/analytics/` — the pilot metrics dashboard, linked from the
console's search page.

## Tests added

- `apps/api/src/analytics.integration.test.ts`: ingestion (accepts a batch, rejects an empty
  one), and the exit-gate proof — drives a vink through funding, card issuance, and a real
  merchant capture to COMPLETED, creates a second abandoned (DRAFT) vink to keep
  `organizerTaskCompletionRate` genuinely fractional, reports a failure event, then asserts
  every one of the six summary numbers reflects real computed state (not stubbed). Full
  backend suite after this milestone: **63 tests green** (up from 60), all against real
  local PostgreSQL + Redis.
- `apps/operations-console/tests/analytics-dashboard.spec.ts`: reports one real event through
  the real public endpoint, then drives the console's UI (login → Pilot metrics) and
  confirms that exact event appears in the rendered "top failure points" list — proving the
  full pipeline (client → ingestion → aggregation → dashboard), not just that the page
  renders. Re-ran `apps/guest-web`'s own PV10 exit-gate test (`e9.spec.ts`) as an
  independent, real-browser source of funnel events and confirmed via direct database query
  that `guest_join_page_viewed`, `guest_join_succeeded`, and `guest_contribution_approved`
  events actually landed from that real session, not just synthetic test payloads.

## Known limitations

1. **`medianJoinToContributionMinutes` uses `contributions.updated_at` at CAPTURED as a
   proxy for "when they finished contributing"** — there's no dedicated captured-at column
   (PV5 schema). Accurate in practice (CAPTURED is typically reached in one update from the
   mock provider's synchronous path) but not a dedicated timestamp.
2. **Client-generated `clientId` isn't persisted across app reinstalls** on mobile (an
   in-memory random id per process, not stored) — acceptable for funnel counting (each
   session still reports correctly) but means true per-device session continuity isn't
   tracked. guest-web's `clientId` *is* persisted (localStorage), matching its existing
   session-storage pattern.
3. The dashboard's `organizerTaskCompletionRate` counts a vink as "not completing the task"
   if it's still DRAFT or was CANCELLED — a defensible but not Spec-mandated definition,
   flagged in code and in D18.
4. No cancel-action or lobby-screen failure tracking on mobile — the E1 create/split/open
   funnel is covered; further instrumentation (e.g., cancel failures) was left out to keep
   this milestone to what the exit gate's numbers actually need.

## Security review

- The ingestion endpoint is intentionally public but rate-limited (120/min/IP, same window
  shape as PV4's public join surface) and writes only to a dedicated table — no path from an
  event payload to any domain aggregate.
- `properties` is a JSONB blob accepted from an unauthenticated client; nothing reads it back
  into a trusted context (the dashboard renders it as opaque `count`/`eventName` aggregates
  only, via a fixed SQL `GROUP BY`, never interpolating client-supplied strings into a query).
- No PII beyond what a client already had reason to send (an organizer's own vink id, error
  codes) — no email, password, or token ever appears in a tracked event.

## Next

**PV12 itself** — the actual closed campus pilot — is an owner/operational decision, not
engineering work. This milestone's dashboard is ready to measure it whenever it runs.
