# 05 — Milestone Sequence & First Milestone Plan

§39 defines M0–M10. This doc adds dependencies, exit criteria, and the concrete plan for the
milestone now in progress (M0). §9's definition of done applies to every milestone: domain
model + migration + API + UI + all four UI states + tests + logging + docs.

## 1. Sequence and dependencies

```text
M0 Provider feasibility ──► M1 Foundation ──► M2 Identity/Accounts ──► M3 Vink domain ──► M5 Contributions ──► M6 Ledger* ──► M7 Card ──► M8 Settlement ──► M9 Risk/Support ──► M10 Beta
                                                     └────────────► M4 Guest checkout (parallel with M5 after M3)
```

*Ordering note (flagged, not silently changed): §39 lists Ledger as M6, but §26/§27 make
ledger postings part of contribution confirmation (M5). Resolution: `packages/ledger-core`
(pure posting rules) and the `ledger_*` tables land **in M5** as the contribution engine's
dependency; M6 is then balance projections, reconciliation, and admin views. No scope moves —
only the table/DDL timing.*

| M | Scope anchor | Hard entry criteria | Exit criteria (beyond §9 DoD) |
|---|---|---|---|
| 0 | §39 M0, `docs/provider-integration/00` | business entity details for sandbox signups | feasibility doc §5 list; go/no-go + chosen stack |
| 1 | monorepo, CI, docker, envs, logging, flags | M0 go | `pnpm turbo test` green in CI; docker-compose up = PG+Redis+api healthcheck; Flutter app boots to placeholder; deploy pipeline to staging |
| 2 | auth, accounts, payment/recovery methods, KYC | provider chosen (KYC vendor rides on it) | §10.1 flow end-to-end on device incl. recovery-method setup; §3.1 states enforced |
| 3 | Vink CRUD, categories→policies, splits, invitations, QR, session timing, realtime | M2 | four-person Vink visible live on two devices; split-version immutability tested (§15) |
| 4 | guest web checkout | M3 (tokens), Apple Pay domain verification | §34 performance targets measured; §40.20 |
| 5 | contribution slots/attempts, idempotency, grace, reconciliation sweep, capture/release + ledger core | M3; sandbox keys | §38 concurrency suite green (two final contributions, expiry-vs-webhook, double-tap); §40.4/5/6 |
| 6 | balance projections, reconciliation runs, admin read views | M5 | daily reconciliation job produces zero-diff on sandbox data; ledger imbalance alert wired (§37) |
| 7 | cardholders, issuance, display, controls, auth decision engine, merchant lock | M5 + program approval (M0 §2A) | §40.7–10; dual-auth race test green (§17, §38) |
| 8 | captures, adjustments, recovery, reimbursements, card closure, merchant refunds | M7 | §40.11–13; restaurant tip E2E both modes (§21) |
| 9 | risk limits, fraud signals, support cases, audit views, dashboards | M8 | §36 limits enforced + §37 alert set live; support can trace any transaction (§40.16) |
| 10 | closed beta | all §40 criteria | §40 checklist signed off; runbooks + incident response docs exercised once |

Parallelization: M4 (guest web) can proceed alongside M5 with a stubbed payment button against
the mock provider. Mobile UI shells for M5/M7 screens (§33) can start once M3's realtime
channel exists. Nothing in M7+ starts before the M0 program-design answer — that answer can
invalidate the card model (see risk R1).

## 2. Milestone 0 — the milestone now in progress

Status of the two M0 workstreams:

**Workstream A — engineering (can run now, partially DONE this pass):**
- [x] Provider-neutral interface frozen (`packages/payment-provider`) — §43 + `parseWebhookEvent` extension.
- [x] `MockFinancialProvider` implementing the full contribution lifecycle with §12 idempotency
      semantics, §11 attempt model, §28 duplicate-webhook simulation; zero-dependency tests
      via `node --test`.
- [ ] Sandbox spike scripts S1–S12 (`docs/provider-integration/00` §4) written against the
      interface — **blocked on sandbox API keys**.
- [ ] Stripe adapter skeleton (compiles, unimplemented methods throw `NOT_SUPPORTED`) — only
      after S-tests define real behavior; do not write speculative adapter code.

**Workstream B — product owner (only you can do these):**
1. Create Stripe sandbox account (and Lithic sandbox — self-serve — for stack B comparison).
2. Contact Stripe partnerships with the §2A program-design question (draft the email from
   `00-provider-feasibility.md` §2A + §3; happy to draft it on request).
3. Engage counsel with feasibility doc §3.
4. `git init` + first commit (owner identity), install pnpm + Flutter SDK.

M0 is **not exit-able** on engineering effort alone; its purpose is exactly the §4.14 "fail
safely" principle applied to the business: find out if the product is permitted before
building it.

## 3. Standing rules for every milestone report (§45)

Each milestone ends with a report in `docs/architecture/milestone-reports/MN.md`: implemented /
files / DB changes / APIs / UI / tests / limitations / security review / next. No milestone is
"done" with backend-only or UI-only work (§9), and no invariant from §4 is ever relaxed to make
a milestone pass — the Spec's rule 15 outranks schedule.
