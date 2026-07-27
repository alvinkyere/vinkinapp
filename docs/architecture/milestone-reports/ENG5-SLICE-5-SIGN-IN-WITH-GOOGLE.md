# ENG5 Slice 5 — Sign in with Google

**Date:** 2026-07-26
**Scope:** Second and final OAuth-shaped slice of ENG5, completing the ENG5 brief. Same
owner-directed scope as Slice 4 (Apple): **server-side only** — no real Google Cloud OAuth
client is provisioned yet, so no mobile client button was built. Reuses Slice 4's
`oauth_identities` table and `signInWithOAuth` account-linking logic verbatim, exactly as that
slice's own report predicted.

## What's genuinely different from Apple, not just copied

- **The name comes from the verified token itself**, not a client-supplied field. Apple's
  identity token never carries a name claim at all (the native SDK hands the client a separate
  name object, and only on first authorization) — that's why Slice 4's schema accepts
  `givenName`/`familyName` as request-body fields. Google's ID token includes a `name` claim on
  *every* sign-in, verified along with everything else, so `verifyGoogleIdentityToken` extracts
  it directly and the request schema has no display-name field to accept from the client at
  all — there's nothing unverified to ask for.
- **Email trust depends on `email_verified`**, checked explicitly. Google's ID token can carry
  an `email` claim with `email_verified: false` (an unconfirmed alias on some account types) —
  `verifyGoogleIdentityToken` only returns the email when that claim is `true`, treating an
  unverified claim as absent rather than as fact. Apple's token has no equivalent flag; Apple
  itself only ever issues an email claim it already stands behind.
- **Two accepted issuer values.** Google's own documentation states a real ID token's `iss` can
  be either `https://accounts.google.com` or `accounts.google.com` — both are checked, not
  just one (a real token could otherwise be rejected depending on which form Google happened to
  use for a given sign-in). Proven with its own test case, not assumed from the docs alone.

## What's identical by design, and proven identical, not just copied

`signInWithOAuth` needed zero changes — new-account creation (auto-generated username, random
placeholder password, immediate email verification since a trusted provider vouched for it),
repeat-sign-in linking via `(provider, providerUserId)`, and the `EMAIL_ALREADY_REGISTERED`
conflict guard Slice 4's own tests caught as a real bug all apply unchanged. A dedicated test
this slice exercises that exact conflict guard **through the Google route** with two Google
identities sharing an email — not re-testing the guard's logic again, but confirming the
sharing is real: the same code path, reached from a second, independent caller.

New: `POST /api/v1/auth/oauth/google`, `apps/api/src/auth/google-identity.ts`
(`verifyGoogleIdentityToken`, same injectable-key-resolver shape as Apple's module — real
JWKS at `https://www.googleapis.com/oauth2/v3/certs` by default, a local test key set
injectable for tests), `VINKIN_GOOGLE_SIGN_IN_ENABLED`/`GOOGLE_SIGN_IN_CLIENT_ID` config with
the identical boot-refused-outside-dev/test and fail-closed-when-unconfigured discipline as
their Apple siblings.

## Tests

- `apps/api/src/auth/google-identity.test.ts` (new, 10 tests, real cryptography, no network):
  everything Apple's own unit suite proves (valid token, forged signature, wrong issuer, wrong
  audience, expired, sub-less, garbage input — each via `assert.rejects(...,
  GoogleIdentityError)`) plus the two Google-specific behaviors: both accepted issuer values
  work, and an `email_verified: false` claim is never surfaced as a real email.
- `apps/api/src/google-sign-in.integration.test.ts` (new, 8 tests, real PostgreSQL, real
  signed test tokens): first sign-in uses the token's own name claim and marks the email
  verified (proven with a genuine subsequent authenticated `/api/v1/me` call, same bar as
  Slice 4); an unverified email claim produces an account with no email and the generic display
  name, not a silently-trusted address; repeat sign-in reaches the same account; **the
  cross-provider-sharing proof** described above; a forged token is rejected by the real route;
  a malformed body is a clean 400; both fail-closed paths (flag off; flag on, no client ID)
  return the identical 503 with a genuinely valid token each time.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, 10/10
  packages.
- `apps/api`: **221/221** (up from 203 — Slice 4's count — +18: 10 unit + 8 integration).
- `packages/application`: **137/137**, unchanged — the fifth consecutive ENG5 slice that
  stayed entirely inside auth's own PV1-era module.
- Mobile: untouched this slice, same reason as Slice 4.

## Known, disclosed gaps

Same three as Slice 4, now applying to both providers: no mobile client integration (`sign_in_
with_apple`/`google_sign_in` Flutter packages, real capability/OAuth client provisioning both
still pending); no account-linking flow for an already-signed-in user to add a second OAuth
provider or a password to an OAuth-only account; auto-linking-by-email remains an open,
flagged product question, not a decision either slice made.

## Exit gate

Identical bar to Slice 4, met for Google specifically:
- [x] Real cryptographic verification, proven against genuinely signed test tokens — including
  the two Google-specific behaviors (dual issuer acceptance, `email_verified` gating) neither
  assumed from documentation nor left untested.
- [x] Fails closed in every unconfigured/disabled state, proven with valid tokens.
- [x] The shared account-linking/conflict logic was proven shared, not just structurally
  identical — a real cross-provider test, not a copy-pasted single-provider one.
- [x] No client UI built against unprovisioned infrastructure.

## ENG5 status

**ENG5 is complete** — all five slices done: email verification, password reset, magic links,
Sign in with Apple, Sign in with Google. Three token/delivery-shaped capabilities (Slices 1–3,
gated on a real email/SMS provider, §4, still unselected) and two OAuth capabilities (Slices
4–5, gated on real Apple Developer / Google Cloud credentials, both currently unavailable) are
all server-complete, tested against real cryptography and real PostgreSQL throughout, and
disclosed everywhere they stop short of a working end-user button. Next: ENG6 per the
CLAUDE.md-tracked sequence (`ENG5 → ENG6 → ENG7 → ENG8 → ENG9 → PV12 → M0 → ...`) — no ENG6
brief exists in this repo yet; needs the owner to supply it, the same pattern every prior
ENG milestone's scope arrived by.
