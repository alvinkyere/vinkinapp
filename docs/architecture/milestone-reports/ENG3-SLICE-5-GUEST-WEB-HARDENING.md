# Milestone Report — ENG3 Slice 5: Guest-Web Hardening

Date: 2026-07-23 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: the fifth of
six owner-approved ENG3 slices — the three remaining `apps/guest-web` checklist items from the
original audit: server-rendered invite context, mobile-browser tab-resume recovery, and
expired/revoked token handling consistency.

## One of the three was already done — verified, not re-built

The audit's "mobile-browser recovery" finding ("no `visibilitychange`/`document.hidden`
listener exists anywhere in the app") was accurate **at the time of the audit**, but ENG3
Slice 1 (`milestone-reports/ENG3-SLICE-1-REALTIME-BACKBONE.md`) already added exactly this — a
`visibilitychange` listener in `use-guest-realtime.ts` that reconnects the WebSocket
immediately and refreshes state the instant a backgrounded tab becomes visible again. Verified
by re-reading that file before writing any new code: the listener is still in place, unchanged
by any work between Slice 1 and this slice. This report checks that box as "already resolved,"
not silently claimed as new work. The narrower sub-case an app can't meaningfully fix in its own
code — an in-flight `fetch` mutation surviving a tab the OS outright kills for memory pressure —
is a browser/OS page-lifecycle limitation, not something left undone here.

## Server-rendered invite context + immediate first render

Both audit findings (SSR: "everything is client-fetched behind a mount gate"; first render:
"'Loading…' on every load") traced to the same root cause and got one fix.
`app/join/[publicCode]/page.tsx` (a real Next.js Server Component) now fetches
`getPublicVinkView(publicCode)` **server-side** and passes the result into `JoinExperience` as
`initialPublicView`. `JoinExperience`'s `publicViewQuery` seeds this as `initialData`, which
TanStack Query reports as already-resolved (`isSuccess`, real `data`) from the very first
render — server HTML and the client's pre-hydration pass alike — regardless of the query's
`enabled` flag. The blanket `!hasMounted` gate that previously blocked *all* rendering (even
though `effectiveSession` is provably always `null` pre-mount, since `localStorage` isn't
reachable during SSR) was narrowed to only the case it was ever actually needed for: a
*returning* guest's own session lookup, which genuinely can't run before mount.

A server-side fetch failure (`null`) degrades safely to the exact original behavior — the
client re-fetches and shows its own existing loading/error states, never a broken or stale
server-rendered error page.

**Verification method matters here**: proving genuine SSR (not just "resolves quickly after
hydration") requires disabling JavaScript entirely — the new `join-server-rendering.spec.ts`
does exactly that (`browser.newContext({ javaScriptEnabled: false })`) against a real local
backend and confirms the organizer's purpose/amount render with zero client JS ever executed.

## Expired/revoked token handling consistency

The audit's finding was precise: the *initial* `/g/:token` redemption path
(`app/g/[token]/page.tsx`) already shows a clear "This invite link has expired or already been
used" message on failure, but a *returning* guest whose already-stored token later expired fell
through silently to a bare join form — the existing `GUEST_UNAUTHENTICATED` copy in
`lib/human-errors.ts` ("Your session expired. Open the link again to continue.") was written for
exactly this failure but never reached this second path. Fixed by deriving a
`sessionExpiredNotice` from `sessionQuery.isError` (only when there *was* a stored session to
begin with — never shown to a genuinely first-time anonymous visitor) and rendering it via the
same `<StatusMessage>`-shaped presentational pattern already used for every other inline
notice/error in this file — reusing existing copy and an existing visual pattern, not inventing
either.

## Tests

- `apps/guest-web/tests/join-server-rendering.spec.ts` (new, 1 test): real backend, JavaScript
  disabled, confirms the organizer/purpose/amount are present in server-rendered HTML.
- `apps/guest-web/tests/guest-session-expired-notice.spec.ts` (new, 1 test): a stored-but-now-
  invalid guest session (seeded via `localStorage`, `GET /api/v1/guest/session` mocked to 401
  `GUEST_UNAUTHENTICATED`) shows the expected notice alongside a still-reachable join form.
- Both tests initially failed for a mundane, unrelated reason caught and fixed before this
  report: the setup's own `POST .../open` call omitted a body — Fastify's
  `FST_ERR_CTP_EMPTY_JSON_BODY` rejects an empty body under `content-type: application/json`,
  so the Vink silently stayed in `DRAFT` and both tests were actually exercising the (correct,
  unrelated) D23 not-open-yet path instead of the intended one. Root-caused by comparing
  against `e9.spec.ts`'s own working `/open` call (which does send `body: JSON.stringify({})`)
  — not a product defect, a test-authoring gap, fixed in the test files themselves.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard` — clean, all 10 packages.
- `apps/guest-web`: **43 passed**, 8 failed, 1 skipped, against a freshly restarted local
  backend. The 8 failures are the identical, already-documented pre-existing Slice I3/I3A
  gap from the concurrent UX-track session's own in-flight work (confirmed unchanged from
  Slices 1/3's own reports — same test names, same file, same root cause). The full E9 golden-
  path test (`e9.spec.ts`'s own main "a guest joins and funds their share..." test) passed,
  confirming the `JoinExperience` rewrite didn't regress the core join/contribute flow.
- `apps/api`: untouched by this slice, not re-run (only used as the required running backend
  for the two new Playwright tests, which need a real server for the SSR fetch specifically —
  route mocking can't intercept the Next.js server process's own outbound fetch).

## Files changed

- Modified: `apps/guest-web/app/join/[publicCode]/page.tsx`,
  `apps/guest-web/features/join/JoinExperience.tsx`.
- New: `apps/guest-web/tests/{join-server-rendering,guest-session-expired-notice}.spec.ts`.
- Incidental cleanup: removed an unused import in `tests/guest-realtime-stale-response.spec.ts`
  (a leftover ESLint warning from Slice 1's own work, fixed while back in this codebase).

## Exit gate (this slice's own scope)

- [x] The anonymous invite context is genuinely server-rendered, proven with JavaScript
      disabled, not just "loads fast after hydration."
- [x] No more mandatory "Loading…" gate for the common (anonymous, first-time visitor) case.
- [x] Mobile-browser tab-resume recovery verified as already covered by Slice 1's own
      `visibilitychange` work — not silently re-claimed as new.
- [x] A returning guest's expired/revoked stored token now shows the same explanation the
      initial-redemption path already had, reusing existing copy and an existing UI pattern.
- [x] Zero regressions — the full pre-existing suite (minus the same 8 confirmed-unrelated,
      pre-existing failures) stays green, including the E9 golden path.

## Next

Slice 6 (typed error mapping completion — Login/Register screens bypassing
`failure_classifier.dart`) is the last of the six owner-approved ENG3 slices, pending
go-ahead.
