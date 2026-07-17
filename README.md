# VinkIn

Real-time collaborative checkout: a group pays together at the register; the merchant receives
**one normal card payment** from a temporary virtual card. Not a wallet, not a savings pool,
not P2P — see the Spec's product definition (§1) and final product rule (§44).

## Project status — Milestone 0 (Provider Feasibility)

M0 closes only via the ten-condition, evidence-linked gate:
**[docs/architecture/06-milestone-0-gate.md](docs/architecture/06-milestone-0-gate.md)** —
it also defines what work is permitted vs. forbidden while the gate is open.

```text
Engineering planning:        COMPLETE  (ten §45 artifacts, docs/)
Provider abstraction spike:  COMPLETE  (interface + mock, 34/34 tests, strict typecheck clean)
Provider conformance suite:  COMPLETE  (runs against every future adapter)
Feasibility outreach package:READY TO SEND (docs/feasibility/)
Repository initialization:   DONE      (baseline commit on main; remote: github.com/alvinkyere/vinkinapp)
Repository relocation:       PENDING   (move to ~/code/vinkin — see "Owner setup")
Real provider feasibility:   BLOCKED   (sandbox accounts + written provider answers)
Legal funds-flow validation: BLOCKED   (counsel questionnaire ready)
Milestone 0 overall:         IN PROGRESS
```

## Repository map

```text
docs/
├── spec/
│   ├── master-roadmap-prompt.md          # THE SPEC (verbatim, read-only) — all §N refs point here
│   ├── decision-log.md                   # D1–D9…: every interpretation/choice, with status
│   ├── open-questions.md                 # G1–G12: unresolved, with owners and proposed defaults
│   └── glossary.md
├── architecture/
│   ├── 00-current-state-and-gaps.md      # assessment + gap analysis + flagged interpretations
│   ├── 01-monorepo-structure.md          # tooling, layout, dependency rules
│   ├── 02-domain-model.md                # bounded contexts, aggregates, invariants, events
│   ├── 03-state-machines.md              # transition tables + guards
│   ├── 04-database-schema.md             # reference DDL incl. ledger enforcement triggers
│   ├── 05-milestone-sequence.md          # M0–M10 dependencies and exit criteria
│   └── 06-milestone-0-gate.md            # ★ the M0 closure authority
├── feasibility/                          # ★ outreach package — send these
│   ├── provider-overview.md              #   one-pager for provider partnerships teams
│   ├── funds-flow.md                     #   canonical funds-flow (providers + counsel)
│   ├── provider-questionnaire.md         #   21 written-answer questions
│   ├── counsel-questionnaire.md          #   money transmission, Reg E, disputes, KYC, escheat
│   ├── sandbox-test-plan.md              #   S1–S12 with pass criteria + results table
│   └── responses/                        #   file written answers here (gate evidence)
├── provider-integration/
│   └── 00-provider-feasibility.md        # internal analysis: candidate stacks A/B/C
└── threat-model/
    └── 00-risk-register.md               # R1–R20, re-scored each milestone

packages/
├── payment-provider/                     # Spec §43 interface + ProviderCapabilities + Mock
└── payment-provider-contract-tests/      # conformance suite every adapter must pass

.github/workflows/ci.yml                  # tests + strict typecheck on every push/PR
```

## Authority order

1. `docs/spec/master-roadmap-prompt.md` — the Spec. Changes are owner decisions with a dated
   changelog entry.
2. `docs/spec/decision-log.md` — ratified interpretations; `open-questions.md` — what's not
   decided. Nothing is built on a `PROPOSED` default that an open answer could invalidate.
3. Remaining `docs/` — derived design; each flags where it interprets the Spec.
4. Code.

## Running what exists

```bash
# tests — no install needed (Node ≥ 23.6; native TypeScript type-stripping)
cd packages/payment-provider && npm test                  # 14 tests
cd packages/payment-provider-contract-tests && npm test   # 20 conformance tests, 0 skips

# strict typecheck — needs a one-time install
npm install --no-save typescript@^5.8 @types/node@^24     # at repo root
./node_modules/.bin/tsc --noEmit -p packages/payment-provider/tsconfig.json
./node_modules/.bin/tsc --noEmit -p packages/payment-provider-contract-tests/tsconfig.json
```

## Owner setup (remaining steps, in this order)

```bash
# 1. Commit and push the second M0 pass (spec, gate, feasibility package, conformance suite)
cd "/Users/alvinkyere870gmail.com/Downloads/Vinkin - v1"
git add .
git commit -m "M0: commit spec, formalize gate, feasibility outreach package, provider conformance suite"
git push -u origin main

# 2. Move to a stable path (close VS Code/editors on this folder first; .git moves with it)
mkdir -p ~/code
mv "/Users/alvinkyere870gmail.com/Downloads/Vinkin - v1" ~/code/vinkin
cd ~/code/vinkin   # reopen your editor here

# 3. Before Milestone 1
npm install -g pnpm
# Flutter SDK: https://docs.flutter.dev/get-started/install/macos
```

No file in this repo embeds an absolute path, so the move is safe.

## Next actions (owner)

1. Send `docs/feasibility/` package to Stripe partnerships + Lithic; file written responses
   in `docs/feasibility/responses/`.
2. Send `counsel-questionnaire.md` to counsel.
3. Open provider sandbox accounts → S1–S12 become executable engineering work.
