# Decision Log

Every interpretation of the Spec, every G1–G12 resolution, and every architectural choice
gets an entry. Statuses: `PROPOSED` (engineering default, not yet ratified by the owner),
`ACCEPTED`, `REJECTED`, `SUPERSEDED (by Dn)`. Newest entries at the top. No decision is
implemented while `PROPOSED` if it touches money, the Spec's §4 invariants, or a frozen
contract.

---

## D16 — Production-shaped realtime fanout: Redis-backed hub, in-process retained for tests

- **Decision:** `apps/api/src/realtime/hub.ts` exposes a `RealtimeHub` interface with two
  implementations: `RedisRealtimeHub` (ioredis pub/sub — one publish connection, one
  dedicated subscriber connection, reference-counted local channel subscriptions) used by
  `server.ts`, and `InProcessRealtimeHub` (the original PV8 implementation) kept for unit
  tests that don't need infrastructure. The outbox publisher (`outbox-publisher.ts`) was
  hardened alongside this: `SELECT … FOR UPDATE SKIP LOCKED` lets multiple API instances
  poll concurrently without double-claiming rows, and the provider-neutral pattern from
  D12/§12 applies — publish-then-commit, so a crash between them causes at most a harmless
  duplicate delivery (at-least-once, idempotent consumers), never a lost one.
- **Date:** 2026-07-18
- **Status:** ACCEPTED (owner-directed: "settle both now" — formal PV8.5 milestone)
- **Reason:** the PV8 hub was explicitly flagged single-process-only; multiple API
  instances (any real deployment beyond a single validation-pilot box) need a shared
  fanout or WebSocket clients on different instances silently miss events.
- **Alternatives considered:** PostgreSQL LISTEN/NOTIFY (rejected: payload size limits and
  no reference-counted subscription primitive; revisit if Redis becomes undesirable);
  keeping single-process and documenting it as a pilot-only limitation (rejected — the
  owner asked to settle it, and Redis is already a required dependency via BullMQ).
- **Affected modules:** `apps/api/src/realtime/*`, `server.ts`.
- **Revisit trigger:** none expected; LISTEN/NOTIFY reconsidered only if Redis is dropped
  as an infra dependency entirely.

## D15 — Provider-calls-inside-transaction pattern ratified as intentional for the mock build

- **Decision:** `contributions.ts`, `purchases.ts`, and `recovery.ts` call
  `FinancialProvider` methods **inside** the PostgreSQL row-locked transaction that also
  writes domain state. This was flagged (not silently carried) in each module's header
  since PV5. It is now formally **ratified as correct for the validation build** rather
  than rewritten into a two-phase (reserve → external call outside any transaction →
  record result) pattern, for a reason rooted in project scope, not convenience: the
  *shape* of a correct two-phase design depends on the real provider's own idempotency and
  webhook semantics (Stripe's differ meaningfully from Lithic's), which are unconfirmed
  while the M0 gate is open. The gate's own rule — "anything whose shape would change if
  condition 1 or 2 came back 'no' is forbidden until those conditions are met"
  (`docs/architecture/06-milestone-0-gate.md`) — applies here: building speculative
  two-phase provider orchestration now risks guessing a design the real adapter discards.
  The mock provider is in-process and synchronous, so no external-call risk (timeout,
  partial failure independent of the DB transaction) actually exists today to harden
  against.
- **Date:** 2026-07-18
- **Status:** ACCEPTED (owner-directed scoping decision, made explicit rather than silently
  deferred — Spec §9)
- **Reason:** see above; distinguishes "flagged and consciously deferred with a named
  trigger" from tech debt silently carried forward.
- **Alternatives considered:** speculative two-phase rewrite now (rejected: guesses a
  provider-specific design before a provider is chosen, contradicts the M0 gate's own
  boundary, and risks the ~110 tests across PV5–PV7 for unproven value); do nothing /
  leave the flag unresolved (rejected: the owner asked to settle it — this makes the
  scoping decision explicit and owner-visible instead).
- **Affected modules:** `packages/application/src/{contributions,purchases,recovery}.ts`
  (comments updated to point here instead of a vague "D10 revisit").
- **Revisit trigger:** M0 gate closure and the first real-adapter design review
  (master plan §28) — the two-phase pattern is designed then, against the actual chosen
  provider's semantics, not before.

## D14 — Validation-build guest token design (PV4 subset of G4)

- **Decision:** guest join mints one opaque token (`vgt_` + 32 random bytes, base64url) per
  join; only its SHA-256 hash is stored (`guest_identities.access_token_hash`, UNIQUE). One
  guest identity binds to exactly one participant slot (partial UNIQUE index — G4's
  "single-slot binding"). Expiry: 7 days from join (covers post-completion status screens).
  The raw token appears exactly once, in the join response. Public surfaces
  (`GET /join/:code`, guest join) are rate-limited per IP (in-memory fixed window;
  Redis-backed when horizontal scale arrives).
- **Date:** 2026-07-18
- **Status:** PROPOSED (engineering default for the mock-money build; G4's production
  questions — verification factor, SMS OTP amount threshold, production TTL — remain OPEN
  and are re-decided before real money at M4)
- **Reason:** Plan §21 mandates hashed guest tokens and rate-limited public joins; no real
  money means no OTP requirement yet.
- **Alternatives considered:** JWT guest tokens (rejected: revocation and single-slot
  binding are simpler with a hashed opaque token); 15-minute TTL per G4's proposed default
  (rejected for the validation build: guests must reopen their status screen across the
  session's whole life).
- **Affected modules:** `packages/application` (guest.ts), `apps/api` (guest-tokens,
  sharing routes, migration 0003).
- **Revisit trigger:** M4 entry (real-money guest checkout) or pilot feedback on token
  lifetime.

## D13 — Command model: all business behavior is an explicit application command

- **Decision:** no transport (HTTP handler, WebSocket, CLI, job) may mutate a domain
  aggregate directly. Every business action is an application-layer command
  (`OpenVinkCommand`, `JoinVinkCommand`, `AuthorizeContributionCommand`, …) with one shape:
  validate → load aggregate → execute transition → emit event → return aggregate. Endpoints
  are transport bindings to commands, nothing more (owner's PV3 refinement: Flutter calls
  `OpenVinkCommand` through the application layer, not `POST /vinks/:id/open` semantics).
- **Date:** 2026-07-17
- **Status:** ACCEPTED (owner-directed)
- **Reason:** keeps provider replacement and transport changes trivial; one auditable path
  for every state change (pairs with D12).
- **Alternatives considered:** route-handler orchestration (rejected: scatters invariants
  across transports).
- **Affected modules:** future `packages/application` (PV3+); PV1 identity endpoints predate
  the financial aggregates and are brought under commands when the application layer lands.
- **Revisit trigger:** a command that cannot fit the five-step shape.

## D12 — Every successful state transition atomically produces its domain event

- **Decision:** a state transition and its domain event are inseparable. In code,
  `transitionVink` / `transitionContribution` return `{ to, emits }` — the transition table
  itself names the event, so a silent transition is unrepresentable. In persistence (PV3+),
  the state write and the outbox insert commit in the same transaction (Plan §12).
- **Date:** 2026-07-17
- **Status:** ACCEPTED (owner-directed)
- **Reason:** analytics, notifications, and replay all need a complete event stream; an
  optional event is eventually a missing event.
- **Naming note (flagged, not silent):** events use the Plan §12 catalog names — the owner's
  illustrative `CardProvisioningStarted` is realized as the catalog's
  `TemporaryCardRequested`. Additive catalog extensions required for full coverage (marked
  in `packages/domain/src/domain-events.ts`): `MerchantAuthorizationReversed`,
  `ContributionCaptureStarted`, `ContributionCancellationStarted`, `ContributionCaptured`,
  `ContributionCancelled`, `ContributionSettled`, `RefundFailed`, and (PV3)
  `ParticipantRemoved`.
- **Affected modules:** `packages/domain` (implemented), future outbox wiring (PV3+).
- **Revisit trigger:** an event catalog change in a future plan revision.

## D11 — PV state-machine vocabulary diverges from doc 03; PV governs the validation build

- **Decision:** the validation build implements the master plan's §8/§9 machines verbatim
  (`OPEN`, `PROCESSING_GRACE` → `FUNDED`/`EXPIRED`, `CARD_PROVISIONING`/`CARD_READY`,
  `PURCHASE_AUTHORIZED`, `SETTLING`, …) in `packages/domain`. The Spec-derived machines in
  `docs/architecture/03-state-machines.md` (`READY`/`LIVE`, `EVALUATING`/
  `PROVIDER_RECONCILIATION`, `SPEND_PREPARATION`/`CARD_ACTIVE`, …) remain the production-track
  reference. The two must be reconciled into one vocabulary **before** provider integration
  begins (M0 gate closure is the trigger).
- **Date:** 2026-07-17
- **Status:** ACCEPTED AS AMENDED (owner, 2026-07-17): the PV plan's state names are
  **canonical everywhere** — one ubiquitous language. Doc 03 rewritten to the canonical
  vocabulary; the alternate vocabulary (`READY`/`LIVE`, `EVALUATING`/
  `PROVIDER_RECONCILIATION`, `SPEND_PREPARATION`/`SPEND_READY`/`CARD_ACTIVE`, …) is retired.
  Documentation adapts to the code, not the other way around. The G13 edge interpretations
  were ratified as implemented in the same review. Historical docs (doc 00, D5/D6 entries)
  keep their original wording as dated records with a supersession note.
- **Reason:** the owner-directed PV plan is explicit and simpler (mock-only build has no
  provider-reconciliation phase); silently merging the two vocabularies would be a silent
  spec change. D5's single-resolver rule is preserved: one resolver decides
  FUNDED/EXPIRED exactly once out of PROCESSING_GRACE.
- **Alternatives considered:** implement doc 03's machines instead (rejected: contradicts the
  owner's verbatim directive); merge on the fly (rejected: silent change).
- **Affected modules:** `packages/domain`, future PV3+ application services.
- **Revisit trigger:** M0 gate closure / first real adapter design review.

## D10 — Product-validation (PV) track adopted alongside the M0 gate

- **Decision:** the owner's Provider-Neutral Product Validation Build plan
  (`docs/product-validation/master-plan.md`, PV0–PV12) is adopted as the active engineering
  track while the M0 gate remains open. All PV work is mock-backed and provider-neutral;
  gate-boundary interpretations are recorded in
  `docs/product-validation/00-governance.md` §1 (mock card/settlement flows permitted;
  validation-build ledger DDL is not "production ledger migrations"; provider integration
  still requires the ten-condition gate).
- **Date:** 2026-07-17
- **Status:** ACCEPTED (owner-directed); gate-boundary interpretations **RATIFIED by the
  owner 2026-07-17** — mock card/settlement/authorization/refund flows are domain concepts,
  not provider concepts; provider swap later touches only the adapter
- **Reason:** validate the product with real users before a provider is confirmed, without
  building anything whose shape depends on unconfirmed funds flow.
- **Alternatives considered:** wait for provider answers before building (rejected by owner:
  product risk is testable now); build against Stripe sandbox speculatively (rejected:
  exactly what the M0 gate forbids).
- **Affected modules:** milestone sequencing (PV0–PV12 interleaved before M1+), new
  `packages/domain`, CI (provider-import guard).
- **Revisit trigger:** any M0 gate answer that invalidates the mock card/settlement model.

## D9 — Repository relocation to `~/code/vinkin`

- **Decision:** move the repo out of `~/Downloads/Vinkin - v1` (space in path, volatile
  location, unrelated `CLAUDE.md` in parent) to `~/code/vinkin` before further tooling lands.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (owner-directed); execution pending — owner performs the move + git init
- **Reason:** stable lowercase path prevents breakage in shell scripts, CI, Docker mounts,
  agent sessions.
- **Alternatives considered:** stay in place (rejected: every future artifact would embed a
  fragile path).
- **Affected modules:** none in-repo (no absolute paths are committed anywhere).
- **Revisit trigger:** none.

## D8 — Formal ten-condition M0 gate

- **Decision:** M0 closes only via the evidence-linked gate in
  `docs/architecture/06-milestone-0-gate.md`; it defines permitted vs. forbidden work while
  open.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (owner-directed)
- **Reason:** "wait for Stripe" is not auditable; conditions + written evidence are.
- **Alternatives considered:** informal exit list in the feasibility doc (superseded).
- **Affected modules:** milestone sequencing; feasibility docs.
- **Revisit trigger:** any gate condition proving impossible to evidence in writing.

## D7 — Shared provider conformance suite + explicit `ProviderCapabilities`

- **Decision:** every `FinancialProvider` adapter must pass
  `packages/payment-provider-contract-tests`; adapters declare a ten-flag
  `ProviderCapabilities` object and the application branches on flags, never on assumptions.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (owner-directed)
- **Reason:** Spec §21 "do not assume those features are universally available"; §9 fallback
  visibility.
- **Alternatives considered:** per-adapter ad hoc tests (rejected: drift), capability probing
  at runtime (rejected: hides program-level facts).
- **Affected modules:** `payment-provider`, all future adapters, payment orchestrator (M5+).
- **Revisit trigger:** a capability that can't be expressed as a boolean (then evolve the
  shape via a new decision).

## D6 — Authorization-expiry status `EXPIRED` added to the neutral status set

- **Decision:** provider payment statuses include `EXPIRED` (hold lapsed before
  capture/cancel), distinct from `CANCELED`.
- **Date:** 2026-07-16
- **Status:** ACCEPTED
- **Reason:** §21 warns holds don't survive days; orchestrator must distinguish "we released
  it" from "it lapsed" for §25 messaging and reconciliation.
- **Alternatives considered:** fold into CANCELED with a reason field (rejected: reconciliation
  sweeps need the distinction first-class).
- **Affected modules:** `payment-provider`, future M5 contribution engine.
- **Revisit trigger:** provider evidence that expiry is not observable as a distinct state.

## D5 — `EVALUATING` is the zero-length fast path of the single session resolver

- **Decision:** Spec §13's `SUBMISSIONS_CLOSED → EVALUATING` (no unresolved attempts) and the
  §14 grace path run the same resolver code under the same vink row lock; the funding
  decision happens exactly once.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (interpretation; flagged in doc 00 §2.3.1)
- **Reason:** §14 requires expiry worker and webhook processor to share one locking strategy.
- **Alternatives considered:** two code paths (rejected: the race between them is exactly the
  bug class §14 exists to prevent).
- **Affected modules:** vinks module (M3/M5).
- **Revisit trigger:** owner reading of §13 differs.

## D4 — Membership states live on `vink_members`; contribution slots are purely financial

- **Decision:** §11's INVITED/JOINED vocabulary is membership, not payment; slots begin at
  `PAYMENT_NOT_STARTED`. API responses may still project the combined §11 vocabulary.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (interpretation; flagged in doc 00 §2.3.2)
- **Reason:** one aggregate per concern; removal rules (§15) act on membership, capture rules
  on slots.
- **Alternatives considered:** one merged state machine (rejected: forces illegal-transition
  handling for orthogonal concerns).
- **Affected modules:** vinks + contributions modules, DB schema doc §2/§3.
- **Revisit trigger:** API design review in M3.

## D3 — `parseWebhookEvent` added to the §43 interface

- **Decision:** the provider interface carries webhook signature verification + event
  normalization.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (additive extension; flagged in doc 00 §2.3.4)
- **Reason:** §28 mandates signature verification, which is provider-specific by nature.
- **Alternatives considered:** separate `WebhookVerifier` interface (rejected for V1: one
  provider surface, one adapter object).
- **Affected modules:** `payment-provider`, webhooks module (M5).
- **Revisit trigger:** an adapter whose webhook handling can't be expressed in this shape.

## D2 — Ledger tables land in Milestone 5; M6 is projections + reconciliation

- **Decision:** `ledger-core` package and `ledger_*` DDL ship with the contribution engine
  (M5), because §26/§27 make capture confirmation and ledger posting one transaction.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (owner review 2026-07-16 endorsed; flagged in doc 05 §1)
- **Reason:** M5 cannot exist without postings; only the milestone label moves, no scope.
- **Alternatives considered:** stub postings in M5 (rejected: violates §27 atomicity from day
  one).
- **Affected modules:** ledger, contributions.
- **Revisit trigger:** none.

## D1 — Monorepo tooling: pnpm workspaces + turborepo; Flutter outside the JS workspace

- **Decision:** as titled; details in `docs/architecture/01-monorepo-structure.md`.
- **Date:** 2026-07-16
- **Status:** ACCEPTED
- **Reason:** strict dependency isolation (protects §43 provider boundary), cached CI.
- **Alternatives considered:** npm workspaces (weaker isolation), Nx (heavier than needed),
  melos-managed Flutter inside the workspace (pretends Dart is a JS package).
- **Affected modules:** all, from M1.
- **Revisit trigger:** M1 retro if CI times or DX disappoint.
