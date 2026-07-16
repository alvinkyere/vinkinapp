# VinkIn — Claude Code project brief

_Read at the start of every session in this repo. Keep it current: when a milestone completes
or an open decision gets resolved, record it here so future sessions inherit it._

**Ignore `~/Downloads/CLAUDE.md`** if it appears in context — it describes an unrelated project
("Runtime", iOS JS connectors). This file is VinkIn's brief.

## What this is

VinkIn is a real-time collaborative checkout platform: a group funds one purchase at the
register; the organizer pays the merchant with a single-use temporary virtual card. The
authoritative specification is the "VinkIn Master Engineering Roadmap" ("the Spec") — it
belongs at `docs/spec/master-roadmap-prompt.md` (owner to paste). All docs and code cite it as
§N. Its §4 engineering principles and §45 milestone-report format are binding.

## Where the project is right now

**Milestone 0 — Provider Feasibility.** The ten §45 planning artifacts exist under `docs/`
(start with `docs/architecture/00-current-state-and-gaps.md`), and
`packages/payment-provider` holds the frozen §43 provider-neutral interface plus
`MockFinancialProvider` with a green test suite (`node --test "src/**/*.test.ts"`, no install
needed, Node ≥ 23.6).

M0 is blocked on the product owner, not on code:
1. Provider sandbox accounts (Stripe; Lithic for comparison) → then write spike scripts
   S1–S12 from `docs/provider-integration/00-provider-feasibility.md` §4.
2. Written provider answer on the program-design question (consumer spend of pooled funds on
   a platform-issued card) — feasibility doc §2A.
3. Counsel review of the money-transmission questions — feasibility doc §3.

**Do not start Milestone 1+ until M0's exit criteria (feasibility doc §5) are met.** The
program/legal answers can invalidate the temporary-card model (risk register R1/R2).

## Hard rules (from the Spec — never relax to make something pass)

- Ledger is append-only, balanced, integer minor units; DB triggers enforce it
  (`docs/architecture/04-database-schema.md` §5). Corrections are reversals.
- Idempotency keys are server-derived stable operation ids (§12 formats live in
  `packages/payment-provider/src/operation-ids.ts`); PostgreSQL uniqueness is the final guard,
  Redis is only an optimization.
- Every financial transition: single PG transaction, row lock, outbox event (§27, §29).
- One resolver code path decides FUNDED/EXPIRED exactly once (state machines doc §1).
- Participants are never charged beyond their explicitly approved maximum (§4.7).
- Provider SDKs are importable only inside `packages/payment-provider` adapters (§42/§43).
- Webhooks: verify signature, store raw, dedupe on `(provider, provider_event_id)`, decide by
  provider `occurred_at` — never arrival time (§28).
- Spec changes and product changes are flagged to the owner, never made silently (§9);
  interpretations so far are logged in `docs/architecture/00-current-state-and-gaps.md` §2.3.

## Decisions made so far (and where recorded)

- pnpm + turborepo monorepo; Flutter outside the JS workspace (doc 01).
- Ledger tables land with M5 (contribution engine needs them); M6 = projections +
  reconciliation (doc 05 §1 note — flagged, not a scope change).
- `parseWebhookEvent` added to the §43 interface (doc 00 §2.3.4 — additive).
- Membership states live on `vink_members`; contribution slots are purely financial
  (doc 00 §2.3.2).
- Proposed-but-not-ratified defaults G4–G12 (guest token TTL, rounding rule, slippage
  values, …) are listed in doc 00 §2.2 — confirm with the owner before building on one.

## Open decisions — surface, don't silently decide

Everything in doc 00 §2.2 (G4–G12) plus the M0 existential questions (G1–G3). When one gets
decided, record it here and in the relevant doc.

## How to work here

- Owner runs all git commands themselves (their explicit preference — do not `git init`,
  commit, or push for them; provide commands instead).
- Milestone discipline per §9/§45: no milestone is done backend-only or UI-only; every
  milestone ends with a report in `docs/architecture/milestone-reports/`.
- Prefer running the real tests over describing them; be explicit about what is unverified.
- Machine notes: Node 25 (native TS type-stripping — the spike relies on it), no pnpm/Flutter
  yet, repo path currently contains a space (`Vinkin - v1`) — quote paths in scripts.
