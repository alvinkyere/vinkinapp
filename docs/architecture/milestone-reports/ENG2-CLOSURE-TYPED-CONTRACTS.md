# Milestone Report — ENG2 Closure: Typed Screen and Interaction-Event Contracts

Date: 2026-07-22 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: owner-directed
resumption of ENG2's own deferred remainder, unblocked once the UX-track's Phase 5 (Button and
Interaction Contracts, `docs/design/phase-5-button-interaction-contracts.md`) landed. Owner's
exact brief: typed screen/view-model contracts for every canonical consumer surface, typed
interaction-event contracts for the approved C1–C45 interactions, event payload ownership and
privacy rules, versioning and backward-compatibility rules, compile-time and contract tests, a
traceability map from each type/event to its Phase 4 or Phase 5 source — "ground every type and
event in the approved Phase 4 screen contracts and Phase 5 interaction contracts. Do not invent
screens, actions, analytics events, or payloads." This closes ENG2 in full; ENG3 is explicitly
out of scope for this slice, per the owner's own instruction.

## What this closes

`milestone-reports/ENG2-SLICE-A-BOUNDARY-VALIDATION.md` (2026-07-21) covered ENG2's boundary-
validation/versioning-policy scope and explicitly deferred "typed per-screen API contracts (§1)
and interaction event contracts (§3) ... pending alignment with the UX-track's own Button
Interaction Contracts work." That alignment is now done — Phase 5 is approved
(`docs/design/phase-5-button-interaction-contracts.md`, its own §24 acceptance criteria show
two of three owner-confirmed) — so this milestone builds the deferred remainder against Phase 4
(`docs/design/phase-4-screen-contracts.md`) and Phase 5 directly, and closes ENG2.

## Grounding discipline

Every type and event below traces to a specific line in Phase 4 or Phase 5 — verified by
reading both documents in full before writing any code, not by inference. Concretely:

- The 17 screen/view-model contracts correspond exactly to Phase 4's 14 numbered sections
  (§5 expanded into its own §5a/§5b/§5c sub-screens per that section's own structure; §5d is
  explicitly "not canonical" in Phase 4's own text and has no contract; §6's title,
  "Live Vink — Lobby (organizer/member)," maps to two distinct real backend reads today —
  organizer-only `VinkSnapshot` and the Slice I2B `ParticipantVinkView` — so it became two
  contracts, not one that silently picks a side).
- The 46 distinct analytics event names correspond exactly to the `Analytics:` lines across
  Phase 5's 45 interaction contracts (31 contracts carry one; the other 14 — C6, C7, C11–C14,
  C28, C29, C38–C43 — carry none and are absent from the event vocabulary on purpose, not
  oversight).
- Where a screen's data already has a real, shipped application-layer type
  (`packages/application/src/{queries,guest}.ts`), the contract is a bare type alias to it
  (`export type LobbyScreenViewModel = VinkSnapshot`, three siblings), not a hand-copied shadow
  that could silently drift — enforced at compile time (see Tests, below).
- One real, pre-existing gap surfaced and is flagged rather than silently worked around: the
  domain `Vink` entity has no freeform purpose/name field at all (the same gap
  `milestone-reports/PV13.md` already flagged to the owner), yet Phase 4 requires a "purpose"
  line visibly on four different screens. Every affected field is typed as `PurchaseCategory`
  (the one real field that exists today) with an explicit doc comment explaining the
  substitution — never a fabricated `purpose: string` pointing at nothing.
- A second real, pre-existing gap surfaced during grounding, unrelated to the first: the
  events real code emits today (PV9/PV12-prep ad hoc analytics —
  `organizer_registered`, `guest_contribution_approved`, etc.) predate Phase 5 and use a
  different vocabulary than it. This is documented as a known-drift table
  (`docs/architecture/client-contracts-traceability.md` §4), not silently reconciled — renaming
  shipped analytics code is a product/telemetry change that could break
  `apps/operations-console`'s PV12-prep dashboard, which queries some of the old names by exact
  string; per the Spec's own §9 rule, this is flagged to the owner, not fixed here.

## What was built

**New package `packages/client-contracts`** (`@vinkin/client-contracts`, zero runtime
dependencies, same convention as `packages/ledger`/`packages/application`):

- `src/screens.ts` — 17 typed screen/view-model contracts, each with a doc comment citing its
  exact Phase 4 section and Built/Redesign/New status (Phase 5's own three-way vocabulary,
  restated per screen).
- `src/events.ts` — the 46-name `VinkinAnalyticsEvent` discriminated union plus
  `VinkinAnalyticsEventEnvelope`/`VinkinAnalyticsBatchRequest`, which mirror the real,
  already-shipped wire schema (`apps/api/src/modules/analytics/routes.ts`) rather than
  inventing a transport shape.
- `src/traceability.ts` — machine-checkable maps: screen contract id → Phase 4 section, event
  name → Phase 5 `Cxx` id(s), and the explicit 14-item no-analytics list — the data both the
  contract tests and the human-readable traceability doc are generated from/verified against.
- `src/type-test-utils.ts` — a standard `Equal<A,B>`/`Expect<T>` compile-time assertion pair
  (the `tsd`-style pattern), used to prove the four alias types never silently drift from the
  real backend type they claim to reuse.
- `src/{screens,events,traceability}.test.ts` — see Tests, below.

**Docs:**

- `docs/architecture/client-contracts-traceability.md` — the full human-readable traceability
  map (§1 screens, §2 events, §3 the 14 no-analytics interactions, §4 the known shipped-code
  drift table).
- `docs/architecture/client-contracts-ownership-and-privacy.md` — envelope field ownership
  (who sets `clientId`/`app`/`vinkId`/`occurredAt` and why), which client app may emit which
  event, six concrete privacy rules (no payload carries another participant's identity, a
  contact destination, a money amount, or free text — restated from the existing, already-
  enforced guest-privacy boundary in `packages/application/src/guest.ts`, not a new invention),
  and a flagged data-quality caveat about system-driven events being per-client-observation
  counts, not per-Vink counts.
- `docs/architecture/client-contracts-versioning-policy.md` — additive-vs-breaking rules for
  the event vocabulary and for screen contracts, explicitly relating to (not duplicating)
  `docs/architecture/api-versioning-policy.md` from ENG2 Slice A; a deprecation process mirrored
  from that same doc's §4; and an honest statement that adopting Phase 5's vocabulary today is
  an *initial migration* (nothing currently emits it), while migrating the *old*, currently-
  shipped names later would be a real deprecation requiring the full process.

**Backend, minimal and additive:** `apps/api/src/modules/analytics/routes.ts`'s `eventSchema`/
`batchSchema` gained an `export` keyword each (no behavior change) so a contract test could
Zod-parse real `@vinkin/client-contracts` event literals against the exact schema the route
enforces, not a hand-mirrored copy of it.

## Tests

- **Compile-time**: `pnpm --filter @vinkin/client-contracts typecheck` is the literal
  enforcement for two things — (a) `Expect<Equal<LobbyScreenViewModel, VinkSnapshot>>` and
  three siblings in `screens.test.ts`, which fail `tsc --noEmit` the moment a screen contract
  silently drifts from the real backend type it aliases; (b) exhaustive `switch` statements
  over `ScreenContractId` and `VinkinAnalyticsEventName` in `screens.test.ts`/`events.test.ts`,
  which fail `tsc --noEmit` at a `never`-typed default case if a new id/name is ever added
  without also handling it there.
- **Contract tests** (`node --test`, 12 in `packages/client-contracts`): every screen/event id
  has exactly one traceability entry and vice versa (no orphans in either direction); the
  31-analytics-covered-ids-plus-14-no-analytics-ids union equals exactly `C1`–`C45`, with no
  gaps and no double-counting; the traceability doc is asserted (by reading the actual file) to
  name every screen source and every event name this package declares; the ownership/privacy
  and versioning docs are asserted to exist.
- **Cross-package contract test** (`apps/api/src/analytics-contract.test.ts`, 2 tests): builds
  one representative event literal per distinct payload shape this package declares (empty,
  `{code}`, `{participantId}`, `{count}`, `{role}`, `{reason}`, `{source}`, `{context}`) and
  Zod-parses each against the real `batchSchema` — proving the typed contracts and the real
  wire schema actually agree, not just that they were written to look like they should.

## Scope boundary — explicitly not done, per the owner's own instruction to stop

This milestone defines and verifies types; it does **not** rewire `apps/mobile` or
`apps/guest-web` to import/consume them. `apps/guest-web/lib/types.ts` remains a hand-maintained
mirror (its own header comment already says so); `apps/mobile`'s Dart models remain unwired to
this package entirely (a different language — consuming this package there would mean
generating Dart from it, not importing it). `docs/architecture/client-contracts-versioning-
policy.md` §6 states this limitation explicitly rather than silently assuming it's solved.
Reconciling the shipped-analytics-vocabulary drift (§4 of the traceability doc) is also
untouched — a real product/telemetry decision for the owner, not a documentation/typing task.
Both are flagged as the natural next steps for whichever milestone actually wires a client to
these contracts — which, per the owner's instruction, is **not this milestone**: ENG3 does not
begin here.

## Verification

- `pnpm typecheck` — clean, all 10 packages (up from 9 — `@vinkin/client-contracts` is new).
- `pnpm lint` / `pnpm format:check` / `pnpm guard` — clean repo-wide.
- `apps/api`: **97/97 tests green** (up from 84 in the Slice A report — the increase is the
  concurrent UX-track session's own Slice I4B work plus this milestone's 2 new contract tests,
  confirmed by reading the intervening commits, not assumed).
- `packages/client-contracts`: **12/12 tests green** (new package).
- `apps/operations-console`: **2/2 Playwright tests green**, run against a real local API
  server started with the documented CORS env vars
  (`VINKIN_PUBLIC_BASE_URL=http://127.0.0.1:3100 OPERATIONS_CONSOLE_BASE_URL=http://127.0.0.1:3200`),
  per the recurring environment note carried in `CLAUDE.md` since ENG0.
- `apps/guest-web`: 33 passed, 10 failed, 1 skipped, same server up. Every failure is
  pre-existing Slice I3/I3A terminal-copy work from the concurrent UX-track session — confirmed
  via `git status` (zero uncommitted guest-web changes; this milestone touched no file under
  `apps/guest-web`) and `git log` (last touch on the failing spec files predates this
  milestone's start). Not a regression from this milestone.

## Files changed

- New package: `packages/client-contracts/` (`package.json`, `tsconfig.json`,
  `src/{index,screens,events,traceability,type-test-utils}.ts`,
  `src/{screens,events,traceability}.test.ts`).
- New: `docs/architecture/client-contracts-{traceability,ownership-and-privacy,versioning-policy}.md`.
- New: `apps/api/src/analytics-contract.test.ts`.
- Modified (additive, `export` keyword only): `apps/api/src/modules/analytics/routes.ts`.

## Exit gate

- [x] Typed screen/view-model contracts for every canonical consumer surface named in Phase 4
      (17 contracts, §1–§14 with §5 expanded and §6 split into its organizer/member branches).
- [x] Typed interaction-event contracts for the approved C1–C45 interactions (46 distinct event
      names across the 31 contracts that carry an `Analytics:` line; the other 14 explicitly
      and verifiably carry none).
- [x] Event payload ownership and privacy rules (`client-contracts-ownership-and-privacy.md`).
- [x] Versioning and backward-compatibility rules (`client-contracts-versioning-policy.md`).
- [x] Compile-time and contract tests (14 total: 12 in `packages/client-contracts`, 2 in
      `apps/api`).
- [x] A traceability map from each type/event to its Phase 4 or Phase 5 source
      (`client-contracts-traceability.md`, mechanically cross-checked against the code by
      `traceability.test.ts`).
- [x] Nothing invented: every screen, action, event, and payload traces to Phase 4/Phase 5;
      the two real gaps found (no domain `purpose` field, shipped-analytics vocabulary drift)
      are flagged in-line and in the traceability doc, never silently papered over.

**ENG2 is closed.** Per the owner's explicit instruction, ENG3 does not begin in this slice —
next is an owner decision on which milestone follows.
