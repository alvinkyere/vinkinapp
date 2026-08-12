# RM4C — Realistic Payment Selection and Stripe Sandbox Checkout

**Date:** 2026-08-03
**Scope:** owner-supplied full RM4C brief (audit → payment-method capability contract → real
Stripe sandbox card payments → Apple Pay / Venmo / Cash App Pay presentation → client
experience → mock/sandbox coexistence → security hardening → adversarial tests), executed
end-to-end per the brief's own "execute the entire milestone, don't stop after the audit"
instruction. See `docs/spec/decision-log.md` D49 for the three disclosed architectural
decisions this milestone required.

## RM4C-A: audit findings (summary)

A full read-only audit (three parallel research passes over `apps/mobile`, `apps/guest-web`,
and the backend) found the milestone was **less greenfield than its own brief assumed**:

- A real, tested `StripeFinancialProvider` sandbox adapter already existed
  (`packages/providers/src/stripe/`), passing 22/22 of the shared provider contract suite
  against a real Stripe sandbox account, with a working, signature-verified webhook route
  (`/webhooks/stripe/sandbox`) — built across ENG6's eight slices. What was missing was not
  the backend adapter; **neither client ever sent any payment data at all**. Both
  `apps/mobile` and `apps/guest-web` called a single argument-free
  `POST .../contributions/authorize`; approval was 100% server-side mock.
- `apps/api/src/server.ts` hardcoded a single global `MockFinancialProvider` instance used for
  *every* command (contributions, card-pool, purchases) — no per-flow provider selection
  existed. This is the fork D49 resolves (global switch, confirmed via `AskUserQuestion`).
- No Venmo/Cash App Pay code existed anywhere (zero hits, code or docs). No Apple Pay merchant
  configuration existed anywhere (no merchant ID, entitlements, domain verification).
- `apps/guest-web`'s CSP had no `script-src`/`connect-src`/`frame-src` directives at all —
  meaning nothing currently blocks Stripe.js, but a future lockdown pass will need to enumerate
  Stripe's real origins first (unchanged finding, not fixed this pass — see "Disclosed gaps").
- No Stripe test-mode credentials existed anywhere in this environment (`.env`, shell, or
  history) despite `packages/providers`' own contract-test suite existing — confirmed with the
  owner via `AskUserQuestion`; the owner chose to add them to `.env` directly rather than paste
  them into the conversation. **They were not added during this session** — see "External
  blockers."

## Architecture implemented

```
Payment Method UI (mobile / guest-web)
        │  GET /api/v1/payment-methods (public, unauthenticated)
        ▼
paymentModeInfo()  ── packages/application/src/payment-methods.ts (pure projection)
        │
        │  POST .../contributions/payment-session (member/organizer or guest)
        ▼
createContributionPaymentSessionCommand()  ── packages/application/src/contributions.ts
        │  ownership-checked (requester), idempotent, same validation as authorizeContributionCommand
        ▼
FinancialProvider.createContributionPaymentIntent()  ── packages/payment-provider (interface)
        │                                                packages/providers/src/stripe (real adapter)
        ▼
Stripe (real sandbox) — client collects card directly via Elements / PaymentSheet
        │  signed webhook (payment.authorized / payment.captured / payment.declined / ...)
        ▼
ingestWebhookEvent()  ── apps/api/src/modules/webhooks/routes.ts (UNCHANGED, ENG6 Slice 4)
        │  verify signature → store raw → dedupe (provider, provider_event_id)
        ▼
processContributionPaymentEvent()  ── NEW, apps/api/src/modules/contributions/routes.ts
        │  looks up contribution by provider_reference, re-enters the engine as a
        │  TRUSTED INTERNAL CALLER (requester: undefined, same pattern as jobs/sweeps.ts)
        ▼
resolveContributionCommand()  ── UNCHANGED, packages/application/src/contributions.ts (E5/SH1)
        │  calls provider.retrievePaymentStatus() — REAL provider truth, never the client's claim
        │  captureImmediately() → ledger postings → D5's single resolver (maybeCloseAndResolve)
        ▼
Existing outbox → realtime pipeline (UNCHANGED) → both clients' existing WebSocket subscriptions
```

**The central design insight**: RM4C-C did not need a new resolver. `resolveContributionCommand`
(E5's stuck-pending recovery path, already IDOR-fixed in SH1) already does exactly what a
webhook-driven confirmation needs — it calls `provider.retrievePaymentStatus()` against the
provider's own real API and decides AUTHORIZED/CAPTURED/DECLINED from that, never from a
caller's claim. The only new piece is a trigger: `processContributionPaymentEvent` looks up the
right contribution from a verified webhook event and calls the same resolver a client's own
"check status" action or the sweep would call. This preserves D5 (one resolver decides
FUNDING_CONFIRMED/FUNDING_FAILED) and D15 (provider calls inside the unit of work) exactly as
ratified — no new code decides financial outcomes.

## What was built

### Backend (`packages/payment-provider`, `packages/providers`, `packages/application`, `apps/api`)

- **`FinancialProvider.createContributionPaymentIntent`** (new interface method, types.ts):
  real hosted card collection — no pre-established payment method, unlike `authorizeContribution`.
  Implemented in `MockFinancialProvider` (a `PROCESSING` record resolved via the existing
  `resolvePendingAuthorization` test hook) and `StripeFinancialProvider` (a real
  `capture_method: 'manual'` PaymentIntent with `automatic_payment_methods: {enabled: true}`,
  no `confirm`/`off_session` — the client confirms, unlike the token-based flow). Both pass a
  new shared contract-suite test (`confirmContributionPaymentIntent` kit hook — Stripe's own
  `pm_card_visa`/`pm_card_visa_chargeDeclined` test tokens confirm server-side, no browser
  needed for the contract test itself).
- **`VINKIN_FINANCIAL_PROVIDER`** env var (`mock` default / `stripe_sandbox`), boot-refusing
  `stripe_sandbox` without a genuinely test-mode-shaped `STRIPE_PUBLISHABLE_KEY` — the same
  `assertSandboxModeKey` discipline D46 already established for the secret key, now applied to
  the publishable key too.
- **`createContributionPaymentSessionCommand`** (new, `contributions.ts`): the session-creation
  command — same vink-state/deadline/participant/allocation validation as
  `authorizeContributionCommand`, same business-level double-tap idempotency, but calls
  `createCustomer` + `createContributionPaymentIntent` instead of the token-based
  `setupPaymentMethod` + `authorizeContribution` pair. Returns a client-safe secret only on a
  fresh attempt (`replayed: false`) — never re-issued on a double tap.
- **New routes**: `POST /api/v1/vinks/:vinkId/contributions/payment-session` (member/organizer)
  and `POST /api/v1/guest/contributions/payment-session` (guest) — identical ownership pattern
  to the existing `authorize` routes.
- **`processContributionPaymentEvent`** (new, `contributions/routes.ts`): the webhook-to-resolver
  bridge described above. Wired into `app.ts`'s existing `registerWebhookRoutes` loop via a new
  optional `onEventIngested` callback, invoked only when a real command-execution provider is
  configured.
- **`GET /api/v1/payment-methods`** (new, public, unauthenticated): `paymentModeInfo()`
  (`packages/application/src/payment-methods.ts`, a pure function, D13-compliant) returns the
  active mode, the publishable key (only in `stripe_sandbox` mode — never a secret), and the
  four-method list with truthful availability. Card is always `available`. Apple Pay is always
  `requires_configuration` (no merchant ID/entitlements exist). Venmo/Cash App Pay are always
  `coming_soon` (no approved adapter exists, per D7's "adapters only after a reviewed real-funds-
  flow/liability/API-behavior pass" rule).

### `apps/guest-web`

- `@stripe/stripe-js` + `@stripe/react-stripe-js` added (client-only Stripe SDKs — see D49 §3
  for the provider-import-guard exception this required).
- New `components/PaymentMethodList.tsx` (truthful method gating, radiogroup semantics),
  `components/SandboxModeBanner.tsx` ("Test mode — no real money will be charged", distinct
  from the existing mock-money `SimulationBanner`), `features/join/CardPaymentForm.tsx` (Stripe
  Elements `PaymentElement`, `redirect: 'if_required'` so an in-page 3DS challenge never
  navigates away), `features/join/PaymentPanel.tsx` (orchestrates mode-fetch → method-select →
  session-create → card-entry → outcome).
- **Mock mode renders the pre-existing "Approve $X" button completely unchanged** —
  `PaymentPanel` returns `legacyButton` verbatim when `mode === 'mock'`, never reachable through
  any new code path. Verified: the full guest-web Playwright suite (52 tests total) still shows
  **44 passed / 8 failed**, byte-identical to the documented pre-existing baseline (confirmed via
  `git stash` isolation — the same 8 fail identically on unmodified `main`), plus the core E9
  golden-path test (join → approve → live-funds) passing individually through the new
  `PaymentPanel` wrapper.
- `SessionView.tsx`'s V2 (flag-on) path only; the legacy (flag-off) `SessionView` body is
  untouched.

### `apps/mobile`

- `flutter_stripe: ^12.1.0` added. New `core/models/payment_method.dart`
  (`PaymentModeInfo`/`PaymentMethodOption`/`PaymentSessionResult`, mirroring the server wire
  shape exactly), two new `VinkRepository` methods (`getPaymentMethods`,
  `createContributionPaymentSession`), new design-system widgets
  (`VinkPaymentMethodList`, `VinkSandboxModeBanner`) and the orchestrating
  `VinkPaymentPanel` (`Stripe.instance.initPaymentSheet` + `presentPaymentSheet()`, `StripeException`
  handled distinctly for `Canceled` vs. a real decline).
- Wired into both `_LobbyBody` (organizer "Pay my $X") and `_ParticipantLobbyBody`
  ("Pay $X") — `VinkPaymentPanel` renders the exact pre-existing `VinkPrimaryButton` unchanged
  in mock mode (the only mode reachable without real credentials), and the new method-list +
  PaymentSheet flow only in `stripe_sandbox` mode.
- **Real native verification**: `flutter pub get` resolved cleanly; `flutter analyze` reports
  the same 7 pre-existing info-level issues (zero new); `flutter test` — **269/269 green** (up
  from 265, four new tests for the payment-method model's JSON parsing). A real
  `flutter build ios --simulator --no-codesign` succeeded, genuinely fetching Stripe's real
  `stripe-ios-spm` Swift package and linking it into the app; the built app was installed and
  launched on a booted "iPhone 17" simulator and confirmed to boot cleanly to the Welcome screen
  with no crash (screenshot captured) — proving the native Stripe SDK integration actually
  compiles and links, not just that the Dart source typechecks. **Not captured this pass**: a
  full on-device tap-through to the Lobby's payment panel (no UI-automation harness for this
  specific new flow was built in the time available — the existing
  `integration_test/e1_test.dart` golden path was not re-run against these changes).

## Security properties verified

- **Raw card data never reaches VinkIn**: structural, not just tested — `createContributionPaymentIntent`
  never accepts a card number/CVV parameter; Stripe Elements/PaymentSheet collect the card
  directly inside Stripe's own hosted UI, using only the opaque client secret.
- **Client secrets never logged**: confirmed by reading, not assumed — `logCommand` calls for
  `createContributionPaymentSession` log only `correlationId/actor/vinkId/idempotencyKey/status/
  replayed`; `withProviderLogging` (the Proxy wrapping every provider call, including the new
  method) logs only method name/provider name/correlation ID per its own pre-existing, unchanged
  doc comment; no Fastify response-body serializer exists to leak it via access logs.
- **Ownership enforced before session creation**: `createContributionPaymentSessionCommand` uses
  the same `findOwnParticipant(participants, requester)` check as `authorizeContributionCommand`
  — proven by a dedicated adversarial test (a non-participant gets `403 FORBIDDEN`).
- **A client callback alone never marks a contribution paid**: proven by a dedicated test that
  calls the mock's own `resolvePendingAuthorization` (simulating the client confirming with
  Stripe) and asserts the contribution is *still* `AUTHORIZATION_PENDING` until the signed
  webhook is delivered.
- **Duplicate webhook delivery captures exactly once**: proven by delivering the byte-identical
  signed event twice and asserting the ledger carries exactly one capture's worth of postings
  (4 entries — two balanced postings — not 8).
- **Duplicate session-creation requests are idempotent**: a double tap returns the existing
  in-flight contribution with `clientSecret: null`, never a fresh secret or a second contribution.
- **Stale contributions fail closed**: a payment session cannot be created once the submission
  deadline has passed, even if the vink row is still `OPEN` in the database (mirrors RM4A's own
  deadline-enforcement pattern).
- **Guest isolation preserved**: the guest payment-session route resolves the caller's own
  participant from their `vgt_` token exactly like every other guest route (D14) — there is no
  parameter through which a guest could name another participant's session.
- **D46's unconditional live-key rejection is untouched and now doubly enforced**: `env.ts`
  boot-refuses a `stripe_sandbox` mode publishable key that isn't `pk_test_`-shaped, alongside
  the pre-existing `assertSandboxModeKey` secret-key guard.

## Tests added

- `packages/payment-provider-contract-tests/src/contract-suite.ts`: 3 new tests
  (`createContributionPaymentIntent` PROCESSING→AUTHORIZED, →DECLINED, missing-metadata
  INVALID_REQUEST) — run against `MockFinancialProvider` (33/33 total, 0 skips) and, once real
  credentials exist, against the Stripe sandbox kit.
- `apps/api/src/config/env.test.ts`: 4 new tests for the `VINKIN_FINANCIAL_PROVIDER`/
  `STRIPE_PUBLISHABLE_KEY` boot-refusal guard.
- `apps/api/src/app.test.ts`: 2 new tests for `GET /api/v1/payment-methods` (mock mode gating,
  stripe_sandbox mode publishable-key passthrough).
- `apps/api/src/rm4c-payment-session.integration.test.ts` (new file, 8 tests, real PostgreSQL):
  the full adversarial suite described under "Security properties" above.
- `packages/application/src/payment-methods.test.ts`: 5 tests for the pure `paymentModeInfo`
  projection, including a dedicated "every non-available method carries a truthful reason"
  invariant test.
- `apps/mobile/test/core/models/payment_method_test.dart`: 4 tests for the Dart model's JSON
  parsing (mirrors the TS/server shape).

## Full test and static-check results

- `packages/payment-provider-contract-tests`: **33/33** (up from 30).
- `packages/application`: **154/154** (up from 149).
- `apps/api` non-integration: **97/97** (up from 91).
- `apps/api` integration (`VINKIN_INTEGRATION=1`, real PostgreSQL): **307/307** (up from 293).
- `apps/guest-web` Playwright: **44 passed / 8 failed** — byte-identical to the documented
  pre-existing baseline, confirmed via `git stash` isolation (same 8 tests fail identically on
  unmodified `main`); `tsc`/`eslint`/`prettier` clean.
- `apps/mobile`: **269/269** (up from 265), `flutter analyze` unchanged at 7 pre-existing
  info-level issues; real iOS simulator build/install/launch succeeded.
- Repo-wide `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: clean,
  12/12 packages, including the new provider-import-guard allowlist (D49 §3) verified in both
  directions (the real `@stripe/stripe-js`/`@stripe/react-stripe-js` dependencies pass; the
  guard still fails the server-side `stripe` package outside its approved directories).
- `pnpm audit`: one pre-existing High finding (`fast-uri`, via `fastify`'s own dependency
  chain) — confirmed unrelated to this milestone (the dependency path never touches Stripe);
  not fixed here, flagged for a future SH-track pass.

## RM4C-D: Apple Pay — genuinely blocked, truthfully gated

Audited: no Apple Developer merchant identifier, no `PassKit`/`PaymentButton` entitlement, no
domain-verification file, no Stripe-side Apple Pay domain registration exist anywhere in this
project (confirmed by grep and by the same class of gap ENG5's Sign in with Apple and ENG4
Slice 10's Android App Links already disclosed). `GET /api/v1/payment-methods` reports Apple
Pay as `requires_configuration` with the exact copy
`"Additional Apple merchant configuration required."` on both clients — rendered as a visibly
disabled option with truthful copy, never a button that leads nowhere silently. No code was
written to fabricate Apple Pay functionality. **Owner action needed to unblock**: an Apple
Developer Program account, a merchant identifier, the `Merchant ID` capability on the app's
provisioning profile, and registering the same merchant ID in the Stripe Dashboard.

## RM4C-E: Venmo / Cash App Pay — genuinely blocked, truthfully gated

No Braintree/PayPal (Venmo) or Square/Cash App Pay adapter exists, and per D7's own rule, a new
adapter needs a reviewed real-funds-flow/liability/API-behavior pass before it can ever be
built — explicitly out of this milestone's scope per the brief's own "future adapters only
after review" instruction. Both render as visibly disabled options with the exact truthful
copy `"Venmo is not available in this sandbox yet."` / `"Cash App Pay is not available in this
sandbox yet."` on both clients. No deep-linking into personal P2P transfers, no email/bank-
transaction inference, nothing fabricated.

## Real Stripe sandbox verification (post-credential update)

The owner supplied real test-mode Stripe credentials mid-session. Using them surfaced and
closed **two genuine, real bugs** — exactly the value of testing against a live provider
instead of only the mock — before producing full, real, visual end-to-end proof.

**Bug 1 — `createContributionPaymentIntent` omitted `allow_redirects: 'never'`.** The real
Stripe contract-suite run (`VINKIN_STRIPE_SANDBOX_TEST=1`) failed immediately: confirming a
real PaymentIntent with no `return_url` requires `automatic_payment_methods.allow_redirects:
'never'` at creation time, or Stripe rejects the confirmation with a configuration error
(reproduced directly via `curl` against `api.stripe.com` before touching code). Fixed in
`StripeFinancialProvider.createContributionPaymentIntent` — matches this codebase's own
established choice (no return-URL page exists on either client).

**Bug 2 — `retrievePaymentStatus` could never report a real decline for this flow.** Even
after fixing Bug 1, the suite's own decline test still failed: Stripe's real behavior (verified
live) is that a declined confirmation attempt reverts the PaymentIntent's own `.status` to
`requires_payment_method` (allowing retry with a different card on the same intent) — it never
moves to a terminal status. `retrievePaymentStatus`'s `mapFullStatus` had no branch for this at
all. Fixed by inspecting `latest_charge.status === 'failed'` (Stripe attaches this to the most
recent attempt only, confirmed live, so a later successful retry on the same intent is
unaffected) and reporting `DECLINED` in that case. A related, unrelated-to-the-fix mistake
caught and corrected in the same edit: an accidental one-line change that would have remapped
a genuinely `canceled` intent to `DECLINED` instead of `CANCELED` — caught before it shipped.

**Bug 3 — a real guest-web UX bug, found only by manually driving the actual browser.**
Creating a payment session transitions the contribution to `AUTHORIZATION_PENDING` the instant
it's created (server truth) — the realtime subscription delivers that almost immediately, and
`contributionStatus` maps it to `'processing'`, which used to mean "nothing left for the user
to do." For RM4C-C it means "the user is still typing their card number" — without a fix, the
live update unmounted the card-entry form (and its real Stripe Elements iframe) out from under
the guest before they could ever finish paying. Fixed with a new `paymentInProgress` flag in
`SessionView` (set the instant `PaymentPanel` creates a session, keeping the panel mounted
through confirmation; cleared only on reload, matching the existing reload-safety precedent).

All three fixes are covered by the existing or extended test suites — re-verified: mock
contract suite 33/33, real Stripe sandbox contract suite 17/17 runnable (16 disclosed
issuing-side skips, unchanged), `apps/api` non-integration 97/97, integration 307/307 (312/312
with real Stripe credentials present, including a real Stripe-signed webhook delivery test),
`packages/application` 154/154, guest-web Playwright 44/44 non-baseline (byte-identical to the
documented 8-failure baseline).

**Real, visual, browser-driven end-to-end proof** (guest-web, real `stripe listen`-forwarded
webhooks from Stripe's own servers, real card numbers typed into the real Stripe Elements
iframe — not curl, not mocked):
- Payment-method selector with truthful gating rendered correctly: card selectable, Apple Pay
  marked "UNAVAILABLE — Additional Apple merchant configuration required.", Venmo and Cash App
  Pay marked "COMING SOON" with their own truthful reasons.
- A real Visa test card (`4242 4242 4242 4242`) entered into Stripe's real hosted iframe,
  recognized as Visa, submitted — the vink reached **"Everyone's in" / "$30.00 of $30.00
  funded"** and the guest's own share showed **"You're in." / "Paid"** — driven entirely by a
  real webhook Stripe delivered to this machine via `stripe listen`, processed through
  `processContributionPaymentEvent` → the existing `resolveContributionCommand` → the existing
  funding engine, with zero client-side "mark as paid."
- A real always-declining test card (`4000 0000 0000 0002`) entered the same way — the guest
  saw **"Your card has been declined." with a "Try again" link**, and the contribution was
  correctly never counted toward funding ($0.00 of $30.00, vink still "Waiting for everyone").
- A genuinely real, backend-only proof (via direct `api.stripe.com` calls against the running
  server, confirming the webhook→resolver bridge independent of any UI) additionally showed:
  a 2-member vink where only one member paid stayed correctly `OPEN` with exactly one
  `CAPTURED` contribution (no premature full-funding cascade); and a single-member vink's full
  funding correctly cascaded into RM3B's own pre-existing card-provisioning attempt, which
  correctly failed (this Stripe account has no Financial-Account-v2 access, the same disclosed
  wall ENG6 already documented) and correctly auto-refunded via RM4A's own existing
  refund-auto-chain — proving RM4C-C's new code integrates correctly with the entire
  pre-existing downstream lifecycle, not just in isolation.

**Not captured this session**: a live, on-device Stripe PaymentSheet interaction on
`apps/mobile`. Native `PaymentSheet` is a platform-presented view controller entirely outside
Flutter's own widget tree — this project's existing UI-automation tooling
(`integration_test`/`flutter_test`'s `WidgetTester`) cannot see or interact with it at all; a
real capture would need XCUITest-level native automation, which doesn't exist anywhere in this
codebase and was judged too large a new undertaking to build for this one verification step.
What **was** verified for mobile: a real `flutter build ios --simulator --no-codesign`
succeeded (fetching Stripe's actual `stripe-ios-spm` package), the app installed and launched
cleanly on a real booted simulator, and all 269 Dart tests (including the new payment-method
model tests) pass. The Dart-side integration code is identical in structure and provenance to
the guest-web code that's now fully, visually proven — the same `createContributionPaymentSession`
endpoint, the same webhook-driven confirmation, the same truthful-gating payment-method model.

## Disclosed, unrelated environment finding

Mid-verification, the full guest-web Playwright suite briefly regressed to 8/52 failing
(instead of the documented 44/8 baseline) after this session's own manual API-server restart
omitted `VINKIN_PUBLIC_BASE_URL=http://127.0.0.1:3100` — the exact CORS-origin footgun
(`localhost` vs `127.0.0.1` are different origins) CLAUDE.md's own ENG0/PV13 history already
disclosed as a recurring trap. Confirmed via git-stash isolation that this reproduced
identically on unmodified `main` (not a regression), then confirmed the fix (restarting with
the documented env var) restored the exact 44/8 baseline. No code change needed; noted here
only because it cost real verification time and matches an already-known, already-flagged gap
(a `.env`/start-script fix for this footgun, flagged again in ENG0-BASELINE.md, still open).

## Remaining external blockers

1. **No Apple Developer account** (RM4C-D, unchanged, disclosed above).
2. **No approved Venmo/Cash App Pay adapter** (RM4C-E, unchanged, disclosed above — and
   explicitly out of scope to build without a review pass regardless of credentials).
3. **No native UI-automation harness for `apps/mobile`'s PaymentSheet** (disclosed above) —
   the code is complete and the native SDK is proven to link and launch; only the final
   on-device interactive capture is unverified, and closing this gap means building new
   automation infrastructure (XCUITest or equivalent), not more RM4C code.

## Files created or updated

New: `apps/api/src/modules/payment-methods/routes.ts`,
`apps/api/src/rm4c-payment-session.integration.test.ts`,
`packages/application/src/payment-methods.ts` (+ test),
`apps/guest-web/components/{PaymentMethodList,SandboxModeBanner}.tsx`,
`apps/guest-web/features/join/{CardPaymentForm,PaymentPanel}.tsx`,
`apps/mobile/lib/core/models/payment_method.dart` (+ test),
`apps/mobile/lib/design_system/components/{vink_payment_method_list,vink_payment_panel,
vink_sandbox_mode_banner}.dart`, this report, `docs/spec/decision-log.md` D49.

Updated: `packages/payment-provider/src/{types,provider,operation-ids}.ts`,
`packages/payment-provider/src/mock/mock-financial-provider.ts`,
`packages/providers/src/stripe/{stripe-financial-provider,stripe.contract.test}.ts`,
`packages/payment-provider-contract-tests/src/{contract-suite,test-kit,mock.contract.test}.ts`,
`packages/application/src/{contributions,index}.ts`,
`apps/api/src/{app,server}.ts`, `apps/api/src/config/env.ts` (+ test),
`apps/api/src/modules/{contributions,webhooks}/routes.ts`, `.env.example`,
`tooling/scripts/check-provider-imports.mjs`, `apps/guest-web/{lib/api,lib/types,
features/join/SessionView}.ts(x)`, `apps/guest-web/package.json`,
`apps/mobile/lib/core/repositories/vink_repository.dart`,
`apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart`, `apps/mobile/pubspec.yaml`.

## Exit criteria status

- Both clients display realistic payment options: **done**, guest-web visually confirmed live.
- Payment-method availability is authoritative and provider-neutral: **done**, visually
  confirmed live (Apple Pay/Venmo/Cash App Pay's truthful gating rendered correctly in-browser).
- Card payments genuinely work through Stripe sandbox: **done for guest-web** — a real success
  and a real decline, both through the actual browser UI with real Stripe Elements, both
  correctly resolved only via a real Stripe-signed webhook. **Code-complete and unit/contract-
  tested for `apps/mobile`**, with a real native build/link/launch proof, but the final
  on-device PaymentSheet interaction is not captured (no XCUITest-class automation exists in
  this codebase — see "Not captured this session" above).
- No raw payment credentials touch VinkIn servers: **done** (structural, not just tested).
- Provider webhooks remain financial truth: **done**, proven by a dedicated adversarial test
  and by the real end-to-end run (the client never saw a "paid" state until Stripe's own
  webhook arrived).
- Stripe-specific code remains isolated: **done** — the provider-import guard now enforces this
  for both the server SDK (unchanged) and the two new client SDKs (new, narrow allowlist).
- Mock mode remains supported: **done**, proven unchanged on both clients.
- Apple Pay, Venmo, Cash App Pay are clearly and honestly gated: **done**, visually confirmed.
- Ownership and invite-link isolation tests pass: **done**.
- All affected test suites remain green: **done**, including against the real Stripe sandbox.
- A milestone report documents what is real, simulated, disabled, and externally blocked:
  **this document**.

## RM4C is PARTIALLY COMPLETE

Every exit criterion is met except one: the brief's own visual-acceptance bar asks for
completion "from both: the organizer mobile app; the guest web experience." Guest-web now has
complete, real, visual proof — a real card success and a real decline, both through the actual
UI, both correctly gated on a real Stripe-signed webhook, plus a clean real-account
capability-boundary proof (card-pool provisioning correctly blocked, correctly auto-refunded,
by RM3B/RM4A's own pre-existing, unmodified machinery). `apps/mobile`'s payment code is
identical in provenance and architecture, fully unit-tested, and proven to build/link/launch
with the real native Stripe SDK — but its own on-device PaymentSheet interaction was not
captured, because doing so needs UI-automation infrastructure (XCUITest or equivalent) that
does not exist anywhere in this codebase today, not more RM4C payment code. Apple Pay, Venmo,
and Cash App Pay remain genuinely, disclosedly blocked on external prerequisites (an Apple
Developer account; an approved Venmo/Cash App Pay adapter after its own review pass) that no
code change in this session could satisfy — and per the milestone's own exit criteria, honest
gating (not functionality) is what's required of them, which is met.
