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
Provider abstraction spike:  COMPLETE  (interface + mock, strict typecheck clean)
Provider conformance suite:  COMPLETE  (runs against every future adapter)
Feasibility outreach package:READY TO SEND (docs/feasibility/)
Repository initialization:   DONE      (baseline commit on main; remote: github.com/alvinkyere/vinkinapp)
Repository relocation:       DONE      (~/code/vinkin, per D9)
Real provider feasibility:   BLOCKED   (sandbox accounts + written provider answers)
Legal funds-flow validation: BLOCKED   (counsel questionnaire ready)
Milestone 0 overall:         IN PROGRESS (gate open)

Product-validation track (D10, docs/product-validation/):
PV0 build governance:        COMPLETE  (work classification + provider-import CI guard)
PV1 platform foundation:     COMPLETE  (pnpm+turbo, apps/api, auth, compose, CI w/ PG+Redis)
PV2 domain core:             COMPLETE  (packages/domain; D12 events; canonical states D11)
PV3 organizer API:           COMPLETE pending CI re-run (2 first-CI defects root-caused,
                                        fixed, 24/24 green vs real local PostgreSQL)
Repo-wide:                   109 unit + 24 integration tests green; lint/format/guard green
Next:                        PV4 (on hold until CI green) — guest join + sharing
Owner actions:               git push (re-runs CI → closes PV3); install Docker Desktop
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
│   ├── 05-milestone-sequence.md          # M0–M10 + PV0–PV12 status
│   ├── 06-milestone-0-gate.md            # ★ the M0 closure authority
│   ├── 07-system-context.md              # ★ the one authoritative architecture diagram
│   └── milestone-reports/                # PV0-PV2.md, PV1.md, …
├── feasibility/                          # ★ outreach package — send these
│   ├── provider-overview.md              #   one-pager for provider partnerships teams
│   ├── funds-flow.md                     #   canonical funds-flow (providers + counsel)
│   ├── provider-questionnaire.md         #   21 written-answer questions
│   ├── counsel-questionnaire.md          #   money transmission, Reg E, disputes, KYC, escheat
│   ├── sandbox-test-plan.md              #   S1–S12 with pass criteria + results table
│   └── responses/                        #   file written answers here (gate evidence)
├── provider-integration/
│   └── 00-provider-feasibility.md        # internal analysis: candidate stacks A/B/C
├── product-validation/                   # ★ PV track (D10) — active engineering sequence
│   ├── master-plan.md                    #   owner's PV0–PV12 plan (verbatim, source of truth)
│   ├── 00-governance.md                  #   work classification, flags, envs, CI guard rules
│   └── 01-database-schema-proposal.md    #   PV2 schema, synchronized with packages/domain
└── threat-model/
    └── 00-risk-register.md               # R1–R20, re-scored each milestone

apps/
└── api/                                  # PV1 Fastify API: health, auth, migrations, jobs

packages/
├── domain/                               # PV2 domain core: money, state machines (canonical
│                                         #   vocabulary, D11; transitions emit events, D12)
├── application/                          # PV3 command layer (D13): commands/queries over
│                                         #   ports; single state-write path; in-memory store
├── payment-provider/                     # Spec §43 interface + ProviderCapabilities + Mock
└── payment-provider-contract-tests/      # conformance suite every adapter must pass

docker-compose.yml                        # postgres:16 + redis:7 with healthchecks
tooling/scripts/check-provider-imports.mjs # PV0 guard: no provider SDK outside adapter dirs
.github/workflows/ci.yml                  # guard + zero-dep tests + pnpm workspace job
                                          #   (lint/format/typecheck + PG/Redis integration)
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
pnpm install          # one-time (pnpm 11 via `npm install -g pnpm`)

pnpm dev              # docker compose up + migrate + API on :3000 (needs Docker Desktop)
pnpm test             # all packages via turbo (99 tests)
pnpm typecheck        # strict tsc across all packages
pnpm lint             # eslint (typescript-eslint recommended)
pnpm format:check     # prettier (code only; docs are never reformatted)
pnpm guard            # provider-import guard — no provider SDK outside adapter dirs

pnpm --filter @vinkin/api migrate   # apply SQL migrations
pnpm --filter @vinkin/api seed      # demo users (development/test/demo only)
pnpm --filter @vinkin/api worker    # BullMQ heartbeat worker
```

Zero-dep packages (`packages/*`) still run standalone: `cd packages/domain && npm test`.

## Owner setup (remaining steps, in this order)

```bash
# 1. Commit and push this pass (ratifications, D12/D13, canonical vocabulary, PV1 platform)
cd ~/code/vinkin
git add .
git commit -m "PV1: platform foundation; D11 canonical states; D12 transition events; D13 command model"
git push

# 2. Install Docker Desktop (unblocks `pnpm dev` + local integration tests)
#    https://docs.docker.com/desktop/setup/install/mac-install/

# 3. Later: Flutter SDK (needed from PV9)
#    https://docs.flutter.dev/get-started/install/macos
```

## Next actions (owner)

1. Send `docs/feasibility/` package to Stripe partnerships + Lithic; file written responses
   in `docs/feasibility/responses/`.
2. Send `counsel-questionnaire.md` to counsel.
3. Open provider sandbox accounts → S1–S12 become executable engineering work.
