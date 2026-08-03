# ENG5 Slice 4 — Sign in with Apple

**Date:** 2026-07-26
**Scope:** First OAuth-shaped slice of ENG5, a different shape of work than Slices 1–3 (no
hashed tokens this time — verifying a third party's own signed identity token). Owner-directed
scope correction mid-slice: no Apple Developer account access is coming soon, so this ships
**server-side only** — real, tested, secure identity verification and account linking, with the
mobile client's native "Continue with Apple" button explicitly not built, since it would be a
button that always fails without real Apple capability provisioned.

## What was built

**Migration `0018_oauth_identities.sql`**: `oauth_identities` — generic across providers
(`provider` column, `CHECK (provider IN ('apple', 'google'))`) rather than an Apple-only table.
Justified generalization, not speculative: Slice 5 (Google) is the very next item in the same
brief that requested this slice, and the account-linking shape is identical for both — only
each provider's own token-verification module differs.

**`apps/api/src/auth/apple-identity.ts`**: `verifyAppleIdentityToken(identityToken, clientId,
keyResolver?)` — verifies signature against Apple's real JWKS
(`https://appleid.apple.com/auth/keys`, `jose`'s `createRemoteJWKSet`, lazily created and
cached), checks issuer and audience, extracts `sub` (Apple's stable per-user identifier —
never the email, which can be a rotating private-relay address or absent on a repeat sign-in).
`keyResolver` is injectable, defaulting to the real remote set — this is what makes the whole
feature testable without Apple's own infrastructure or real credentials: a test generates a
local RSA key pair, signs its own Apple-shaped tokens, and injects a `createLocalJWKSet` built
from the public half. Same "real, not simulated" bar as the rest of this codebase, just without
needing a real Apple Developer account to prove the code is correct.

**`apps/api/src/modules/auth/service.ts`**: `signInWithOAuth(sql, provider, providerUserId,
email, displayName)` — provider-generic (built once, Slice 5 reuses verbatim). Links to an
existing account via `(provider, providerUserId)` if this exact identity has signed in before;
otherwise creates a new account with an auto-generated unique username (`apple_<8 hex>`), a
random unguessable placeholder password hash (no route lets an OAuth-only account log in with
a password — a real, disclosed gap, not silently worked around), and — since Apple already
proved the user controls whatever email it hands over — the email is marked verified
immediately, skipping Slice 1's own round trip for an address a trusted provider just vouched
for.

**Route**: `POST /api/v1/auth/oauth/apple` — verifies, signs in, returns a real login response
(`user`/`accessToken`/`refreshToken`/`isNewUser`). Fails closed (`503
APPLE_SIGN_IN_DISABLED`) whenever the flag is off **or** `APPLE_SIGN_IN_CLIENT_ID` is
unconfigured — deliberately not the softer "route still processes, delivery just no-ops"
pattern Slices 1–3 use, because accepting a token with no configured audience to check it
against would mean accepting a token minted for a *different* app. `VINKIN_APPLE_SIGN_IN_
ENABLED` carries the same boot-refused-outside-development/test discipline as its three
siblings, for the analogous-but-distinct reason: no real Apple Developer capability, not no
delivery provider.

## A real bug the tests caught mid-slice

The first integration-test draft ("two different Apple accounts sharing an email create two
separate VinkIn accounts") crashed with a raw, unhandled `PostgresError` on `users.email`'s
UNIQUE constraint instead of the 201 it expected. This surfaced a genuine, undecided product/
security question: should a second Apple identity that happens to report an email already on
a VinkIn account auto-link to that existing account? Auto-linking is a real, common pattern,
but also a real access-control decision — the existing account might have been created via
password signup, a different Apple identity, or (once Slice 5 lands) Google, and silently
merging identities on an email match without any confirming action from the account owner
wasn't a call to make silently inside this slice. **Resolved conservatively, not silently**:
the conflict is now rejected cleanly (`409 EMAIL_ALREADY_REGISTERED`, caught via `postgres.
PostgresError`'s own `code === '23505'` — PostgreSQL's uniqueness constraint is the final
guard here too, not just an app-layer pre-check, per this codebase's own hard rule), and the
test was rewritten to assert that real, disclosed behavior instead of the originally-assumed
one. Auto-linking remains a flagged, open question for the owner, not a decision this slice
made unilaterally.

## Tests

- `apps/api/src/auth/apple-identity.test.ts` (new, 8 tests, real cryptography, no network):
  accepts a genuinely valid signed token and extracts `sub`/`email`; accepts a token with no
  email (the real repeat-sign-in shape); **rejects a token signed by a different key** (a
  forged signature, not a string comparison — an actual wrong `CryptoKey`); rejects wrong
  issuer, wrong audience (a token minted for a different app), expired, sub-less, and
  garbage-input tokens — all via `assert.rejects(..., AppleIdentityError)`, proving the
  specific typed failure, not just "it throws."
- `apps/api/src/apple-sign-in.integration.test.ts` (new, 7 tests, real PostgreSQL, real signed
  test tokens, injected local key resolver via `AppDeps.appleKeyResolver` — the same DI pattern
  `deliveryProvider`/`provider`/`hub` already use): first sign-in creates a real account with a
  real session (**verified by making a genuine subsequent authenticated `/api/v1/me` call with
  the issued token**, not just checking the response shape) and marks the email verified; a
  repeat sign-in with the same `sub` logs into the same account even with no email claim that
  time; the email-conflict rejection above; a forged token is rejected by the *real route*
  end-to-end, not just the underlying verifier in isolation; a malformed body is a clean 400;
  both fail-closed paths (flag off; flag on but no client ID configured) return the identical
  503, proven with a genuinely valid signed token each time — proving the refusal is about
  configuration, not about the token being bad.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard`: all clean, 10/10
  packages.
- `apps/api`: **203/203** (up from 188 — Slice 3's count — +15: 8 unit + 7 integration).
- `packages/application`: **137/137**, unchanged — this slice, like its three predecessors,
  stayed entirely inside auth's own PV1-era module.
- Mobile: **untouched this slice** — no client build/test change, since no button was added.

## Secrets/PII discipline

No new bearer secret is minted or stored by this slice — Apple's own identity token is
verified, never persisted (only its extracted `sub`/`email` land in `oauth_identities`). The
placeholder password hash for a new OAuth account is truly random and never logged or
returned. No log call site added this slice logs a raw identity token.

## Known, disclosed gaps

- **No mobile client integration** — the owner-directed reason for this slice's scope. The
  server capability is complete and tested; wiring `sign_in_with_apple` (the standard Flutter
  package) into a Welcome/Login screen button is real, if small, follow-up work once real
  Apple Developer access exists (App ID capability + Services ID configured, real
  `APPLE_SIGN_IN_CLIENT_ID`).
- **No account-linking flow for an already-signed-in user** — an existing password-based user
  can't yet add "Sign in with Apple" as an additional login method to their own account; this
  slice only covers first-time sign-in and repeat sign-in via Apple alone.
- **Auto-linking by matching email is an open question**, flagged above, not decided.
- **No password-setting route exists for an OAuth-only account** — such an account can only
  ever sign in via that same OAuth provider until a "set a password" flow is built (not
  requested this slice).

## Exit gate

- [x] A user can authenticate via a real, cryptographically verified third-party identity —
  proven against a genuinely signed test token, not a mocked "always succeeds" stub.
- [x] Forged, expired, wrong-issuer, and wrong-audience tokens are all rejected, each proven
  with its own real cryptographic test case.
- [x] The feature fails closed, not open, in every unconfigured/disabled state — proven with
  valid tokens each time, so the refusal is provably about configuration, not about the token.
- [x] A real conflict the first test draft surfaced (shared email across two Apple identities)
  was resolved conservatively and disclosed, not silently auto-linked or left to crash.
- [x] No client UI was built against unprovisioned infrastructure — matching the same
  discipline ENG3 Slice 4 and Slice 3's own deep-link decision already established in this
  codebase.

## Next

ENG5 Slice 5 — Sign in with Google. Reuses `oauth_identities` and `signInWithOAuth` verbatim;
only a new `google-identity.ts` (verifying against Google's own JWKS,
`https://www.googleapis.com/oauth2/v3/certs`) and a new route are needed. Same scope question
likely applies: confirm whether real Google Cloud OAuth client credentials are available before
assuming client-side wiring is in scope, the same check that shaped this slice.
