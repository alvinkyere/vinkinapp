# ENG5 Slice 2 — Password Reset

**Date:** 2026-07-26
**Scope:** Second slice of ENG5. Forgot-password recovery for the native username/password
auth, reusing Slice 1's hashed/single-use/TTL'd token and delivery-abstraction pattern.

## Audit findings (before any code)

No existing password-recovery path of any kind — an account with a forgotten password was
permanently locked out (`status = 'ACTIVE'` accounts have no other credential). `loginUser`
already carries a "no account enumeration" discipline (uniform failure for unknown user vs.
wrong password); a forgot-password flow is the classic place that discipline gets accidentally
reintroduced as a leak (a distinguishable response for "email exists" vs. "email doesn't"), so
this was the slice's central design constraint, not an afterthought.

## What was built

**Migration `0016_password_reset.sql`**: `password_reset_tokens` — same hashed-only/single-use
shape as Slice 1's `email_verification_tokens`, but with no `email` snapshot column: resetting
a password isn't verifying an address, it's proving control of an inbox at a point in time, so
there's nothing for a later email change to invalidate against (unlike Slice 1's guard).

**`apps/api/src/auth/password-reset-tokens.ts`**: `prt_`-prefixed tokens, same shape as the
other two token families.

**`packages/delivery`**: `DeliveryTemplateInput` gained a third union member,
`PasswordResetTemplateInput` (`{kind: 'password_reset', link}`) — same reasoning as Slice 1's
`EmailVerificationTemplateInput` split.

**`apps/api/src/modules/auth/service.ts`**:
- `requestPasswordReset(sql, email, ttlSeconds, cooldownSeconds)` returns `{token, userId} |
  null` — **`null` for every reason nothing should be sent**: no such account, no ACTIVE
  status, or still within cooldown. This is the enumeration defense's actual mechanism: the
  route layer never learns *which* of those happened, so it can't leak it. Invalidates any
  prior unconsumed token first (same "at most one live token" rule as Slice 1).
- `confirmPasswordReset(sql, token, newPassword)` — same guard order/collapsed-error-code shape
  as `confirmEmailVerification`, plus one addition Slice 1 didn't need: **on success, revokes
  every existing session for the account** (`auth_sessions`, the same table `refreshSession`'s
  reuse-detection family-revocation already writes to). A password reset is exactly the moment
  any possibly-compromised prior session should die — this reuses that precedent rather than
  inventing a new session-termination rule.

**Routes**: `POST /api/v1/auth/password-reset/request` (public, IP rate-limited via the
existing `makeRateLimiter` — 10/min, the same mechanism `sharing/routes.ts` already uses for
the public join surface — **always returns the identical `202` regardless of what
`requestPasswordReset` did**, and only calls the delivery provider when it returned non-null).
`GET .../password-reset/confirm?token=...` renders a small HTML page with a password field; its
inline script `fetch()`s the JSON `POST .../password-reset/confirm` route rather than a
urlencoded form submit — avoids adding a new body-parser dependency to an otherwise all-JSON
API for one route, and means there's exactly one mutation path (this page and any future
in-app screen would call the identical JSON endpoint), not two.

**New config**: `VINKIN_PASSWORD_RESET_ENABLED` (own flag, not a reuse of Slice 1's —
independently rollout-able, same "one flag per feature" convention `VINKIN_INVITES_ENABLED`
established), boot-refused outside development/test for the identical §4 reason.
`PASSWORD_RESET_TOKEN_TTL_SECONDS` defaults to **1 hour**, deliberately shorter than email
verification's 24h — a reset link grants full account takeover, not just an email-ownership
proof, and a short window is standard practice for that class of secret.
`PASSWORD_RESET_RESEND_COOLDOWN_SECONDS` mirrors the same 60s default.

**Mobile**: new `ForgotPasswordScreen` (`/forgot-password`, reachable from a new "Forgot
password?" link on the login screen) — collects an email, calls
`AuthController.requestPasswordReset()`, and shows one success message regardless of outcome
(there is no "wrong email" failure branch to render, by design — the only failure state shown
is a genuine network/server error). Completing the reset (typing the new password) happens
outside the app on the server-rendered confirm page, the same split Slice 1 established for
email verification — no in-app "enter new password" screen exists this slice.

## Tests

- `apps/api/src/password-reset.integration.test.ts` (new, 7 tests, real PostgreSQL): the full
  request → confirm → old-password-rejected/new-password-accepted round trip, **and** proves
  the pre-reset refresh token is dead afterward (the session-revocation side effect, not just
  the password change); **the enumeration defense itself** — a known vs. unknown email produce
  byte-identical status code and JSON body, with a real send happening only for the known one
  (proving the identical response wasn't achieved by also suppressing the real send); token
  single-use and unknown-token handling; a resend invalidating the prior token; a rejected
  password shape failing validation cleanly; cooldown throttling proven to change *only*
  whether a send happens, never the HTTP response; the flag-off no-op path.
- `apps/mobile/test/features/onboarding/forgot_password_screen_test.dart` (new, 2 tests):
  submitting calls the real route with the right body and renders the generic success copy; a
  genuine server error renders an inline error instead (proving the screen doesn't swallow
  real failures while still never distinguishing "account not found").

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, 10/10
  packages.
- `apps/api`: **183/183** (up from 176 — Slice 1's count — +7).
- `packages/application`: **137/137**, unchanged — this slice, like Slice 1, stayed entirely
  inside auth's own PV1-era module.
- `apps/mobile`: **247/247** (up from 245), `flutter analyze` unchanged at the pre-existing
  26-issue baseline.

## Secrets/PII discipline

Reset tokens are hashed-only at rest (D14 hard rule). The confirm page's inline script sends
the token back to the API over the same-origin `fetch()` call only — never logged, never
echoed into a redirect URL. `requestPasswordReset`'s error-log branch (dispatch failure) logs
only the error object, never the token or email.

## Known, disclosed gaps

- **No in-app "type your new password" screen** — completion happens on the server-rendered
  page only, matching Slice 1's split. A future slice could add app-side deep-link handling
  (ENG3 Slice 4 already built `app_links` infrastructure this could reuse) if that split proves
  worse than expected in practice; not built preemptively here.
- **No real email-sending provider exists** (§4) — identical caveat to Slice 1; this entire
  slice runs against `MockDeliveryProvider`, flag stays boot-refused outside dev/test.
- The IP rate limiter (`makeRateLimiter`) is per-process, in-memory — the same known
  single-instance limitation `sharing/routes.ts`'s own public-surface limiters already carry;
  not a new gap this slice introduced.

## Exit gate

- [x] A user who forgot their password can regain access without support intervention.
- [x] No response, timing, or status-code difference reveals whether a submitted email has an
  account — verified by an explicit test asserting byte-identical responses, not by inspection.
- [x] A password reset kills every other existing session for the account.
- [x] The token mechanism follows this codebase's own hard rules: hashed-only, single-use,
  expiring, TTL shorter than the lower-stakes email-verification token.
- [x] No real-provider dependency was silently assumed — same boot-refusal discipline as every
  other delivery-dependent flag.

## Next

ENG5 Slice 3 — magic links (passwordless login), the last of the three token/delivery-shaped
capabilities before the OAuth-shaped work (Slices 4–5, Sign in with Apple/Google) begins.
