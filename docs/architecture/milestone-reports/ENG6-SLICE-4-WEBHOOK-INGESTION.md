# ENG6 Slice 4 — Webhook Ingestion Framework

**Date:** 2026-07-26/27
**Scope:** a durable, deduped, provider-agnostic webhook ingestion route — §28's own rule in
order (verify signature, store raw, dedupe on `(provider, provider_event_id)`) — plus a
dead-letter path for events that verify but can't be structurally mapped. Deliberately does
**not** build any processor that reads these rows and changes Vink/contribution/settlement
state — ENG6's own hard boundary against inventing "automatic reconciliation repairs without
reviewed rules." That's Slice 5.

## What was built

**`apps/api/src/db/migrations/0019_webhook_events.sql`** — the inbox table. `UNIQUE (provider,
provider_event_id)` is the real dedupe guard (PostgreSQL uniqueness, not an app-layer check,
per this codebase's hard idempotency rule). `event_type`/`object_id`/`occurred_at` are
nullable — a dead-lettered event may have no structured shape to record, but the raw body and
error always are. Deliberately not a job-queue table (no `attempts`/lease columns): this slice
builds the durable inbox only, not a processor.

**`apps/api/src/modules/webhooks/routes.ts`** — `registerWebhookRoutes(app, sql, config)`, a
thin, provider-agnostic binding over `FinancialProvider.parseWebhookEvent` (verification is
already inside that call, per its own doc comment — "verification is inherently
provider-specific"). Three outcomes:

- **Invalid signature** → `400`, nothing stored. An unverified body cannot be trusted enough
  to persist.
- **Valid signature, successfully parsed** → `INSERT ... ON CONFLICT (provider,
  provider_event_id) DO NOTHING RETURNING id`. An empty `RETURNING` means this exact event was
  already stored — replay protection: acknowledged `200` identically to a first delivery,
  never reprocessed, never rejected as an error either (rejecting a duplicate would make the
  sender retry it forever, believing it never succeeded).
- **Valid signature, structurally unprocessable** (e.g. an unmapped event type — Stripe's
  adapter throws `NOT_SUPPORTED` for this) → dead-lettered: a row is stored regardless
  (`status = 'dead_letter'`, the raw body, the error message), acknowledged `200` so the
  sender stops resending an event this adapter will never be able to process. Dedupe key is
  the envelope's own `id` field if present (a near-universal webhook convention, confirmed for
  Stripe's real shape in Slice 3), or — this matters — a **SHA-256 hash of the raw body**, not
  a random id (see "Real bug found and fixed" below).

Raw-body capture uses a Fastify content-type parser scoped to this route's own encapsulated
plugin context only (`instance.addContentTypeParser('application/json', {parseAs: 'string'},
...)` inside `app.register(async (instance) => {...})`) — every other route's normal
JSON-object body parsing is untouched by Fastify's plugin encapsulation. Signature verification
needs the exact bytes the provider signed; the default parser re-serializes into an object,
silently breaking every signature check.

The route is unversioned (`/webhooks/...`, not `/api/v1/...`) — a provider's webhook sender
isn't a first-party client the versioning policy governs, the same reasoning that already
carves out `/internal/simulator/*` and `/internal/ops/*`.

**Wiring** (`apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/config/env.ts`):
`AppDeps.webhookRoutes?: WebhookRouteConfig[]` — empty/undefined preserves the exact prior
route surface. `server.ts` populates it with a real sandbox Stripe route only when the new
`VINKIN_STRIPE_WEBHOOKS_ENABLED` flag is `'1'`, constructing a **separate**
`StripeFinancialProvider` instance used only for `parseWebhookEvent` — never the
command-execution `provider` (still `MockFinancialProvider`, unchanged, per Slice 3's own
documented boundary). This satisfies D46's own text verbatim: "a webhook endpoint and signing
secret isolated from any future live-mode endpoint — different route, different secret, never
shared configuration."

**A deliberate deviation from the sibling-flag pattern, disclosed not hidden**:
`VINKIN_STRIPE_WEBHOOKS_ENABLED` is NOT boot-refused outside development/test the way
`VINKIN_APPLE_SIGN_IN_ENABLED`/`VINKIN_EMAIL_VERIFICATION_ENABLED` etc. all are. Those flags
are refused elsewhere because *no real provider capability exists at all yet* outside
dev/test. This flag guards a real, working sandbox capability (Slice 3) that D46 explicitly
permits "for technical validation and demos" without scoping that to any particular
`VINKIN_ENV` value — the actual safety mechanism is `assertSandboxModeKey`: a live-mode-shaped
key fails to construct the adapter at all, in every environment, regardless of this flag. The
credential format is the guard here, not the environment name.

## Real bug found and fixed: dead-letter dedupe key was non-deterministic

The first implementation's fallback dedupe key for a dead-lettered event with no `id` field
was `randomUUID()`. A dedicated test — "a repeated dead-letter delivery of the identical body
is deduped too" — caught it immediately: two deliveries of the byte-identical unparseable body
produced **two** rows, not one, because a fresh random id was minted on every call. Fixed by
hashing the raw body (`sha256`) instead — the dedupe key must be a deterministic function of
content, or replaying an identical delivery defeats the entire purpose of a dead-letter dedupe
key. This is exactly the shape of bug §28's own rule exists to prevent, caught by a test
written specifically to prove replay protection, not by inspection.

## Verified against the real Stripe sandbox, not just the mock

A second, `VINKIN_STRIPE_SANDBOX_TEST`-gated test suite in the same file proves the identical
route against **real** Stripe: a genuinely HMAC-signed Stripe-shaped event envelope
(`t=<timestamp>,v1=<hmac>`, the same signing code Slice 3's own contract-suite kit uses) is
verified, stored, and — on a second identical delivery — deduped. This closes the loop Slice
3's own report left as "Next": ingestion built against the real signature verification Slice 3
already proved.

Also verified with a real running process, not just `node --test`: booted `apps/api/src/
server.ts` with `VINKIN_STRIPE_WEBHOOKS_ENABLED=1` and real sandbox credentials — `POST
/webhooks/stripe/sandbox` returns `400 MISSING_SIGNATURE` (route genuinely live, not a 404),
`/health/ready` unaffected. Then rebooted with the flag off and `STRIPE_SECRET_KEY`/
`STRIPE_WEBHOOK_SECRET` deliberately unset — server boots clean, `/health/ready` still reports
healthy, and the same route now returns a genuine `404` (never mounted) — proving the flag-off
path has zero dependency on Stripe credentials existing at all.

## Tests

- `apps/api/src/webhooks.integration.test.ts`: **6/6** against `MockFinancialProvider` (no
  network, no credentials — what CI runs) covering fresh delivery, replay protection, invalid
  signature (400, nothing stored), missing signature header (400), dead-letter storage, and
  dead-letter dedupe. **+1** against the real Stripe sandbox (credential-gated, skips cleanly
  without them).
- `apps/api`: **227/227** (up from 221 — 6 new, mock-gated ones counted; the 7th is
  credential-gated and doesn't run in a normal `pnpm test`).
- `packages/application`: **137/137** unchanged — confirms this stayed entirely inside
  `apps/api`'s transport layer, no application-command changes.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, 11/11
  packages.
- Real server boot, both directions (flag on with real credentials, flag off with credentials
  deliberately absent) — see above.

## Known, disclosed gaps

- No processor reads `webhook_events` yet — rows accumulate as a durable inbox with no
  business effect. That's Slice 5's explicit job (reconciliation scaffolding), not invented
  early here per ENG6's own hard boundary.
- The dead-letter path is only exercised by the mock (a malformed-JSON body after valid
  signature). The real Stripe `NOT_SUPPORTED` path (an unmapped Stripe event type reaching
  `mapStripeEventType`) is implemented identically but wasn't separately exercised against the
  live sandbox this pass — triggering a specific unmapped Stripe event type on demand isn't
  something the sandbox exposes the way the mock's `JSON.parse` failure does; flagged, not
  silently assumed equivalent.
- `apps/guest-web`/`apps/operations-console`'s Playwright suites remain blocked on the same
  disk-space/missing-Chromium-binary gap disclosed in Slice 3's report — untouched by this
  slice, not re-investigated here.

## Next

ENG6 Slice 5 — reconciliation scaffolding: a processor that reads `webhook_events` rows
(ordered by `occurred_at`, never `received_at`, per §28) and reconciles them against
ledger/settlement state, under reviewed rules rather than automatic repairs (ENG6's own hard
boundary).
