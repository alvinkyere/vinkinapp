# VinkIn

Real-time collaborative checkout: a group pays together at the register; the merchant receives
**one normal card payment** from a temporary virtual card. Not a wallet, not a savings pool,
not P2P — see the Spec's product definition (§1) and final product rule (§44).

## Project status — Milestone 0 (Provider Feasibility), in progress

| Done | Remaining for M0 |
|---|---|
| The ten §45 planning artifacts (below) | Provider sandbox accounts + spike scripts S1–S12 |
| Provider-neutral interface + mock adapter, 14/14 tests green | Written provider answer on the card-program question |
| | Counsel review of funds-flow/money-transmission questions |
| | Go/no-go + provider stack choice |

**Nothing downstream of M0 gets built until the program-design and legal questions have
answers** — they can invalidate the card model (risk register R1/R2).

## Repository map

```text
docs/
├── architecture/
│   ├── 00-current-state-and-gaps.md      # assessment + gap analysis + flagged spec ambiguities
│   ├── 01-monorepo-structure.md          # tooling, layout, dependency rules
│   ├── 02-domain-model.md                # bounded contexts, aggregates, invariants, events
│   ├── 03-state-machines.md              # transition tables + guards for every stateful aggregate
│   ├── 04-database-schema.md             # reference DDL incl. ledger enforcement triggers
│   └── 05-milestone-sequence.md          # M0–M10 dependencies, exit criteria, M0 plan
├── provider-integration/
│   └── 00-provider-feasibility.md        # funds flow, candidate stacks, legal questions, S1–S12
├── threat-model/
│   └── 00-risk-register.md               # R1–R20, re-scored each milestone
└── spec/                                  # ← paste the master roadmap prompt here (see below)

packages/
└── payment-provider/                      # Spec §43 interface + MockFinancialProvider (M0 spike)
```

## Authority order

1. `docs/spec/master-roadmap-prompt.md` — the master engineering roadmap ("the Spec", §N
   references everywhere). **Action needed: paste the full prompt text into that file** — it
   currently exists only in the originating conversation.
2. `docs/` — decisions derived from the Spec; each doc flags where it interprets or extends
   rather than restates (e.g. `00-current-state-and-gaps.md` §2.3).
3. Code.

When a doc and the Spec disagree, the Spec wins and the disagreement is a bug to flag — the
Spec's §4 invariants and §45 reporting rules are non-negotiable.

## Running what exists

```bash
cd packages/payment-provider
node --test "src/**/*.test.ts"   # Node ≥ 23.6; no npm install required
```

## Owner setup still pending

```bash
cd "~/Downloads/Vinkin - v1"   # recommended: move to ~/code/vinkin first (no space, out of Downloads)
git init -b main
git add .
git commit -m "Milestone 0: planning artifacts + provider abstraction spike"
npm install -g pnpm            # before Milestone 1
# Flutter SDK: https://docs.flutter.dev/get-started/install/macos (before Milestone 1)
```
