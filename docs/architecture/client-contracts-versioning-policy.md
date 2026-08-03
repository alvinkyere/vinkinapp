# Client Contracts Versioning Policy

_ENG2 (Contract Engineering), remaining scope. Governs how the typed contracts in
`packages/client-contracts/src/{screens,events}.ts` may change without breaking a consumer.
Companion to `docs/architecture/client-contracts-traceability.md` (what exists) and
`docs/architecture/client-contracts-ownership-and-privacy.md` (who owns each field)._

## 1. Two different kinds of contract, two different versioning stories

This package declares two structurally different things, and they inherit compatibility rules
from different places:

- **Event vocabulary** (`events.ts`): event names and payload shapes that ride over the
  already-versioned `POST /api/v1/analytics/events` route
  (`apps/api/src/modules/analytics/routes.ts`). The wire *envelope*
  (`clientId`/`app`/`vinkId`/`properties`/`occurredAt`) is already governed by
  `docs/architecture/api-versioning-policy.md` like any other `/api/v1/*` request body — this
  document does not re-litigate envelope versioning. What this document governs is the
  vocabulary *inside* `properties` and `eventName`, which the envelope's own Zod schema
  (`eventName: z.string()`, `properties: z.record(z.string(), z.unknown())`) deliberately
  leaves open-ended — the real backend enforces the envelope shape, never the specific event
  names or payload fields living inside it. That enforcement is this package's job (via
  `screens.test.ts`/`events.test.ts`/`traceability.test.ts`), not the backend's.
- **Screen/view-model contracts** (`screens.ts`): some are bare aliases of a real
  application-layer type already returned by a real `/api/v1/*` route (`LobbyScreenViewModel =
  VinkSnapshot`, and three siblings — see the traceability doc §1). Those four inherit
  `api-versioning-policy.md`'s response-field rules automatically, because they're aliases,
  not copies: a breaking change to `VinkSnapshot` is already a breaking API change under that
  policy, full stop, and this package's compile-time `Equal<>` checks
  (`screens.test.ts`) simply guarantee this file notices. The remaining screen contracts have
  no server component at all (Welcome/Login/Register/Create-wizard/Profile/reauth-overlay are
  local client state; Activity list/details are New — designed, not built, with no query to
  alias yet) — those version like any other internal TypeScript type in this monorepo (§3
  below).

## 2. Event vocabulary — additive-change rule (no coordination required)

An event-vocabulary change is **additive** if every existing consumer of
`/api/v1/analytics/events` — today, that's only `apps/operations-console`'s `/analytics`
dashboard (`milestone-reports/PV12-prep-analytics.md`) — keeps working unmodified:

- Adding a brand-new event name to `VINKIN_ANALYTICS_EVENT_NAMES`.
- Adding a new optional field to an existing event's `properties` — the real schema's
  `properties: z.record(z.string(), z.unknown())` already accepts arbitrary keys, so this
  requires no backend change at all, only a `client-contracts` + traceability-doc update.
- Widening a payload field that's a closed string union (e.g. `reason: 'delivery_failed' |
  'manual'` gaining a third value) **only if** every real consumer of that field already
  falls back safely on an unrecognized value — mirrors `api-versioning-policy.md` §2's
  identical enum rule, restated here because `properties` fields are exactly this shape.

## 3. Event vocabulary — breaking-change rule (requires the deprecation process, §5)

- Renaming an event name. Every consumer queries `eventName` by exact string (the ops-console
  dashboard, any future funnel query) — there is no server-side aliasing layer.
- Removing or narrowing a payload field a real consumer already reads.
- Changing what an existing event name *means* without changing its name (e.g. redefining
  `vink_completed` to also fire on `RECOVERY_REQUIRED`) — this is the vocabulary-contract
  equivalent of `api-versioning-policy.md`'s "changing a field's type or semantic meaning"
  rule, and is exactly as prohibited here without going through §5.

## 4. Screen contracts — additive vs. breaking

- The four alias types (`LobbyScreenViewModel` and siblings, traceability doc §1): governed
  entirely by `api-versioning-policy.md` §2/§3, since a change here is definitionally a change
  to the real application-layer type. No separate rule needed.
- The remaining, client-local-only screen contracts: additive is "new optional field, existing
  field unchanged"; breaking is "removed/renamed/retyped a field an actual client screen
  reads." Because every current consumer of these types lives in this same monorepo and is
  typechecked in the same `tsc --noEmit` run this package's own `typecheck` script triggers
  (once a client actually imports from `@vinkin/client-contracts` — see §6's honesty note),
  a breaking change to one of these fails the build immediately rather than shipping silently.

## 5. Deprecation process for an event name

Mirrors `api-versioning-policy.md` §4's shape, adapted for a vocabulary change rather than a
route change:

1. The new event name ships in `events.ts`/the traceability doc alongside the old one, both
   still declared.
2. Whichever client(s) emit the old name migrate to the new one — tracked as its own follow-up,
   not silently bundled into an unrelated milestone.
3. Once grep confirms zero remaining emit sites for the old name across `apps/mobile` and
   `apps/guest-web`, the old event name is removed from `events.ts`/the traceability doc in a
   dedicated commit, and the removal is recorded in `docs/spec/decision-log.md`.

**This process does not currently apply to anything** — as
`client-contracts-traceability.md` §4 documents, no client in this repo emits any of Phase 5's
46 canonical event names yet; the events real code emits today (`organizer_registered`,
`guest_contribution_approved`, etc.) predate Phase 5 and were never migrated to it. Adopting
Phase 5's vocabulary for the first time is therefore an **initial migration**, not a
deprecation — no dual-emit period is needed for names nothing downstream depends on yet. The
*old*, currently-shipped names are a different story: `apps/operations-console`'s dashboard may
already depend on some of them by exact string, so migrating *those* to Phase 5's vocabulary
later, if the owner directs it, does need the full §5 process — flagged here so whichever
milestone does that migration doesn't skip it.

## 6. Enforcement — and its one honest limitation

- **Compile-time**: `pnpm --filter @vinkin/client-contracts typecheck` (`tsc --noEmit`) is the
  literal enforcement mechanism for the four alias types' `Equal<>` checks
  (`screens.test.ts`) — a breaking change to the real backend type fails this before any test
  runner even starts.
- **Contract tests**: `events.test.ts`/`traceability.test.ts` assert the event-name registry
  and the traceability doc stay in lockstep with each other and with Phase 5's own C1–C45
  count; `apps/api/src/analytics-contract.test.ts` asserts every distinct payload shape this
  package declares actually parses against the real, already-shipped Zod schema.
- **One honest limitation**: `apps/guest-web/lib/types.ts` is a **hand-maintained mirror** of
  the equivalent application-layer types (its own header comment says so — "Mirrors
  `packages/application/src/guest.ts`'s ..."), not an import of this package or of
  `packages/application` directly (Next.js's own module-resolution boundary is why — see
  `apps/mobile`'s Dart types for the same pattern, one language further removed). Nothing
  today automatically fails a build if `apps/guest-web/lib/types.ts` drifts from this
  package's `GuestSessionViewModel`/`GuestJoinFormViewModel`, or if `apps/mobile`'s Dart models
  drift from `LobbyScreenViewModel`. Actually wiring either client to import from
  `@vinkin/client-contracts` (Next.js) or to generate Dart types from it (mobile) is real
  implementation work — out of scope for this ENG2 slice, flagged here rather than silently
  assumed solved.
