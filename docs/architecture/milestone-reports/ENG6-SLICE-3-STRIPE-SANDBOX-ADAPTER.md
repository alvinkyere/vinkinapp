# ENG6 Slice 3 — Stripe Sandbox Adapter

**Date:** 2026-07-26
**Scope:** a real `FinancialProvider` adapter backed by Stripe, running only against real
sandbox/test-mode credentials, per D46's narrow exception to the M0 gate. This is a technical
proof that VinkIn's provider-neutral interface (§43) maps onto a real provider's actual API —
not a production-readiness claim, not a supersession of the M0 gate itself, which still governs
whether this may ever run against live-mode Stripe.

## What was built

**`packages/providers`** — new package, the second (and, per D7/§42, only legal) home for a
provider SDK import besides `packages/payment-provider/src/adapters`. `stripe` `^22.3.2` is its
only dependency.

- **`stripe/config.ts`** — the D46 hard guard. `loadStripeAdapterConfig` reads
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` and fails closed on anything missing;
  `assertSandboxModeKey` rejects any key that isn't unambiguously `sk_test_`-prefixed —
  live key, publishable key, or malformed value alike — unconditionally, in every
  environment. Not a warning, not a soft default: construction itself throws
  `LiveModeStripeKeyRejected`.
- **`stripe/errors.ts`** — two distinct translations, matching the mock's own design
  (`packages/payment-provider/src/errors.ts`): `stripeDeclineReason` maps Stripe's documented
  decline-code vocabulary onto `ContributionDeclineReason` (data, a typed return value);
  `translateStripeError` maps thrown `Stripe.errors.*` subclasses onto `ProviderError` (an
  operational failure). Every specific mapping here was confirmed against the real sandbox
  before being written, not guessed from documentation: `amount_too_large` →
  `AMOUNT_EXCEEDS_AUTHORIZATION`, `payment_intent_unexpected_state` → `INVALID_STATE`, and
  refunds' undocumented no-distinct-code case (`param: 'amount'` + a message pattern) → the
  same. `StripeAuthenticationError`/`StripePermissionError` are rethrown as-is — a
  misconfigured adapter is a bug to crash loudly on, not an operational outcome to classify.
- **`stripe/stripe-financial-provider.ts`** — `StripeFinancialProvider`, all twelve
  `FinancialProvider` interface methods, built on Stripe PaymentIntents (manual-capture flow)
  for contributions and Stripe Issuing for cards. Capabilities are declared honestly, not
  optimistically: `merchantCategoryControls: false` (VinkIn's domain has never defined a
  canonical MCC vocabulary — confirmed by search before writing this — so there's nothing real
  to map `allowedMccs`/`blockedMccs` from yet); `multipleCapture`/`extendedAuthorization`/
  `merchantSpecificControls: false` (real Stripe capabilities, but never exercised against the
  sandbox this pass, so declared `false` rather than assumed, per the package's own "don't code
  around undocumented provider behavior" discipline from Slice 1).
- **`stripe/config.test.ts`** (new this pass, see "Gap found and closed" below) — 8 tests,
  unconditional, no network or credentials required.
- **`stripe/stripe.contract.test.ts`** — runs the *same* shared conformance suite the mock
  runs (D7), against the real sandbox account, gated behind `VINKIN_STRIPE_SANDBOX_TEST=1` so
  it never runs (and never needs credentials) in a normal `pnpm test`/CI invocation without
  them.

**`tooling/scripts/check-provider-imports.mjs`** — a real, previously-undiscovered bug fixed:
the guard's `package.json` dependency check had no approved-directory exemption at all (only
source-file import checks did), making it structurally impossible to ever legally declare a
provider SDK as a dependency anywhere in the repo — the guard would have failed on this
package's own valid `stripe` dependency. Fixed by adding the same exemption check the source-
file path already had; verified in both directions (a real `stripe` dependency in
`packages/providers/package.json` now passes; a temporary decoy dependency added outside an
approved directory was confirmed to still fail the guard before being removed).

## Results against the real sandbox

`VINKIN_STRIPE_SANDBOX_TEST=1 node --test src/stripe/stripe.contract.test.ts`, credentials
from `apps/api/.env` (sandbox/test-mode only, never displayed or committed):

- **14 passed, 0 failed, 11 skipped.**
- Passing: capabilities declaration; idempotent authorization (replay + parameter-conflict);
  all four named decline reasons (generic, insufficient funds, compliance blocked, expired
  method) distinguished correctly; `INVALID_REQUEST` on missing required metadata;
  cancel-before-capture; partial capture; over-capture rejected as
  `AMOUNT_EXCEEDS_AUTHORIZATION`; a second capture rejected as `INVALID_STATE`
  (`multipleCapture: false` surfaced honestly, not silently emulated); refund up to the
  captured total; real webhook signature verification and tamper rejection.
- Skipped (all with an explicit, printed reason — never a silent pass): 7 tests need a
  simulation hook no real sandbox exposes on demand the way an in-process mock can
  (`simulateTransientFailure`/`simulateLostResponse`/`simulateUnknownOutcome`/
  `expireAuthorization`/`resolvePendingAuthorization`/event-duplication/event-reordering); 4
  are the issuing-side tests (see below).

**`stripe/config.test.ts`**: 8/8, unconditional — see "Gap found and closed."

## A shared-suite gap closed this pass: `buildTestEventRawBody`

The webhook contract test originally hardcoded a VinkIn-shaped raw body (the mock needs no
translation, since it already emits VinkIn's own `ProviderEvent` vocabulary). A real adapter's
`parseWebhookEvent` translates the *provider's* own wire shape — a VinkIn-shaped body would
never structurally match what it expects. Added an optional `buildTestEventRawBody` kit hook
(`packages/payment-provider-contract-tests/src/test-kit.ts`); the Stripe kit supplies a real
Stripe event envelope (`{id, object: 'event', type: 'payment_intent.succeeded', data: {object:
{...}}}`), verified against `mapStripeEventType` in the adapter itself. A kit that omits the
hook gets the suite's original mock-shaped default — zero behavior change for the mock's own
25/25.

## A real idempotency-key bug found and fixed via the live sandbox

`freshSlotId()` (the suite's per-test unique-ID generator) used a simple in-process counter.
That's safe against the mock (fresh in-memory state every test run) but not against a real
Stripe sandbox, whose idempotency-key store persists **24 hours server-side**. A rerun within
that window silently replayed stale results from a prior run instead of exercising fresh
behavior. Fixed by adding `randomUUID()` to the generated ID — a real bug the mock could never
have surfaced, only a live provider with real persistent idempotency semantics could.

## Known, disclosed gap: Issuing-side coverage

Four contract-suite tests remain skipped ("no issuing simulation available") because the
Stripe kit supplies no `issueCard`/`merchantAuthorize`/`setBlockedMccs` hooks — Stripe's
sandbox has no on-demand "simulate a merchant authorization" API the way the mock does by
design, only `stripe.testHelpers.issuing.authorizations.create()`, which requires an
**activated** issued card as a precondition.

Investigating whether that test helper could unlock those four tests, direct diagnostic calls
against the real sandbox showed cardholder and card *creation* succeed, but card *activation*
fails with:

```
StripeInvalidRequestError: This cardholder has outstanding requirements preventing them
from activating an issued card.
```

Confirmed via `GET /v1/account` against the real sandbox that this is an **account-level**
gap, not an adapter defect: at the time this was first found, the account had `capabilities:
{}`, `charges_enabled: false`, `details_submitted: false`.

**Update, same day (first pass):** the owner completed the account's general onboarding
(`charges_enabled` and `details_submitted` are now both `true`, most payment-method
capabilities are `active`). Re-checked directly against the live sandbox after that change —
card creation still succeeds, but activation still fails with the identical error. Diagnosed
further via `GET /v1/issuing/cardholders/:id` and `GET /v1/account/capabilities/card_issuing`:
Issuing is a **separate capability from general payments**, currently `"status":
"unrequested"`, `"requested": false`, with its own distinct outstanding requirements —
`business_profile.annual_revenue.{amount,currency,fiscal_year_end}`,
`business_profile.estimated_worker_count`, and `settings.card_issuing.tos_acceptance.
{date,ip}` — none of which the general-payments onboarding step touched.

**Update, same day (second pass):** the owner completed the Issuing-specific requirements too.
Re-checked `GET /v1/account/capabilities/card_issuing` directly: `currently_due` is now empty
— the requirements gate is clear. Attempted to request the capability itself
(`POST /v1/account -d capabilities[card_issuing][requested]=true`) — Stripe rejected this with
`"Only live keys can access this method"`, confirming account-capability requests are a
live-key-only operation regardless of test/sandbox mode. **A live key was never used here** —
that would violate D46's own unconditional guard — so this step genuinely needs the owner's
own Stripe Dashboard action, not an API call this adapter could make even if it tried.

Retried cardholder/card creation directly afterward anyway, in case the Dashboard had already
completed it: cardholder creation still succeeds, but card creation now fails with a
**different, more consequential** error than before:

```
invalid_request_error, param: financial_account_v2
"The v2 financial account id must be specified."
```

This is not the same gap as before. Investigated directly (`GET /v2/financial_addresses`
requires its own distinct API-version header entirely, confirming this is Stripe's newer
Financial Accounts primitive, not a setting) — this specific account has been placed on
Stripe's v2 Financial-Accounts-based Issuing architecture, which requires creating (and, in
practice, funding) a Financial Account — Stripe's own money-movement/balance object — before
any Issuing card can exist at all. That is a materially larger integration than "activate
Issuing," and it sits close to, arguably inside, **ENG6's own declared hard boundary**: "must
not become... bank-account infrastructure." Stopped here rather than building Financial
Account plumbing unilaterally — flagged to the owner per §9 ("spec/product changes are
flagged... never made silently"), not decided on my own. None of the 14 passing tests touch
card issuance, so this gap does not affect the payment/contribution-side result reported
above; `virtualCardIssuing: true` in the adapter's capability declaration reflects the code
path being correctly built against Stripe's *classic* Issuing API, honestly disclosed as
**not sandbox-verified end-to-end** — and now known to require a real product decision (adopt
Stripe's v2 Financial Accounts model, or find a path that avoids it) before it ever could be,
not just a Dashboard checkbox.

## Gap found and closed: the D46 hard guard had zero unconditional test coverage

Before this pass, `assertSandboxModeKey`/`loadStripeAdapterConfig` — the exact code D46
requires to make live-key rejection unconditional — were exercised only indirectly, inside
`stripe.contract.test.ts`, which is itself gated behind real sandbox credentials. In any
environment without those credentials (a normal CI run, a laptop with no `.env`), the one
safety-critical guard D46 exists for had **no test coverage running at all**. Closed by adding
`stripe/config.test.ts` — 8 unconditional unit tests (no network, no credentials) proving:
sandbox key accepted, live key rejected, publishable key rejected, malformed/empty rejected,
both required env vars enforced, and a valid config round-trips correctly. Confirmed via
`pnpm --filter @vinkin/providers test` (no `VINKIN_STRIPE_SANDBOX_TEST` set): 9/9 pass, the
sandbox suite prints its skip message and exits clean — this is genuinely what CI will run.

## Explicitly out of scope for this slice

`apps/api/src/server.ts` still hardcodes `MockFinancialProvider` (`// The only provider until
the M0 gate admits a real adapter`) — this slice does not wire `StripeFinancialProvider` into
the running application. Building a real adapter and proving it against the shared conformance
suite is Slice 3's own scope; wiring it into a live demo path is Slice 7's ("sandbox golden
path"), not invented early here.

## Verification

- `pnpm typecheck`: clean, 11/11 packages (including the new `@vinkin/providers`).
- `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, including the provider-import
  guard fix above (re-verified in both directions).
- `packages/providers`: **9/9** (config guard tests + sandbox-suite skip-message path), no
  credentials needed.
- `packages/providers` against the live sandbox: **14/14 passing, 0 failing, 11 skipped**
  (all with explicit, disclosed reasons).
- `apps/api`: **221/221**, unchanged — confirms zero regression; `StripeFinancialProvider` is
  not yet wired into any application code path.

## Known, disclosed environment gap (unrelated to this slice)

`apps/guest-web` and `apps/operations-console`'s own Playwright suites fail in this
environment with a missing Chromium browser binary
(`chrome-headless-shell-mac-arm64/chrome-headless-shell` not found); `pnpm exec playwright
install chromium` itself failed with `ENOSPC` — the disk is at 99% full (144 MiB free), the
same recurring constraint documented in ENG1/ENG3's own reports this session. Neither app was
touched by this slice; this is a pre-existing local-environment gap, not a regression this
pass introduced, and not fixed here — clearing more disk space was not repeated without the
owner's input given how much cache-clearing has already happened this session.

## Next

ENG6 Slice 4 — webhook ingestion framework (route, dedupe on `(provider, provider_event_id)`,
replay protection, dead-letter), now able to build against the real Stripe adapter's signature
verification (already proven in Slice 3's own webhook test) rather than only the mock's.
