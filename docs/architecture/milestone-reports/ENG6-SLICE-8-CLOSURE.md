# ENG6 Slice 8 — Closure Report

**Date:** 2026-07-27
**Scope:** documentation only, no new code. Summarizes ENG6 ("Financial Provider Readiness
and Integration Boundary") across its seven implementation slices, confirms the brief's own
hard boundaries held throughout, states what remains genuinely open, and gives the owner a
single place to see the whole arc without re-reading seven reports.

## What ENG6 was

An owner-supplied 8-slice brief, run concurrently with the ENG track, with an explicit
"hard boundaries" section up front: **must not become** a public real-money launch, a
fee-model implementation, KYC/AML policy invention, merchant acquiring, bank-account
infrastructure, production card credential exposure, a UI redesign, a Stripe-specific
rewrite of the domain, or automatic reconciliation repairs without reviewed rules. Every
slice below was built and verified against that boundary, not around it.

## The M0 gate question, resolved once, then correctly reopened

Before any code was written, Slice 1's own audit surfaced a real conflict: ENG6 Slices 3–4
(a real provider adapter, a hardened webhook boundary) matched items the repo's own M0 gate
document (`docs/architecture/06-milestone-0-gate.md`) explicitly forbids while the gate is
open. The owner resolved this **twice, in the correct order** — first choosing the
conservative path (**D45**: provider-independent work only, real provider integration
deferred until the gate's ten conditions are met), then, after independently researching how
Stripe's sandbox credentials actually work, reversing that with a real distinction D45 hadn't
drawn: sandbox/test-mode Stripe keys are issued freely, with no business approval, genuinely
decoupled from what the gate's ten conditions govern (live funds-flow approval). **D46**
(ACCEPTED, D45 marked `SUPERSEDED (by D46)` — not deleted, the reversal itself is part of the
preserved record) amended the gate with a narrow, hard-guarded exception: sandbox-mode Stripe
integration is permitted for technical validation and demos, with code-level guards (a
live-mode key must fail to boot, an isolated webhook endpoint/secret, existing off-by-default
flag discipline) — and an explicit statement that this satisfies none of the gate's ten
conditions and authorizes no real-money movement, live issuance, fund custody, or launch.

Every slice from 3 onward was built, and is verified below, against that exact boundary.

## The seven slices

**Slice 1 — Provider capability audit** (`ENG6-SLICE-1-PROVIDER-CAPABILITY-AUDIT.md`): a
full capability/gap matrix against Stripe's real API, checked against the actual
`FinancialProvider` interface and every real provider call site in the codebase — not
assumptions. Surfaced the M0-gate conflict above before any code existed.

**Slice 2 — Adapter contract hardening** (`ENG6-SLICE-2-ADAPTER-CONTRACT-HARDENING.md`):
completed the provider error-classification vocabulary (`INVALID_REQUEST`,
`COMPLIANCE_BLOCKED`, `UNKNOWN_OUTCOME`) and a typed `ContributionDeclineReason` — declines
are data, never a thrown error. 5 new shared-conformance-suite tests against the mock
(25/25). Bundled the D46 amendment.

**Slice 3 — Stripe sandbox adapter** (`ENG6-SLICE-3-STRIPE-SANDBOX-ADAPTER.md`, plus a
same-day update): a real `StripeFinancialProvider` (`packages/providers`) passing the
**identical** shared conformance suite the mock passes, against the real Stripe sandbox:
14/14 passing, 0 failing, 11 disclosed skips. The D46 hard guard
(`assertSandboxModeKey` — unconditional live-key rejection) got its own 8-test unconditional
unit suite, closing a real gap (it had no coverage outside the credential-gated suite before
this). Real bugs found via the live sandbox, not guessed: a shared-suite idempotency-key
collision against Stripe's real 24h-persistent key store; a provider-import guard with no
exemption for legally declaring a provider SDK dependency at all. **Disclosed, unresolved
gap**: the 4 issuing-side contract tests remain skipped. Chased twice as the owner completed
more of Stripe's onboarding (general payments, then Issuing-specific requirements) — each
time surfacing a *deeper* wall, ending at a requirement for Stripe's newer **v2 Financial
Account** primitive, which sits close to (arguably inside) ENG6's own "no bank-account
infrastructure" boundary. Documented precisely, not guessed at, in a separate decision note
(`ENG6-SLICE-5-STRIPE-FINANCIAL-ACCOUNT-NOTE.md`) — the exact request/response, what's
confirmed vs. genuinely unknown, and the minimum architecture cost if ever pursued. No
Financial Account code was written anywhere.

**Slice 4 — Webhook ingestion** (`ENG6-SLICE-4-WEBHOOK-INGESTION.md`): a durable,
provider-agnostic ingestion route implementing §28's rule in order — verify signature, store
raw, dedupe on `(provider, provider_event_id)` — with a dead-letter path for events that
verify but can't be mapped. A real bug caught by its own test: the dead-letter dedupe key
used `randomUUID()` instead of a content hash, so identical retried deliveries produced
duplicate rows — fixed. Wired into `server.ts` behind `VINKIN_STRIPE_WEBHOOKS_ENABLED`, using
a Stripe instance dedicated solely to webhook verification, entirely separate from command
execution.

**Slice 5 — Reconciliation scaffolding** (`ENG6-SLICE-5-RECONCILIATION.md`, owner-scoped with
explicit exclusions: no Financial Accounts v2, no Stripe command adapter, no bank-account
infrastructure): `packages/reconciliation` (pure, zero-dependency classification rules —
`EXPECTED`/`PENDING`/`MISMATCHED`/`ORPHANED`/`UNRECOGNIZED`) plus a runner mirroring the
already-proven outbox-publisher `FOR UPDATE SKIP LOCKED` pattern, giving concurrent-run
safety, crash-safe resumption, and idempotent replay from one mechanism. 13/13 integration
tests prove every named scenario: late captures, reversals, refund mismatches, missing
predecessors, unknown provider objects, out-of-order processing (proven via ordering, not
assumed), replay producing zero duplicates, concurrent runs splitting a batch with no overlap,
full audit-trail linkage, and a dedicated proof that reconciliation never writes to any
financial table.

**Slice 6 — Operations console** (`ENG6-SLICE-6-OPS-CONSOLE-RECONCILIATION.md`, owner brief:
"operational visibility, not financial control"): a read-only console over the webhook inbox
and reconciliation findings — filterable/searchable/paginated lists, a finding-detail page
(linked Vink, linked ledger entries, reconciliation history, audit history, raw payload), a
dead-letter browser with a signature-safe replay button, and an acknowledge/resolve workflow
with mandatory resolution notes. Three real bugs found and fixed: an auth-ordering bug
leaking route shape to unauthenticated callers; a genuine TOCTOU race in the concurrency
guard (fixed by claiming a lock as the very first synchronous statement, before any `await`);
and a frontend/backend content-type mismatch caught live in a real Chromium browser against
the real running server — not by any `app.inject()`-based test, which doesn't replicate real
`fetch()` header behavior. No route in this module has a write path to any financial table,
by construction, not convention.

**Slice 7 — Sandbox golden path** (`ENG6-SLICE-7-SANDBOX-GOLDEN-PATH.md`): the full pipeline
proven twice. First, an automated test: a real Stripe object created directly via the
adapter (never through a command), a real event submitted to the live route, reconciliation
correctly classifying it `ORPHANED` (the accurate outcome — no VinkIn command ever touched
this object), visible and actionable through the real console endpoints. Second, after the
owner authenticated the Stripe CLI, **genuine live delivery**: `stripe listen` +
`stripe trigger payment_intent.succeeded` — Stripe's own servers pushed real events over real
HTTP; verification, mapping, dead-lettering of unmapped types, and reconciliation all behaved
correctly against traffic this session did not fabricate in any way.

## Hard boundaries — verified held, not merely claimed

- **No public real-money launch, no live-mode credentials anywhere.** `assertSandboxModeKey`
  makes a live-mode key fail to construct the adapter at all, in every environment,
  unconditionally — proven by its own 8-test unit suite (Slice 3) and never bypassed once
  across four subsequent slices that all depend on it.
- **No Stripe command adapter wired into the running application.** `apps/api/src/server.ts`
  hardcodes `MockFinancialProvider` for command execution, unchanged since before ENG6 began.
  Every slice's own tests construct their command-execution provider as Mock, matching the
  real running app exactly — confirmed again as recently as Slice 7's live-delivery pass.
- **No Financial Accounts / bank-account infrastructure.** Zero code exists anywhere for
  Stripe's v2 Financial Account primitive; the one place it was even discussed is a
  documentation-only decision note recording what's unknown, explicitly declining to guess or
  build toward it.
- **No automatic reconciliation repairs.** Every classification short of `EXPECTED` produces
  a `proposedRemediation` string — prose for a human — never an executable action. A
  dedicated Slice 5 test and a dedicated Slice 6 test both independently prove no
  reconciliation or console code path writes to `contributions`, `settlements`,
  `purchase_authorizations`, `temporary_cards`, or any ledger table.
- **No KYC/AML policy, no merchant acquiring, no fee-model, no UI redesign, no domain
  rewrite.** None of these were touched by any of the seven slices — confirmed by what was
  actually built, not merely by absence of a change log entry.

## Known, disclosed gaps carried forward (not silently resolved)

1. **Issuing-side capability remains blocked** on Stripe's v2 Financial Account requirement —
   an unresolved provider-account constraint, documented precisely, with explicit open
   questions the owner would need to raise with Stripe or resolve via the Dashboard. The 4
   issuing-side contract-suite tests stay disclosed skips.
2. **No scheduled/recurring reconciliation trigger** — `runReconciliation` is callable
   programmatically and via the console's manual-run button only, per the owner's own Slice 6
   scope ("no scheduler introduced yet").
3. **Manual-run concurrency prevention is single-instance** (an in-process flag), not a
   distributed lock — a disclosed, deliberate scope choice given the pilot's realistic
   single-API-instance topology; the database-level guarantee from Slice 5 remains the actual
   correctness backstop regardless.
4. **Two minor secret-handling slips** during Slice 7's live-delivery verification (an
   unredacted CLI command, a log `tail` that re-displayed a webhook signing secret) — both
   disclosed to the owner immediately, both accepted as no-action-needed (test-mode key; a
   webhook signature cannot be used to derive what it's computed from), both temp files
   deleted.

## Final verification, this pass

- `pnpm typecheck`/`lint`/`format:check`/`guard`: clean, 12/12 packages.
- `apps/api`: **254/254** without Stripe credentials (the CI-representative run); **259/259**
  with real sandbox credentials (adds the 4 Slice 7 golden-path tests plus Slice 4's own
  1 credential-gated Stripe webhook test).
- `packages/application`: 137/137, unchanged across all seven slices — no command or domain
  code was ever touched by ENG6.
- `packages/reconciliation`: 16/16.
- `packages/providers`: 9/9 unconditional (14/14 additional against the live sandbox).
- `apps/operations-console`: `next build`/`tsc`/`eslint` clean; pre-existing Playwright exit
  gates 2/2.

## ENG6 is closed.

All eight slices — capability audit, adapter contract hardening, sandbox adapter, webhook
ingestion, reconciliation scaffolding, operations console, sandbox golden path, and this
closure report — are done. Nothing in this track ever moved real money, touched live-mode
credentials, wrote to a financial table outside the existing command layer, or extended
VinkIn's domain into bank-account infrastructure. The two real disclosed gaps (Issuing's v2
Financial Account requirement, no scheduled reconciliation trigger) are genuinely open
questions for the owner, not gaps this report is closing over.
