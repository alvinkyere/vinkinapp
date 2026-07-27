# ENG6 Slice 6 — Operations Console (Read-Only Financial Operations)

**Date:** 2026-07-27
**Scope:** owner-scoped brief — read-only operator visibility over the webhook inbox and the
Slice 5 reconciliation engine, an operator review workflow (acknowledge/resolve), a
signature-safe dead-letter replay path, and a concurrency-guarded manual reconciliation
trigger. Explicit prohibition, honored throughout: **no route in this slice can modify a
ledger balance, issue a refund, approve a payment, create a card, retry a provider command,
or edit provider/financial data.** The console is diagnostic, not transactional — by
construction, not by convention: nothing in the new code paths has write access to
`contributions`/`settlements`/`purchase_authorizations`/`temporary_cards`/any ledger table.

## What was built

### Backend

**Migration `0021_webhook_replay_support.sql`** — two additive columns on `webhook_events`:
`signature_header` (the originally-delivered signature, stored so a later replay can
genuinely re-verify it — never returned by any API response, per Security's "never expose
webhook signatures") and `delivery_count` (a real redelivery counter, the "retry count"
field the brief asked for).

**`apps/api/src/modules/webhooks/routes.ts` refactored**: the entire ingestion decision
(verify → store → dedupe) is now `ingestWebhookEvent(sql, config, rawBody, signatureHeader)`,
an exported function the live HTTP route calls, and — verbatim, not a lookalike — the new
replay endpoint calls too. This is the literal mechanism behind "replay always goes through
the normal ingestion path": there is exactly one ingestion code path in this codebase, and
replay invokes it. The dedupe upsert changed from `ON CONFLICT DO NOTHING` to `ON CONFLICT DO
UPDATE SET delivery_count = delivery_count + 1`, giving every redelivery (including a replay)
a real counter without ever creating a second row or reprocessing anything.

**`packages/reconciliation`... apps/api/src/modules/reconciliation/ops-queries.ts`** — the
entire read surface: `listWebhookEvents`/`getWebhookEventDetail` (provider/status/search/date
filters, pagination), `listFindings`/`getFindingDetail` (classification/reviewStatus/provider/
search/date filters, pagination), and `setFindingReviewStatus` — the **only** write in the
file, touching `reconciliation_findings.review_status` only (an operator-annotation column
Slice 5's own migration already scoped as "never auto-advanced by any reconciliation code
path"). `getFindingDetail` resolves everything the brief asked for on one page: the provider
object reference, the linked Vink (via a `correlated_entity_type`-specific lookup — direct for
contributions/purchase_authorizations/settlements), linked ledger entries (joined through
`ledger_transactions.reference_type`/`reference_id`, both the entity's own postings and the
vink-level ones), reconciliation history (other findings for the same correlated entity), and
audit history (reusing PV11/D17's existing `operator_audit_log`, queried by
`details->>'findingId'` — not a new audit mechanism).

**`apps/api/src/modules/reconciliation/routes.ts`** — the transport:

- `GET .../webhook-events`, `GET .../webhook-events/:id`, `GET .../findings`,
  `GET .../findings/:id` — pure reads.
- `POST .../findings/:id/acknowledge` (notes optional), `POST .../findings/:id/resolve`
  (notes **required** — a real Zod-enforced minimum, not just a UI convention) — both write
  only `review_status` + an `operator_audit_log` row (actor, action, timestamp, notes, and the
  previous/new status for a real before/after audit trail).
- `POST .../webhook-events/:id/replay` — resolves the event's `provider` to a
  currently-configured `WebhookRouteConfig` (the exact same map `server.ts` builds for live
  webhook routes) and calls `ingestWebhookEvent` with the stored `raw_body` +
  `signature_header`. Two honest failure modes, never a silent no-op or a fabricated success:
  `409 NO_STORED_SIGNATURE` (a row from before this column existed) and
  `409 NO_INGESTION_PATH_CONFIGURED` (no live route for that provider right now — e.g. the
  Stripe flag is off).
- `POST .../run` / `GET .../run-status` — the manual reconciliation trigger. Concurrency
  prevention is a module-level in-process flag, checked and claimed as the **very first**
  synchronous statement in the handler (before any `await`, including the auth check) — JS's
  single-threaded execution model makes this genuinely atomic against a truly concurrent
  second request, which an auth-then-check ordering would not have been (see "Real bugs
  found" below). Disclosed as a single-instance limitation, not a distributed lock — Slice 5's
  own `FOR UPDATE SKIP LOCKED` inside `runReconciliation` remains the deeper, already-proven
  correctness guarantee regardless (two concurrent runs still couldn't double-process even if
  this flag were somehow bypassed).

`requireOperator` (the operator-token check) is now exported from `modules/ops/routes.ts` and
reused verbatim — not reimplemented — so the two consoles' auth boundaries can never drift
apart.

### Frontend (`apps/operations-console`)

`lib/types.ts`/`lib/api.ts` gained the mirrored types and thin request wrappers (matching this
app's own established convention exactly — raw DB-shaped rows are shown, not a bespoke second
domain model, the same choice `VinkDetail`/`DataTable` already made). New
`components/ReconciliationBadges.tsx` (classification/review-status/webhook-status color
coding). New `features/reconciliation/`: `ReconciliationConsole.tsx` (tabbed
findings/webhook-inbox view, provider/status/classification/review-status filters, search,
pagination, loading/empty states), `RunReconciliationButton.tsx` (triggers a run, polls
`run-status` while one might be in progress, shows the last result), `FindingDetailView.tsx`
(everything `getFindingDetail` returns, plus the acknowledge/resolve form — the Resolve button
is disabled until notes are typed, matching the backend's own required-notes rule). Two new
routes: `/reconciliation`, `/reconciliation/findings/[findingId]`, linked from the existing
Vink-search header.

## Real bugs found and fixed

1. **Auth-ordering bug in acknowledge/resolve** (caught by the AUTHZ test itself): both routes
   validated the request body/params *before* checking the operator token — an unauthenticated
   `resolve` call with no body threw a Zod validation error (`400`) before the auth check ever
   ran, leaking the route's expected shape to an unauthenticated caller instead of a uniform
   `401`. Fixed by restructuring `review()` so auth is checked strictly first; body/param
   parsing happens only after a valid operator is confirmed.
2. **A real TOCTOU race in the concurrency guard**, caught before it ever shipped: the first
   draft checked `runInProgress` *after* `await operatorOrReply(...)`, which would let two
   truly concurrent requests both observe `false` before either set it `true`. Fixed by moving
   the check-and-claim to the first synchronous statement in the handler — JS's execution
   model guarantees this is race-free without needing a database-level lock for it.
3. **A frontend/backend content-type mismatch, caught live in a real browser, not by any
   test**: `replayWebhookEvent` sent a bodyless `POST`, but this app's shared `request()`
   helper always sets `Content-Type: application/json`; Fastify's own JSON parser rejects a
   truly empty body under that header with a raw `500`, not a clean `4xx`. The backend
   integration test never caught this because `app.inject()` doesn't set that header itself
   when no payload is passed — a real gap between the test harness's default behavior and a
   real browser's `fetch()`. Fixed by sending an explicit `'{}'` body, the same pattern
   `triggerReconciliationRun` already used. Found via an actual Playwright script driving a
   real Chromium browser against the real running API + console — not simulated.

## Verified against real running processes, not simulated

A real Chromium browser (Playwright, installed fresh this session), driving the real
production build of `apps/operations-console` against the real `apps/api/src/server.ts` and
real local PostgreSQL/Redis: logged in as an operator, opened the Reconciliation page, saw a
seeded finding in the Findings tab, opened its detail page (raw payload, empty audit history,
ledger section, reconciliation history), acknowledged it (state updated, audit entry
created), switched to the Webhook Inbox tab, saw a dead-lettered row with its retry count and
last error, and clicked Replay — which correctly refused with a real, accurate error
(`NO_INGESTION_PATH_CONFIGURED`, since this boot had no live route for the seeded row's
provider) rather than fabricating a success. This is the run that caught bug #3 above.

Separately confirmed the two pre-existing `apps/operations-console` Playwright exit-gate
tests (PV11, PV12-prep analytics) still pass — 2/2 — after resetting the local dev
database/Redis (a documented, pre-existing environment-cruft issue unrelated to this slice;
see "Known, disclosed gaps").

## Security

- `signature_header` is selected in exactly one place in the entire codebase — the replay
  handler's own targeted `SELECT raw_body, signature_header FROM webhook_events WHERE id =
  ...` — and appears in zero API responses (verified by reading every query in
  `ops-queries.ts`: none select it).
- No secret API key of any kind is ever read by this module — `webhookConfigsByProvider` is
  built once in `app.ts` from the exact same config `server.ts` already constructs for live
  webhook routes; this slice adds no new credential handling.
- Raw provider payload is shown only on the finding-detail and (implicitly, via the same
  detail endpoint) webhook-event-detail views — never in a list response — matching "minimize
  PII" without hiding the one field the brief explicitly required to be visible.

## Tests

- `apps/api/src/reconciliation-ops.integration.test.ts`: **14/14** against real PostgreSQL —
  authorization boundaries (every route, both directions), listing/filtering, finding detail
  shape, the full acknowledge→resolve audit trail (action, actor, timestamp, notes — all
  asserted), the required-notes rule, **concurrent-run prevention** (two simultaneous trigger
  requests via `Promise.all`, exactly one `200`/one `409`, exactly one new
  `reconciliation_runs` row), **replay through the normal pipeline** (same function, real
  re-verification, no duplicate row/work on a repeated replay), the two honest replay-refusal
  paths, replay's own audit entry, and a dedicated **no-financial-mutation** proof
  (byte-identical `contributions` row before/after acknowledge+resolve+replay+run).
- `apps/api`: **254/254** (up from 240 — 14 new), full suite, real PostgreSQL/Redis.
- `packages/application`: **137/137** unchanged.
- `apps/operations-console`: `next build`/`tsc`/`eslint` all clean; pre-existing Playwright
  suite **2/2** (confirmed unaffected after a dev-environment reset).

## Verification

`pnpm typecheck`/`lint`/`format:check`/`guard`: all clean, 12/12 packages. Real server boots
(both the API and the console's production build) confirmed working end to end with real
browser interaction, not just automated assertions.

## Known, disclosed gaps

- Concurrency prevention for the manual run is single-instance (an in-process flag), not a
  distributed lock — disclosed above, deliberate given "no scheduler introduced yet" and the
  realistic single-API-instance scope of this pilot; the DB-level guarantee from Slice 5
  remains the actual correctness backstop regardless.
- The manual run reports progress synchronously at completion (the HTTP response itself),
  plus a pollable `run-status` for "is one happening right now" — not a streaming/incremental
  progress bar. A single batch is fast enough (sub-second for realistic inbox sizes, per
  Slice 5's own tests) that a bigger async-job model wasn't judged worth the added complexity
  here.
- The `apps/guest-web`/`apps/operations-console`-adjacent dev-environment cruft
  (poisoned local dev DB/Redis blocking the sweep scheduler) that briefly caused the PV11
  Playwright test to fail is the same recurring, pre-existing issue documented in earlier ENG1/
  ENG3 milestone reports — not caused by this slice, resolved the same way (reset local
  dev DB/Redis), not a code change.

## Next

ENG6 Slice 7 — sandbox golden path: an end-to-end proof that a real Stripe sandbox event
flows through webhook ingestion → reconciliation → the operations console an operator would
actually use, closing out the ENG6 brief's own numbered sequence.
