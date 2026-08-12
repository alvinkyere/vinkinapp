# Email delivery provider — closing the §4 "no real delivery provider" gap

**Brief origin:** the owner supplied a large "RM4D — Guest Invitation, Email Delivery, and
Identity Isolation" spec, framed as building the entire invitation lifecycle (guest-specific
invitations, token security, identity isolation, generic share links, resend/revoke, SMS,
adversarial tests) essentially from scratch.

## Audit first (RM4D-A), before any code

Two findings changed the actual scope, both flagged to the owner via `AskUserQuestion` before
writing anything:

1. **Naming collision.** This repo already has an `RM1`–`RM4B`(→`RM4C`, in progress
   concurrently this same session — see below) sequence: the *Real-Money Beta* card-pool/
   dual-timer/hosted-payment track (D47), entirely unrelated to invitations. "RM4D" does not
   exist in this repo's history and would have collided with that live sequence. This report
   is filed under a plain name instead, matching the precedent `INVITES.md`/
   `HOME-VISUAL-POLISH.md` already set for owner-directed work outside the numbered
   PV/ENG/RM tracks.
2. **Most of the described scope already exists**, shipped and tested under different names:
   guest-specific invitations with D14 hashed `vgt_` tokens and duplicate-send protection
   (migration `0010`, `INVITE_ALREADY_SENT`); a separate member-invite `INVITED →
   accept/decline` gate (D44, `INVITES.md`); a provider-neutral delivery abstraction
   (`packages/delivery`'s `DeliveryProvider` port + `MockDeliveryProvider`); async dispatch,
   tracing, and metrics for guest-invitation delivery (ENG4 Slices 3–5); resend cooldowns;
   guest identity isolation. The **one real, repeatedly-disclosed gap**, verbatim in five
   places across `apps/api/src/config/env.ts`: *"no real delivery provider is selected yet
   (§4)"* — `VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED`, `VINKIN_EMAIL_VERIFICATION_ENABLED`,
   `VINKIN_PASSWORD_RESET_ENABLED`, and `VINKIN_MAGIC_LINK_ENABLED` were all built and tested
   against the mock provider, all boot-refused in every real environment for this one reason.

Owner-approved scope, via `AskUserQuestion`: **close the real gap only** — select and wire a
real email provider (Resend) into the existing `packages/delivery` abstraction and flip the
existing flags, rather than rebuilding infrastructure that already exists and is already
tested.

## What shipped

- **`packages/delivery/src/resend/`** (new): `config.ts` (`loadResendAdapterConfig` — fails
  closed if `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are missing, mirroring
  `loadStripeAdapterConfig`'s own discipline), `templates.ts` (`renderEmail` — subject/HTML/
  plain-text for all four `DeliveryTemplateInput` kinds: `guest_invite`, `member_invite`,
  `email_verification`, `password_reset`, `magic_link`; VinkIn branding, organizer name,
  purpose, share amount, human-readable deadline, a "Join this Vink" CTA + plain-text URL
  fallback, support/safety copy, a non-production test-mode banner; every untrusted string is
  HTML-escaped), `resend-delivery-provider.ts` (`ResendDeliveryProvider implements
  DeliveryProvider` — constructor-injectable client for testing, same DI pattern
  `StripeFinancialProvider` uses). `resend` `^6.18.1` added as a real dependency of
  `packages/delivery` (this package is not a financial-provider SDK, so it isn't subject to
  `tooling/scripts/check-provider-imports.mjs`'s adapter-directory restriction — confirmed via
  a clean `pnpm guard` run).
- **Contract discipline, same as the mock**: `send()` never throws for an ordinary per-message
  rejection (Resend's own sandbox-domain recipient restriction, validation errors) — those
  resolve `{accepted: false, failureReason}`. It *does* throw for a genuinely misconfigured
  adapter (`missing_api_key`/`invalid_api_key`/`restricted_api_key`), matching the port's own
  documented distinction between "the message bounced" and "the adapter itself is broken."
- **SMS is honestly unsupported**, not silently ignored: a `method: 'SMS'` input resolves
  `{accepted: false, failureReason: 'SMS_NOT_SUPPORTED_BY_RESEND'}` — Resend is email-only, and
  no SMS provider is selected. Matches the brief's own "do not pretend SMS is functional" rule.
- **`apps/api/src/config/env.ts`**: new optional `RESEND_API_KEY`/`RESEND_FROM_EMAIL`, validated
  as both-or-neither. The four delivery-gated flags' boot-refusal logic changed from
  unconditional-outside-dev/test to conditional: refused **unless a real provider is
  configured** — the same "credential presence is the guard, not `VINKIN_ENV`" discipline
  `assertSandboxModeKey`/`VINKIN_FINANCIAL_PROVIDER` already established for Stripe. Absent
  `RESEND_API_KEY`, behavior is byte-for-byte unchanged from before this milestone (proven by
  the pre-existing boot-refusal tests, still passing unmodified).
- **`apps/api/src/server.ts`**: `deliveryProvider` construction is now conditional —
  `ResendDeliveryProvider` when both env vars are set, else the same `MockDeliveryProvider`
  every prior milestone ran against.
- **Real domain, real credentials**: `hello@vinkin.org` (owner-verified in their Resend
  account), the owner's Resend API key. Both live only in the gitignored `apps/api/.env`; only
  placeholder/commented lines were added to the tracked `.env.example`.

## Real end-to-end proof, not just an accepted API call

A credential-gated test (`resend-delivery-provider.sandbox.test.ts`, gated on
`VINKIN_RESEND_SANDBOX_TEST=1`, mirroring `stripe.contract.test.ts`'s own
`VINKIN_STRIPE_SANDBOX_TEST` pattern — skipped by default, no network dependency in CI) sent a
real `guest_invite`-shaped email through the live Resend API to the owner's own address.
Resend accepted it with a real message id (`a3202231-c36f-4b92-9f75-8efe1e0b9697`), and **the
owner independently confirmed the email actually arrived** (inbox, not just spam) — proving
genuine delivery, not merely that the API call succeeded.

## Concurrent-session finding, disclosed

Mid-session, `apps/api/src/config/env.ts` and `server.ts` were found already modified with
`RM4C`/`D49` content (`VINKIN_FINANCIAL_PROVIDER`, a hosted Stripe card-payment-session flow)
dated today — a different session actively working the same repo at the same time, on the real
next RM slice. Every edit in this milestone was re-read immediately before editing and applied
as a clean, additive diff (confirmed via `git diff` after each change) — no RM4C content was
reverted or overwritten. `pnpm format:check` also surfaced formatting warnings in files this
milestone never touched (`webhooks/routes.ts`, `rm4c-payment-session.integration.test.ts`,
`packages/application/src/contributions.ts`, a contract-test file) — left untouched
deliberately, not reformatted, since they belong to that other session's in-flight work.

## Tests

- `packages/delivery`: 13 offline tests (5 template-rendering, including an HTML-escaping
  proof; 5 `ResendDeliveryProvider` tests against an injected fake client covering acceptance,
  SMS non-support, ordinary provider rejection vs. thrown misconfiguration, and the
  test-mode banner; 3 pre-existing `MockDeliveryProvider` tests, unchanged) + 1 credential-
  gated real-API test (run manually this session with real credentials; skips cleanly without
  them).
- `apps/api/src/config/env.test.ts`: 3 new tests (both-or-neither validation; a configured
  Resend provider allows the four delivery-gated flags outside development/test; an
  unconfigured environment still refuses them) — all 12 tests in the file pass, including the
  original ENG5/Slice-I4-era boot-refusal tests, unmodified and still green.

## Verification

- `pnpm typecheck` (12/12 packages), `pnpm lint`, `pnpm guard` (provider-import guard —
  `resend` is not a restricted financial SDK): all clean.
- `pnpm format:check`: clean for every file this milestone touched (the reported warnings
  belong to the concurrent session's own files, confirmed above).
- `packages/delivery` 13/13, `apps/api/src/config/env.test.ts` 12/12,
  `packages/application` 149/149 (untouched by this milestone, confirmed unaffected).
- Every invitation/guest/email-adjacent `apps/api` integration suite run individually against
  real local PostgreSQL: `invites.integration.test.ts` 6/6, `guest-invitation-delivery.
  integration.test.ts` 10/10, `guest.integration.test.ts` 3/3, `email-verification.
  integration.test.ts` 9/9, `vinks.integration.test.ts` 11/11 — all green, no regression.
- **Disclosed, not a regression**: a single `VINKIN_INTEGRATION=1 pnpm test` run across the
  full monorepo (dozens of real-Postgres integration suites, `node --test` parallelizing test
  files by default) failed uniformly with a generic "event loop already resolved" error across
  nearly every `apps/api` integration file — the same class of shared-local-Postgres
  contention this repo's own `eng9-infra-restart.manual.ts` precedent already documents
  (worsened here by the concurrent session's own DB activity). Re-running suites individually,
  as listed above, confirms this was resource contention, not a code defect.

## What did NOT change (already existed, verified still correct, not rebuilt)

Guest-specific token hashing/expiry/single-claim security (D14), duplicate-invite protection
(migration `0010`), member-invite accept/decline (D44), resend cooldowns, guest identity
isolation, delivery-outcome audit rows, tracing/metrics instrumentation. Generic share-link
identity isolation, SMS delivery, and a from-scratch adversarial test suite for guest-token
claiming were **not built in this milestone** — the first three already exist and are covered
by the integration suites re-verified above; SMS remains genuinely unavailable (no provider
selected) and is honestly gated, not simulated.

## External owner actions remaining

None for email. The domain (`vinkin.org`) and API key were already configured in the owner's
Resend account before this session; real delivery was proven, not assumed. If SMS delivery is
wanted later, that needs a separate provider selection and credentials — out of this
milestone's scope by the owner's own "close the real gap only" direction.

## Status

**COMPLETE** for the scope the owner approved (select and wire a real email delivery
provider). The original RM4D brief's broader asks are satisfied by pre-existing,
already-tested infrastructure (not rebuilt here) with the exception of SMS, which is honestly
gated as unavailable rather than built.
