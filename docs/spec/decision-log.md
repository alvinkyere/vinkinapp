# Decision Log

Every interpretation of the Spec, every G1–G12 resolution, and every architectural choice
gets an entry. Statuses: `PROPOSED` (engineering default, not yet ratified by the owner),
`ACCEPTED`, `REJECTED`, `SUPERSEDED (by Dn)`. Newest entries at the top. No decision is
implemented while `PROPOSED` if it touches money, the Spec's §4 invariants, or a frozen
contract.

---

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
