# ENG5 Slice 3 — Magic Links (Passwordless Login)

**Date:** 2026-07-26
**Scope:** Third and final token/delivery-shaped slice of ENG5, before the OAuth-shaped
Slices 4–5 (Sign in with Apple/Google). Passwordless login via an emailed one-time credential,
reusing Slices 1–2's hashed/single-use/TTL'd token pattern.

## The design question this slice actually turned on

A "magic link" conventionally means: click a link, land signed in. For a mobile-first product,
that link has to somehow hand real session tokens to the *native app*, not just render a
webpage — normally solved with a deep link. This codebase's own deep-link infrastructure is
real (ENG3 Slice 4's `app_links` custom scheme, ENG4 Slice 6's iOS Universal Links) but
**Android App Links are disclosed as not functional yet** — ENG4 Slice 10's own certification
report lists "create the Play app, obtain its signing SHA-256 fingerprint, publish
`assetlinks.json`" as an open, external release blocker. Building a magic-link flow whose only
supported completion path depends on that unresolved gap would mean shipping something
broken-by-default on one platform and quietly hoping the infrastructure catches up later —
exactly what this codebase's own established discipline (ENG3 Slice 4 itself, when it first
hit this same tension) avoids: don't build on top of infrastructure that isn't verified
working yet.

**Resolution:** the link's landing page never auto-completes anything (unlike Slice 1's email
verification page, which safely can — nothing else competes to consume that token). It
requires an explicit "Sign in on this browser" click, *and* the email copy tells the user they
can instead copy the link and paste it into the app's own "Log in with a link" screen. Both
paths call the identical `POST .../magic-link/confirm` JSON endpoint and consume the same
token — whichever the user does first wins, and it's genuinely secure either way (full random
token, not a truncated code). True one-tap deep-link completion is a disclosed, natural follow-
up once the Android gap closes — not invented on top of it now.

## What was built

**Migration `0017_magic_link.sql`**: `magic_link_tokens` — same shape as
`password_reset_tokens` (hashed-only, single-use, no email snapshot — the token itself is the
only credential, exactly like a login, not an email-ownership proof).

**`apps/api/src/auth/magic-link-tokens.ts`**: `mlt_`-prefixed tokens, same shape as the other
three token families.

**`packages/delivery`**: `DeliveryTemplateInput` gained a fourth union member,
`MagicLinkTemplateInput`.

**`apps/api/src/modules/auth/service.ts`**:
- `requestMagicLink(sql, email, ttlSeconds, cooldownSeconds)` — identical enumeration-safe
  `null`-collapse shape as `requestPasswordReset` (unknown account / inactive / cooldown all
  collapse to `null`).
- `confirmMagicLink(sql, token)` — consumes the token and **issues a genuinely real session**:
  same return shape as `loginUser`/`registerUser` (`{user, sessionId, refreshToken}`), because
  from the caller's point of view this *is* a login, just via a different credential. Could not
  reuse the file's own private `createSession` helper directly — it's typed for `Sql`, and the
  transaction handle here is the driver's distinct, non-assignable `TransactionSql` type — so
  the session insert is inlined, matching how `confirmEmailVerification`/`confirmPasswordReset`
  already handle their own transactions rather than calling out to a `Sql`-typed helper.

**Routes**: `POST /api/v1/auth/magic-link/request` (public, IP rate-limited, always identical
`202`, same shape as password-reset-request). `GET .../magic-link/confirm?token=...` renders
the explicit-button HTML page described above. `POST .../magic-link/confirm` (public JSON) —
returns a full login response (`user`/`accessToken`/`refreshToken`), the one route in this
slice that can genuinely fail with a meaningful, non-enumeration-risking error
(`INVALID_MAGIC_LINK_TOKEN`) since by the time someone has the actual token value, "does this
account exist" is no longer a secret worth protecting.

**New config**: `VINKIN_MAGIC_LINK_ENABLED` (own flag, same boot-refused-outside-dev/test
discipline as its two siblings). `MAGIC_LINK_TOKEN_TTL_SECONDS` defaults to **15 minutes** —
the shortest of the three token families, because it grants an immediate real login with no
second factor at all, the highest-stakes bearer secret this codebase mints.

**Mobile**: `AuthController.requestMagicLink()` (mirrors `requestPasswordReset`) and
`confirmMagicLink(linkOrToken)` — accepts either the bare token or the full pasted URL and
extracts the token client-side (`Uri.tryParse(...).queryParameters['token']`, falling back to
the trimmed input itself), then completes a real sign-in through the same `_onAuthenticated`
path `login`/`register` already use. New `MagicLinkScreen` (`/magic-link`, entry points from
both the login screen and reachable while signed out) — two independent `CommandRunner`-driven
sections: request-by-email (identical generic-success shape as forgot-password) and
paste-to-complete (a genuine login with a genuine failure mode).

## Tests

- `apps/api/src/magic-link.integration.test.ts` (new, 5 tests, real PostgreSQL): the request →
  confirm round trip **proving the issued access token genuinely authenticates** (a real
  `GET /api/v1/me` call with it, not just checking the response shape); proving the GET
  confirm-page load does **not** consume the token (the no-auto-fire guarantee the whole design
  depends on); the enumeration defense (byte-identical responses, real send only for the known
  account); single-use/unknown-token handling; a resend invalidating the prior token; the
  flag-off no-op path.
- `apps/mobile/test/features/onboarding/magic_link_screen_test.dart` (new, 4 tests): the
  request flow; **pasting a full URL correctly extracts just the token** (asserted against the
  actual request body sent, not just that a request happened); a bare pasted token is sent
  as-is; an invalid/expired token renders an inline error rather than crashing.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, 10/10
  packages.
- `apps/api`: **188/188** (up from 183 — Slice 2's count — +5).
- `packages/application`: **137/137**, unchanged — this slice, like its two predecessors,
  stayed entirely inside auth's own PV1-era module.
- `apps/mobile`: **251/251** (up from 247), `flutter analyze` unchanged at the pre-existing
  26-issue baseline.

## Secrets/PII discipline

Magic-link tokens are hashed-only at rest. Unlike the other two token families, this one's
plaintext genuinely IS the complete credential for a real login — the explicit-click
requirement on the confirm page exists precisely so an accidental GET (link-preview
prefetching in an email client, for instance) can never silently consume it. No log call site
this slice logs a raw token or email.

## Known, disclosed gaps

- **No one-tap deep-link completion** — by design, per the reasoning above. Revisit once
  ENG4 Slice 10's Android App Links gap actually closes; the app's own `app_links`/Universal
  Link infrastructure (ENG3 Slice 4, ENG4 Slice 6) would need a new recognized path
  (`.../app/magic-link?token=...`, mirroring the existing `.../app/vinks/:id` pattern) to wire
  this up — not built preemptively against unverified infrastructure.
- **No real email-sending provider exists** (§4) — identical caveat to Slices 1–2; runs against
  `MockDeliveryProvider`, flag stays boot-refused outside dev/test.
- The confirm page's "paste it into the app" instruction assumes the user can find and open
  the VinkIn app themselves — no in-page deep-link attempt is made (consistent with the
  no-auto-completion decision above, not an oversight).

## Exit gate

- [x] A user can sign in with no password at all, end to end, verified with a real subsequent
  authenticated call using the issued token (not just a response-shape check).
- [x] No response, timing, or status-code difference reveals whether a submitted email has an
  account (identical defense and identical test-proof shape as Slice 2).
- [x] The token mechanism follows this codebase's own hard rules, with the shortest TTL of the
  three families given the highest stakes.
- [x] The one real architectural tension this slice raised (mobile completion vs. unverified
  deep-link infra) was resolved by not building on the unverified part, disclosed explicitly,
  not silently worked around.
- [x] No real-provider dependency was silently assumed — same boot-refusal discipline as its
  two siblings.

## Next

ENG5 closes out its token/delivery-shaped work here. Slices 4–5 (Sign in with Apple, Sign in
with Google) shift to OAuth/OIDC integration — a different shape of work (external identity
provider configuration, not more hashed tokens) and a new external dependency each (Apple
Developer "Sign in with Apple" capability + Services ID; Google Cloud OAuth client), likely
each needing their own owner-provisioned credentials before real sign-in can complete, the same
pattern ENG4's later slices hit repeatedly.
