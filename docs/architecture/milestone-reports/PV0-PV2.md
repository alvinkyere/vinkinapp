# Milestone Report — PV0–PV2 (Product-Validation Governance + Domain Core)

Date: 2026-07-17 · Track: product validation (D10) · Scope: master plan §29 — PV0 + PV2's
provider/HTTP-free deliverables; PV1 deliberately untouched. §45 report format.

## What was implemented

**PV0 — Build Governance (complete):**
- Owner's plan committed verbatim as `docs/product-validation/master-plan.md` (source of
  truth for the PV track, with provenance header).
- `docs/product-validation/00-governance.md`: green/yellow/red work classification in
  repo-mechanical form, M0-gate reconciliation, feature-flag declarations (all default off),
  environment definitions with simulator-endpoint allowlist rule, PV definition of done.
- Provider-import CI guard (`tooling/scripts/check-provider-imports.mjs`, zero-dependency):
  fails CI on any import or package.json dependency of a prohibited provider SDK outside the
  approved adapter directories. Wired as its own CI job.
- Decision log: **D10** (PV track adopted, ACCEPTED owner-directed; gate-boundary
  interpretations PROPOSED) and **D11** (state-machine vocabulary divergence, PROPOSED).

**PV2 — Core Vink Domain (complete except migrations):**
- New zero-dependency package `packages/domain` (`@vinkin/domain`), same conventions as the
  existing packages (Node ≥ 23.6 native type-stripping, erasable syntax only, strict).
- Money value object: integer minor units, floats/negatives/unsafe integers rejected at
  runtime; add/subtract/sum/compare; shape-compatible with the provider package's Money.
- Branded identifiers + Plan §11 idempotency-key builders (verbatim formats).
- Vink state machine (Plan §8) and Contribution state machine (Plan §9) as pure transition
  tables: illegal transitions throw `IllegalTransitionError`, never no-op; terminal-state
  sets exported; transition tables enumerable for tests/docs.
- Split engine (Plan §15): EQUAL (remainder to first participants — matches the §15
  example), CUSTOM_AMOUNT (exact-sum validation), PERCENTAGE (basis points, must total
  10000, largest-remainder rounding, input-order tie-break); ITEMIZED_LATER rejected;
  per-participant maximum enforcement; duplicate-participant rejection.
- Policy engine (Plan §16): `PurchasePolicy` types, category→policy mapping, EXACT_FINAL
  evaluation incl. settlement outcome (MATCHED/UNDERAGE/OVERAGE→recovery amount, journey
  E7), required = subtotal + tip assertion; RESTAURANT_VARIABLE gated behind the
  `restaurant_variable_policy` flag; high-variance categories rejected outright.
- Entity types (Plan §7): Vink, Participant, Contribution, TemporaryCard,
  PurchaseAuthorization, Settlement, RecoveryObligation + invariant assertions
  (exactly-one participant identity; §4.7 approved-maximum guard; vink amount bounds;
  card display-safety — four digits only, no PAN/CVV shape possible).
- Typed error taxonomy (`DomainError` with eight codes).

## Files changed

New: `docs/product-validation/{master-plan,00-governance,01-database-schema-proposal}.md`,
`tooling/scripts/check-provider-imports.mjs`, `packages/domain/**` (8 source + 5 test files,
package.json, tsconfig.json), this report.
Modified: `.github/workflows/ci.yml` (guard job, domain tests, domain typecheck),
`docs/spec/decision-log.md` (D10, D11), `docs/spec/open-questions.md` (G13, G14),
`docs/architecture/05-milestone-sequence.md` (§0 PV track), `CLAUDE.md`, `README.md`.

## Database changes

None executed (per Plan §29 scope and the open M0 gate). Committed a full schema **proposal**
synchronized with the domain: `docs/product-validation/01-database-schema-proposal.md` —
status CHECKs generated from domain unions, exactly-one-identity CHECK, §4.7 trigger note,
append-only balanced ledger inheriting doc 04 §5 enforcement, idempotency + outbox tables.
Migrations land when PV1's platform exists.

## APIs added

None (Plan §29: no HTTP endpoints in this pass).

## UI added

None (Plan §29: no UI in this pass). Flagged: Spec §9 says no milestone is backend-only —
the owner's §29 instruction explicitly scopes UI out of PV0–PV2, so this is owner-directed,
not a silent relaxation. UI obligations resume at PV9/PV10.

## Tests added

46 new tests in `packages/domain` (repo total 80, all green; `node --test`, zero deps):
- Vink machine: all 19 legal transitions verified against the Plan §8 diagram; **exhaustive**
  rejection of all 285 illegal state×event pairs; terminal-state closure; E6 guard (expired
  sessions cannot reopen); reachability proof (every state reaches a terminal).
- Contribution machine: all 21 legal transitions; exhaustive rejection of the 252 illegal
  pairs; terminal closure; E5 (lost response resolves on the same contribution) and E8
  (refund retry loop) walkthroughs; reachability proof.
- Split engine: §15 example ($100/3 → 33.34/33.33/33.33), even splits, determinism,
  adversarial totals × participant counts sum-exactness, zero-participant/duplicate/mismatch/
  negative/over-maximum/non-integer-bps/ITEMIZED_LATER rejections, percentage
  largest-remainder behavior.
- Money: float/negative/NaN/Infinity/unsafe rejection, arithmetic, no-negative-subtraction,
  empty-sum, comparisons.
- Policy: category mapping, MVP rejections, flag-gated restaurant, E7 overage→recovery,
  required = subtotal + tip.
- Entities/ids: identity invariant, §4.7 guard, vink bounds, card display safety, §11 key
  formats + stability/generation semantics.

Verification run: `npm test` green in all three packages (46 + 14 + 20); strict `tsc --noEmit`
clean on all three tsconfigs; guard passes.

## Known limitations

1. `packages/domain` is pure decision logic — persistence, row locking, outbox, and timers
   (Plan §10–§12) are PV3+/PV5 wiring; the machines document those obligations but cannot
   enforce them.
2. Plan §8/§9 leave edges unspecified; implemented as flagged interpretations (**G13**,
   awaiting owner confirmation): FUNDING_REVERSAL→EXPIRED on reversal completion;
   CANCELLATION_PENDING→CANCELLED | RESOLUTION_PENDING; RESOLUTION_PENDING resolves to
   AUTHORIZED/DECLINED/CAPTURED/CANCELLED via the resolve job; REFUND_FAILED→REFUND_PENDING
   on retry; DRAFT cancellation not modeled (plan shows cancel from OPEN only); DECLINED is
   terminal per-contribution (retry = new contribution, next attempt number).
3. PV vocabulary diverges from Spec-derived doc 03 machines — **D11** (PROPOSED); reconcile
   before provider integration (**G14**).
4. Two idempotency-key families coexist: Plan §11 command keys (`@vinkin/domain`) and Spec
   §12 provider operation ids (`@vinkin/payment-provider`). Mapping is an application-layer
   (PV5) concern; flagged so it isn't discovered as a surprise.
5. The import guard matches JS/TS import syntax and package.json manifests; Dart (Flutter)
   scanning is not needed until PV9 — extend the guard before PV9.
6. PV1 was skipped by design; the PV2 exit gate ("domain workflows run without HTTP, UI or
   provider dependencies") is met, but migrations from the schema proposal await PV1.

## Security review

- No provider SDKs, no network, no secrets anywhere in the new code; CI guard now enforces
  the boundary mechanically.
- Card types/assertions make PAN/CVV storage structurally impossible (four-digit display
  field only); schema proposal carries the same CHECK.
- §4.7 (never charge beyond approved maximum) is an executable invariant, tested.
- Idempotency keys are server-derived and deterministic — no client-minted keys.
- Simulator endpoints (future) governed by an environment **allowlist** rule, not a
  not-production check (governance §5).
- Money rejects floats and unsafe integers at construction, closing rounding-drift risk.

## Next milestone

Owner decision point (per master plan §29 "stop after PV2 and report"):
1. **Ratify or amend** D11 and the G13 interpretations.
2. **Go/no-go for PV1** (platform foundation: pnpm/Turborepo, Fastify API, PostgreSQL,
   Redis, BullMQ, docker-compose, auth, seed script) — requires pnpm installed locally.
3. Unchanged and parallel: send the feasibility outreach package; the M0 gate work is not
   displaced by the PV track.
