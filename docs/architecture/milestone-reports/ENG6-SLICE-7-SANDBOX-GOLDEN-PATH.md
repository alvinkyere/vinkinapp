# ENG6 Slice 7 — Sandbox Golden Path

**Date:** 2026-07-27
**Scope:** an end-to-end proof that a real Stripe sandbox event flows through webhook
ingestion (Slice 4) → reconciliation (Slice 5) → the operations console (Slice 6), closing
out ENG6's own numbered slice sequence. Preserves every boundary the prior six slices already
established: no Stripe Financial Accounts, no Stripe command adapter wired into the running
application, no production provider activation, provider neutrality throughout.

## What was proven

`apps/api/src/reconciliation-stripe-golden-path.integration.test.ts`, credential-gated
(`VINKIN_STRIPE_SANDBOX_TEST=1`), **4/4** against the real Stripe sandbox and real PostgreSQL:

1. **A real Stripe sandbox object** — a customer, an attached test payment method, an
   authorized-then-captured PaymentIntent — created by calling `StripeFinancialProvider`
   directly (the same pattern Slice 3's own contract-suite kit uses), never through
   `authorizeContributionCommand` or any application command. Every id involved is genuine,
   returned by `api.stripe.com` over a real network call.
2. **A real `payment_intent.succeeded` event**, referencing that real captured PaymentIntent's
   real id, submitted to the live `/webhooks/stripe/sandbox` route on a fully-booted `apps/api`
   instance — the exact route a real deployment mounts. Verified stored (`webhook_events`,
   `event_type = 'payment.captured'`, `status = 'received'`).
3. **Reconciliation correctly classifies it ORPHANED** — not a gap, the accurate outcome:
   because this real Stripe object was created outside the command layer (M0/D15's own
   boundary, unchanged), no `contributions` row anywhere references it. A real provider event
   with no VinkIn-side counterpart is exactly what ORPHANED means (Slice 5's own vocabulary);
   asserting it here proves the pipeline reasons correctly about real data, not that something
   is broken.
4. **The finding is visible, correctly detailed, and actionable through the real console
   endpoints** — `GET .../findings` (filtered by provider + classification), `GET
   .../findings/:id` (raw payload contains the real PaymentIntent id, `linkedVinkId` is
   correctly `null` — there is genuinely nothing to link), and a real
   `POST .../findings/:id/acknowledge` closing the loop with the review workflow too.
5. **The webhook inbox shows the same real event** with a real `occurred_at` sourced from
   Stripe's own event timestamp, not arrival time.

## Genuine live Stripe-initiated delivery — verified same day, after the owner authenticated the CLI

The automated test above proves the pipeline with a locally-signed real event envelope (the
same discipline every prior ENG6 slice used). Separately, once the owner completed `stripe
login` (an interactive step only they could do), true Stripe-initiated delivery was verified
directly against the real running server:

- `stripe listen --forward-to http://127.0.0.1:3000/webhooks/stripe/sandbox` — a real CLI
  session subscribing to this sandbox account's events, with a fresh ephemeral webhook secret
  written into `apps/api/.env` (captured from the CLI's own output redirected straight to a
  file, never displayed).
- `apps/api/src/server.ts` restarted with `VINKIN_STRIPE_WEBHOOKS_ENABLED=1` against that
  fresh secret.
- `stripe trigger payment_intent.succeeded` — a real Stripe API call sequence producing real
  sandbox objects and real events, which **Stripe's own servers delivered** to the CLI
  session, which forwarded them over real HTTP to the live route.
- Four real events arrived and were answered `200`: `charge.succeeded`,
  `payment_intent.succeeded`, `payment_intent.created`, `charge.updated`. Three were correctly
  dead-lettered (none of those three types has a `mapStripeEventType` mapping — accurate
  behavior per Slice 4's own design, not a defect). `payment_intent.succeeded`
  (`evt_3TxxccH2VrKtGRMI1XYAl7lj`, object `pi_3TxxccH2VrKtGRMI1Uksz8bT`) was correctly
  verified, mapped to `payment.captured`, and stored with its real Stripe `occurred_at`.
- Reconciliation, triggered through the real `/internal/ops/reconciliation/run` endpoint,
  examined it and created exactly one finding: `ORPHANED`, reason correctly naming the real
  PaymentIntent id, `correlatedEntityId: null` — accurate, since `stripe trigger` creates
  fixture objects directly against Stripe's API, never through any VinkIn command.
- Confirmed through the real `GET /internal/ops/reconciliation/findings?provider=stripe`
  endpoint — the same API the console UI calls.

This closes the one disclosed gap from the automated test above. Two secret-handling slips
happened during this verification (a CLI command printed the test-mode secret key
unredacted, and a log `tail` re-displayed the webhook signing secret) — both immediately
disclosed to the owner, who confirmed no rotation was needed (test-mode key, and a webhook
signing secret cannot be used to derive the underlying secret it's computed from). Both
temporary log files were deleted after use.

## What this deliberately did NOT do

- **No new UI verification pass.** Slice 6 already proved (real Chromium browser, real
  running processes) that the console correctly renders whatever the API returns; this
  slice's own tests and the live-delivery verification above exercise the identical API
  surface that UI consumes. Re-running a full browser pass for the same rendering logic
  against different underlying data was judged duplicative, not skipped for convenience.
- **No command-layer Stripe wiring.** `apps/api/src/server.ts` still hardcodes
  `MockFinancialProvider` for command execution — unchanged since Slice 3. Both the automated
  test and the live verification construct their command-execution provider as Mock too,
  matching the running application exactly.

## Verification

- `apps/api` **254/254** without Stripe credentials (44 suites, up from 43 — the new golden-
  path suite skips cleanly, confirming it never blocks a normal `pnpm test`/CI run).
- `apps/api` **259/259** with real Stripe credentials (254 + this slice's 4 + Slice 4's own
  1 credential-gated Stripe webhook test).
- `pnpm typecheck`/`lint`/`format:check`/`guard`: clean, 12/12 packages.

## ENG6 status

All seven numbered slices (capability audit, adapter contract hardening, sandbox adapter,
webhook ingestion, reconciliation scaffolding, operations console, sandbox golden path) are
now done. The original brief's own Slice 8 is a closure report — a documentation step tying
the seven together, not new code — not started here pending owner direction on whether to
proceed.

## Next

ENG6 Slice 8 — closure report (documentation only, no new code), if the owner wants ENG6
formally closed out now. Otherwise this is a natural pause point: every ENG6 boundary (D46,
M0, no Financial Accounts, no live command execution) has held across seven slices without
exception, now including verification against genuine, live, Stripe-initiated webhook
delivery — not just locally-simulated signatures.
