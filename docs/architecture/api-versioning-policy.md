# API Versioning Policy

_Written 2026-07-21 as ENG2 Slice A (owner-approved: "Path-param validation at the boundary,
fix the share-links/qr GET-vs-POST mismatch, and write the versioning policy doc"). Every REST
route today lives under `/api/v1/...`; `/internal/simulator/*` and `/internal/ops/*` are
unversioned by design (§4 below). This doc is the rule for what "the API" is allowed to do to
existing callers going forward — organizer Flutter, guest-web, the operations console, and any
future client that isn't in this repo._

## 1. What "the API" means here

Three transports currently exist:

- `/api/v1/*` — the versioned public/semi-public surface: organizer, participant, and guest
  routes, plus the realtime `/live` WebSocket upgrade.
- `/internal/simulator/*` — mock-provider-only, environment-allowlisted (governance §5), never
  reachable outside a non-production `VINKIN_ENV`. Not versioned: it stands in for a real
  merchant terminal that doesn't exist yet, and is expected to be replaced, not evolved.
- `/internal/ops/*` — the PV11 operations console surface, gated by operator auth (D17) on top
  of the same environment allowlist. Not versioned for the same reason: it is an internal tool
  for one console app maintained in this repo, not a contract any external caller depends on.

Everything below applies to `/api/v1/*`. The two `/internal/*` surfaces may change shape
freely as their one console/simulator client changes alongside them in the same commit — that
is a refactor, not a versioning event.

## 2. The additive-change rule (no version bump required)

A change to `/api/v1/*` is **additive** — ships without bumping the version prefix — if and
only if every existing caller that ignores fields it doesn't recognize keeps working
unmodified:

- Adding a new field to a response body.
- Adding a new optional field to a request body or query string, with behavior unchanged when
  omitted (this is the pattern `submissionDeadline`, `creationIdempotencyKey`, and
  `invitationIdempotencyKey` already follow — ENG1 Slices 2/4 and Timer Semantics).
- Adding a new route entirely (a new path, or a new HTTP method on an existing path that
  didn't previously respond).
- Adding a new enum member to a response field, **only** if every existing consumer's handling
  of that field already has a safe default/fallback case for unknown values today — verified
  by reading the consumer, not assumed. (No API response in this codebase currently emits an
  open-ended enum without client-side exhaustiveness checking; before this rule is invoked in
  practice, confirm each real consumer.)
- Loosening a request validation constraint (e.g. making a previously-required field optional,
  widening an accepted range).
- Tightening a *response* guarantee in the caller's favor (e.g. a field that was `nullable`
  becomes always-present) — never the reverse.

This is the same rule the concurrent product-validation track has already been applying
ad hoc (`docs/design/phase-10-implementation-readiness.md`'s "Migration/compat strategy:
purely additive fields — existing clients ignoring the new fields continue to work
unmodified") — this document makes it the general, named policy rather than a per-slice
restatement.

Additive changes are still flagged in the milestone report that ships them (§9 hard rule:
spec/product changes are never made silently) but do not require a version discussion.

## 3. The breaking-change rule (requires a version bump)

A change is **breaking** if an existing caller that does nothing wrong — sends the same
requests it always sent, reads the same fields it always read — gets a different outcome:

- Removing or renaming a response field.
- Removing or renaming a request field, or making a previously-optional request field
  required.
- Changing a field's type or semantic meaning (e.g. `amountMinor` changing from "this
  participant's share" to "the pooled total").
- Changing an HTTP method or path for an existing, in-use route (the share-links/qr POST→GET
  fix in this same milestone was **not** breaking only because no client called those two
  routes yet — confirmed by grepping `apps/mobile`, `apps/guest-web`, and
  `apps/operations-console` before making the change. The same fix made after a client
  existed would require the process below instead).
- Changing a success status code, or changing which error code a given failure now maps to.
- Tightening a response guarantee in a way that breaks the client (a field that was
  always-present becomes conditionally absent).
- Any change to state names, transition events, or ledger semantics — these are governed by
  D11/D12/D5 first; a version bump is secondary to the decision-log entry those already
  require.

**Breaking changes ship as `/api/v2/...`, running side-by-side with `/api/v1/...` until every
known caller in this repo has migrated**, at which point the `v1` route is deleted in its own
commit (not silently — the deletion is itself flagged per §9). VinkIn has exactly three
first-party callers (`apps/mobile`, `apps/guest-web`, `apps/operations-console`), all in this
monorepo — "every known caller has migrated" is verifiable by grep, not guesswork, before a
`v1` route is ever deleted.

There is no whole-API `v2` cutover implied by this — versioning is per-route. A single
breaking route change does not require re-versioning routes that didn't change; `/api/v1/vinks`
and a hypothetical `/api/v2/vinks/:vinkId/split` can coexist.

## 4. Deprecation process

1. The new (`v2`) route ships alongside the old (`v1`) route in the same milestone, both
   fully functional.
2. The old route's handler starts setting a `Deprecation: true` response header (RFC 8594)
   plus a `Sunset` header once a removal date is chosen (never immediately — pick a date after
   every known first-party caller can plausibly have migrated).
3. Every first-party caller (`apps/mobile`, `apps/guest-web`, `apps/operations-console`)
   migrates to the new route — tracked as its own follow-up task, not silently bundled into an
   unrelated milestone.
4. Once grep confirms zero remaining call sites to the old route across all three apps, the
   old route is deleted in a dedicated commit, and the deletion is recorded in
   `docs/spec/decision-log.md` the same way any other spec-shaped change is.

Given VinkIn's actual caller population (three apps, all in this repo, no unknown third-party
integrators during the product-validation track), step 3 is expected to complete inside a
single milestone in practice — this process exists for when that assumption changes (a public
integration surface, a partner API), not because it's currently slow to satisfy.

## 5. Where this doesn't apply yet

- `docs/architecture/06-milestone-0-gate.md`'s real-provider integration is still blocked; this
  policy governs the *shape* of `/api/v1/*`, not the payment-provider abstraction underneath it
  (that's `packages/payment-provider`'s own `capabilities`-flag contract, D7).
- Feature-flagged additive fields gated by an env var (e.g.
  `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`, `VINKIN_CONTRIBUTION_PROJECTION_ENABLED`) are
  already additive by construction — flag-off is byte-for-byte the old response, per each
  flag's own milestone report — so they need no extra versioning step beyond what §2 already
  covers.
