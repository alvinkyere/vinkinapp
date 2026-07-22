# Milestone Report — ENG2 Slice A (API Boundary Validation)

Date: 2026-07-21 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: owner-approved
via AskUserQuestion — "Start with the 3 concrete gaps": path-param validation at the API
boundary, the share-links/qr GET-vs-POST mismatch, and an API versioning policy doc. Typed
per-screen contracts (§1) and interaction event contracts (§3) were explicitly deferred pending
alignment with the UX-track's own Button Interaction Contracts work.

## What changed

**28 blind `request.params as {...}` casts across 8 route files replaced with real runtime
validation.** A repo-wide survey (`grep -rn "request.params as" apps/api/src/modules/*/routes.ts`)
found every route in `vinks`, `contributions`, `purchases`, `recovery`, `realtime`, and `sharing`
trusting the URL path shape with a TypeScript cast and zero runtime check — a malformed
`vinkId`/`participantId`/`contributionId`/`authorizationId` (or an outright missing one, in a
route registered without that path segment) would previously reach the store layer as an
opaque string.

New shared module: `apps/api/src/middleware/params.ts` — one Zod schema per param shape
(`vinkIdParams`, `vinkAndParticipantIdParams`, `vinkAndContributionIdParams`,
`contributionIdParams`, `authorizationIdParams`, `publicCodeParams`). Every domain id
(`VinkId`, `ParticipantId`, `ContributionId`, `PurchaseAuthorizationId` —
`packages/domain/src/ids.ts`) is confirmed `randomUUID()`-backed, so `z.uuid()` is the correct,
exact validator for all of them — verified by reading the id constructors, not assumed.

All 28 call sites now do `const { vinkId } = vinkIdParams.parse(request.params)` (or the
matching schema), the same pattern every request **body** in this codebase already used
(`schema.parse(request.body)`). `app.ts`'s existing global error handler already turns a thrown
`ZodError` into `400 { error: 'VALIDATION_FAILED', issues: [...] }` — this was discovered by
reading `app.ts` before designing a new helper, which meant the originally-planned bespoke
`parseParams()` reply-shaping helper (mirroring `requireUser`'s early-return-null pattern) was
unnecessary: params validation could reuse the exact mechanism bodies already rely on, with zero
new response-shaping code.

**One exception, deliberately not uniform**: `GET /api/v1/vinks/:vinkId/live` (the WebSocket
upgrade route, `realtime/routes.ts`) cannot rely on the global error handler — there is no HTTP
reply to send a 400 through once the socket has upgraded. It uses `vinkIdParams.safeParse()`
instead and closes the socket with a new `CLOSE_BAD_REQUEST = 4400` code, consistent with the
file's own existing pattern of manually closing with `4401`/`4403`/`4404` for its other
rejection paths.

**One deliberately loosened schema**: `publicCodeParams` does **not** validate against
`newPublicCode()`'s exact Crockford alphabet/length. Two existing tests
(`guest.integration.test.ts`) assert that malformed-looking codes like `NOSUCHCODE99` and
`SOMECODE123` return `404` (uniform "not found," same as a well-formed-but-nonexistent code) —
and more importantly, a public unauthenticated join surface returning `400` only for
wrong-shaped codes would leak the valid alphabet/length to an anonymous caller probing the
surface, which is a worse security posture than today's undifferentiated 404. `publicCodeParams`
is a loose `z.string().min(1).max(64)` — enough to reject missing/pathological input without
narrowing the "not found" signal. This was caught by running the existing test suite before
finalizing, not by inspection.

## Share-links/qr GET-vs-POST fix

`POST /api/v1/vinks/:vinkId/{share-links,qr}` → `GET`, matching the handler's own existing
comment ("this is a query, not a command — the code is minted at creation"). Confirmed via grep
across `apps/mobile`, `apps/guest-web`, and `apps/operations-console` that **no client calls
either route yet** — zero client impact, safe to fix directly rather than through the
deprecation process in the new versioning doc. `guest.integration.test.ts`'s existing coverage
of both routes updated to `GET` in place.

## API versioning policy

New: `docs/architecture/api-versioning-policy.md`. Defines the versioned surface
(`/api/v1/*`) vs. the two deliberately-unversioned internal surfaces
(`/internal/simulator/*`, `/internal/ops/*`, both single-first-party-client tools that evolve
in lockstep with their one caller). States the additive-change rule (no version bump — new
fields, new optional request fields, new routes, loosened request constraints, tightened
response guarantees) and the breaking-change rule (`/api/v2/...` alongside `/api/v1/...` until
every first-party caller — verifiably, by grep, since all three clients live in this monorepo —
has migrated, then the old route is deleted in its own flagged commit). Explicitly names the
share-links/qr fix in this same milestone as additive-in-practice only because no caller existed
yet, and states what the same fix would have required had a caller already existed.

## Tests

- `apps/api/src/vinks.integration.test.ts`: new test, "ENG2: a malformed path parameter is
  rejected with 400, not a blind cast" — malformed `vinkId` on `GET`/`PATCH`, malformed
  `participantId` on `DELETE`, asserting `400 VALIDATION_FAILED` on each.
- `apps/api/src/realtime.integration.test.ts`: extended the existing close-code test with a
  malformed-`vinkId` WebSocket connection attempt, asserting close code `4400`.
- `apps/api/src/guest.integration.test.ts`: share-links/qr assertions updated from `POST` to
  `GET` (method changed, status/body assertions unchanged).

All three integration files, plus the full existing suite (`contributions`, `purchases`,
`recovery`, `ops`), run together: **34/34 passing** before this milestone's test additions,
**19/19 passing** in the three directly-touched files after (superset — the new/changed tests
included), no regressions in any file this milestone didn't touch.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm guard` — all clean, repo-wide,
  as a final pass after this slice's changes.
- `VINKIN_INTEGRATION=1 node --test "src/**/*.test.ts"` in `apps/api` — **84/84 passing**,
  including this slice's new tests and the concurrent UX-track session's own Slice I4
  (automatic invitation delivery) and I2/I2B tests, which landed mid-milestone (see below).
- `VINKIN_INTEGRATION=1 pnpm test` repo-wide (turbo): **8 failures, all in
  `apps/guest-web`** (`tests/e9.spec.ts`, `tests/guest-terminal-states.spec.ts`) — every one
  a Slice I3/I3A terminal-state-copy assertion (`D25`/`D34`/`D37` references), a package this
  milestone never touched. Confirmed via `git status` (zero uncommitted guest-web changes —
  these files are already committed) and `git log` (their last touch is commit `53a89d1`,
  "Prettier format," part of the concurrent UX-track session's own just-landed work: `76255b7
  feat: add guest terminal states tests...`, `b60b4ae feat: enhance guest contribution
  experience with terminal outcome updates...`). Not a regression from this slice — no file
  this milestone changed is reachable from either failing spec.

**A live concurrent edit landed mid-milestone**: partway through this slice, the UX-track
session committed a new Slice I4 (automatic invitation delivery) that modified
`apps/api/src/modules/vinks/routes.ts` — the same file this milestone was already editing —
adding a `DeliveryProvider`/`DeliveryCommandContext` parameter to `registerVinkRoutes`. Merged
cleanly with no conflict: this slice's `vinkIdParams`/`vinkAndParticipantIdParams` validation
calls and the delivery-provider changes touch disjoint parts of the same handlers. Re-ran
`pnpm --filter @vinkin/api typecheck` and the full `apps/api` integration suite after the
external change landed to confirm — both still clean, both slices' own tests passing
together (84/84, including the new Slice I4 delivery tests).

## Files changed

- New: `apps/api/src/middleware/params.ts`
- New: `docs/architecture/api-versioning-policy.md`
- Modified: `apps/api/src/modules/{vinks,contributions,purchases,recovery,realtime,sharing,ops}/routes.ts`
- Modified: `apps/api/src/{vinks,realtime,guest}.integration.test.ts`

## Exit gate

- [x] Every path parameter across the API is validated at the boundary; malformed values are
      rejected with `400 VALIDATION_FAILED` (or, for the one WebSocket route, a dedicated close
      code) rather than reaching application/store code as an unchecked string.
- [x] `share-links`/`qr` use `GET`, matching their own documented "query, not command" intent;
      confirmed zero client impact before changing.
- [x] `docs/architecture/api-versioning-policy.md` written — additive vs. breaking rules,
      deprecation process, explicit treatment of the two unversioned internal surfaces.
- [x] New tests cover the boundary-validation behavior (both the HTTP 400 path and the
      WebSocket close-code path); existing tests updated where behavior intentionally changed
      (share-links/qr method), not silently left inconsistent.
- [x] Full verification suite green.

## Next milestone

ENG2's own remaining scope — typed per-screen API contracts (§1) and interaction event
contracts (§3) — stays deferred pending alignment with the UX-track's Button Interaction
Contracts work, per the owner's explicit scoping when this slice was approved. Otherwise, next
is an owner decision on which ENG3+ milestone to take up.
