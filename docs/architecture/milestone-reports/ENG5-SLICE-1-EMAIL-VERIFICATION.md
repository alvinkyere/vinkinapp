# ENG5 Slice 1 — Email Verification

**Date:** 2026-07-26
**Scope:** First slice of ENG5 ("Authentication and Identity"). Owner directed: continue with
VinkIn's native authentication platform (not a managed identity provider) and add email
verification, password reset, magic links, and Sign in with Apple/Google, reevaluating a
managed provider only after public launch if operational complexity justifies migration. This
slice covers email verification only — password reset, magic links, and Apple/Google are
Slices 2–5, sequenced separately.

## Audit findings (before any code)

`apps/api/src/modules/auth/service.ts` (PV1) has username/password auth, rotating refresh
tokens with reuse-detection/family-revocation, and an optional `email`/`phone` on `users`
(D19/D27, captured at registration, editable via `PATCH /api/v1/me`) — but no concept of a
*verified* email anywhere; any string passed at registration is trusted as-is. Guest tokens
(D14, `vgt_` prefix) already satisfy most of what a "scoped capability token" needs (hash-only
storage, bound to exactly one participant/vink via `findGuestParticipant`, no independent
identity of their own) — that part of ENG5 is refinement, not greenfield. The real gap is
entirely on the registered-user side.

`packages/delivery`'s `DeliveryProvider`/`DeliveryTemplateInput` (Slice I4/I4B) already exists
and is exactly the right abstraction to reuse for outbound verification emails — but its single
`DeliveryTemplateInput` interface was invitation-shaped (`organizerName`/`purpose`/
`yourShareMinor`/`deadline`), with nothing to carry an account-security message.

## What was built

**Migration `0015_email_verification.sql`**: `users.email_verified_at` (null = unverified);
`email_verification_tokens` (hashed-only token, D14 hard rule applied to this new secret too;
snapshots its own target `email`; single-use via `consumed_at`).

**`apps/api/src/auth/email-verification-tokens.ts`**: `evt_`-prefixed opaque tokens, SHA-256
hashed at rest — same shape as `guest-tokens.ts`.

**`packages/delivery` types**: `DeliveryTemplateInput` became a real discriminated union
(`InvitationTemplateInput | EmailVerificationTemplateInput`) instead of widening the shared
invitation interface with more optional fields — the two message kinds have genuinely
different data, and nothing outside `types.ts`/`index.ts` read the old shape generically
(confirmed by grep before changing it), so this was a safe, low-blast-radius split.

**`apps/api/src/modules/auth/service.ts`**: `PublicUser.emailVerified` (derived, never
client-settable); three new `AuthError` codes (`NO_EMAIL_ON_FILE`, `EMAIL_ALREADY_VERIFIED`,
`INVALID_VERIFICATION_TOKEN`); `createEmailVerificationToken` (invalidates any prior unconsumed
token first, so a resend can never leave two independently-valid tokens live);
`lastEmailVerificationAttempt` (cooldown check, computed at the route layer — same pattern as
`GUEST_RESEND_COOLDOWN_SECONDS`); `confirmEmailVerification` (checks existence, single-use,
expiry, **and that the token's snapshotted email still matches the account's current email** —
collapses all four failure shapes to one `INVALID_VERIFICATION_TOKEN`, since a browser hitting
a plain confirm-page GET gets nothing actionable from a finer-grained code and a finer code
would hand a token-guessing prober a distinguishing oracle). `updateContactInfo` now resets
`email_verified_at` to null whenever the email is actually changing — an unverified new address
must never inherit the old address's verified state; this is what makes the token/current-email
match in `confirmEmailVerification` a real guard rather than a redundant check.

**Routes**: `POST /api/v1/auth/email/verify/request` (authenticated, self-serve resend,
best-effort cooldown throttle — same "not a hard guarantee, the token-invalidation step makes a
genuine race harmless anyway" acknowledgment the guest-invite resend route already carries) and
`GET /api/v1/auth/email/verify/confirm?token=...` (public — a browser hits this directly from
the emailed link, so it returns a plain HTML page, not JSON, the same "bearer secret embedded
in a URL" shape the D14 guest-join link already uses). Registration now best-effort auto-sends
a verification email when one was supplied — never blocks or fails registration itself (Phase 5
§2's locked rule, applied here exactly as it already is to guest/member invitation dispatch).

**New config** (`apps/api/src/config/env.ts`): `VINKIN_EMAIL_VERIFICATION_ENABLED` (default
off, **boot-refused outside development/test** — identical reasoning and identical mechanism to
`VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED`: no real email-sending provider is selected yet,
§4), `EMAIL_VERIFICATION_TOKEN_TTL_SECONDS` (24h default), `EMAIL_VERIFICATION_RESEND_COOLDOWN_
SECONDS` (60s default, shrinkable in tests), and `VINKIN_API_PUBLIC_BASE_URL` — a new
self-referential origin the API needed for the first time (every existing base-URL config was
some *other* service's origin; the confirm link is a plain API route, not a client-app page).
Deliberately a dedicated env var, not request-header introspection (`request.hostname`) — that
would be fragile behind Railway's proxy without configuring Fastify's `trustProxy`, and every
other base-URL value in this file is already a dedicated var.

**Mobile**: `VinkinUser.emailVerified` (mirrors `PublicUser`), `AuthController.
resendEmailVerification()`, and a new Profile-screen card (organizer's own email + verified/
unverified state + a `CommandRunner`-driven resend button, ENG3's typed command-state pattern —
not a new ad hoc bool+error pair) — shown only when an email is on file at all. Deliberately did
**not** build the contact-info-editing screen this card sits next to (`PATCH /api/v1/me` has
been callable but "not yet wired into a screen" since Slice I4) — that's a separate, larger
scope than "show verification status," flagged below, not silently expanded into.

## Tests

- `apps/api/src/email-verification.integration.test.ts` (new, 9 tests, real PostgreSQL): auto-
  send-on-register → confirm → `/api/v1/me` reflects it; no-email registration sends nothing;
  token single-use; unknown token never 500s; the request route's auth requirement, cooldown
  replay, and already-verified rejection; a resend genuinely invalidates the prior token (the
  old link stops working, not just "a new one also works"); **changing the email resets
  `emailVerified` and invalidates any in-flight token for the old address** — the one guard this
  slice most needed a real test for, since it's the one place two features (contact editing,
  verification) interact; cooldown 429 with a nonzero cooldown; the flag-off path never calls
  the provider from either registration or the request route.
- `apps/api/src/config/env.test.ts` (+2): boot-refusal outside development/test (mirrors the
  invitation-delivery test exactly), config defaults.
- `apps/mobile/test/features/profile/profile_screen_test.dart` (new, 4 tests): no card with no
  email on file; unverified state renders the address + button, tapping it calls the (faked)
  network method and shows the success copy; a failed resend shows an inline error and keeps
  the button available; verified state shows "Verified" with no button at all.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean across all 10
  packages.
- `apps/api`: **176/176** (up from 165 baseline: +9 email-verification + 2 env-config).
- `packages/application`: **137/137**, unchanged — confirms nothing in the shared command layer
  was touched (this slice's identity work stayed entirely inside `apps/api`'s auth module,
  which predates and sits outside the D13 command layer, same disclosed exception
  `service.ts`'s own header comment has carried since PV1).
- `apps/mobile`: **245/245** (up from 241), `flutter analyze` unchanged at the pre-existing
  26-issue baseline (confirmed identical list, no new entries).
- A full combined `turbo run test` across all 10 packages showed `apps/api` as "Interrupted
  while running" — traced this to resource contention from Playwright launches failing loudly
  in the same run (the pre-existing missing-Chromium-binary environment gap, unrelated to this
  slice), not a real regression: re-ran `apps/api` in isolation twice, both times a clean
  176/176.

## Secrets/PII discipline

Verification tokens are stored hashed-only (D14 hard rule), same as every other bearer secret
in this codebase. The confirm route's HTML response never echoes the token back. No log call
site added this slice logs a raw token, email address, or link — `sendVerificationEmailBestEffort`'s
error branch logs only `userId` and the error object on an unexpected failure (an expected
`NO_EMAIL_ON_FILE` is explicitly not logged at all, since it isn't a failure).

## Known, disclosed gaps

- **Verification is not yet enforced anywhere** — an unverified account can do everything a
  verified one can (create Vinks, contribute, etc.). The brief didn't ask for enforcement, only
  the capability to verify; flagging this explicitly rather than silently deciding email
  verification should gate some action, which would be a real product decision, not an
  engineering one.
- **Contact-info editing has no screen** (pre-existing gap since Slice I4, not created or
  closed by this slice) — Profile can *show* verification status for whatever email exists, but
  there's still no in-app way to add/change an email after registration on a mobile build.
  Worth a dedicated follow-up if verification is going to matter to product.
- **No real email-sending provider exists** (§4, external dependency) — this entire slice runs
  against `MockDeliveryProvider` today, exactly like invitation delivery has since Slice I4. The
  flag stays boot-refused outside development/test until one is selected, same as its sibling
  flag.
- `apps/guest-web`/`apps/operations-console` are untouched — email verification is an
  organizer/member-account concept; guests have no account to verify.

## Exit gate

- [x] A registered user can prove ownership of the email they supplied.
- [x] Verification state (`emailVerified`) is visible via `/api/v1/me` and in the mobile app.
- [x] The token mechanism follows this codebase's own hard rules: hashed-only storage,
  single-use, expiring, and provably invalidated by both a resend and an email change.
- [x] A delivery failure never blocks registration or the resend request (Phase 5 §2).
- [x] No real-provider dependency was silently assumed — the flag stays off outside dev/test
  until one exists, same discipline as every other delivery-dependent flag in this codebase.

## Next

ENG5 Slice 2 — password reset, reusing this slice's token/delivery infrastructure pattern
(hashed, single-use, TTL'd, cooldown-throttled resend) for a forgot-password flow.
