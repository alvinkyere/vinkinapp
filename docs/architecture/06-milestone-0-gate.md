# 06 — Milestone 0 Gate

**This document is the authority on when M0 closes.** It supersedes the informal exit list in
`docs/provider-integration/00-provider-feasibility.md` §5 (which now points here). "Wait for
Stripe" is not a gate; these ten conditions are. Each requires linked written evidence — a
condition without an evidence link is not met, regardless of verbal assurances.

## Gate conditions

M0 may close only when **all ten** hold:

| # | Condition | Evidence required | Owner | Status |
|---|---|---|---|---|
| 1 | At least one provider confirms the proposed funds flow is supportable | Written provider response filed in `docs/feasibility/responses/` | PO | ☐ OPEN |
| 2 | Cardholder and account ownership are defined | Provider response naming accountholder, cardholder, and authorized-user structure | PO | ☐ OPEN |
| 3 | Collection → issuing funding → merchant settlement is documented end-to-end | `docs/feasibility/funds-flow.md` updated with the chosen stack's real accounts + measured timings (S1) | ENG | ☐ OPEN |
| 4 | Organizer recovery charging is permitted | Provider written confirmation + S10 sandbox pass | PO+ENG | ☐ OPEN |
| 5 | Required identity-verification responsibilities are known | Provider program requirements doc (who KYCs whom, at what threshold) | PO | ☐ OPEN |
| 6 | Dispute and negative-balance responsibility is known | Provider written answer + counsel note | PO+LEGAL | ☐ OPEN |
| 7 | Sandbox S1–S12 tests pass for the chosen provider | Results table in `docs/feasibility/sandbox-test-plan.md`, scripts in repo | ENG | ☐ OPEN |
| 8 | Counsel has reviewed the proposed funds flow | Counsel memo (or engagement letter + questions sent, with a dated response) | PO | ☐ OPEN |
| 9 | The selected provider adapter design is approved | Adapter design note reviewed against the conformance suite; decision-log entry | ENG+PO | ☐ OPEN |
| 10 | Remaining risks have accepted owners | Risk register R1–R4 re-scored, each with a named owner and accepted status | PO | ☐ OPEN |

Update statuses in place (☐ OPEN → ☑ MET + evidence link + date). When all ten are ☑, write
the M0 milestone report and open Milestone 1.

## While the gate is open

**Permitted** (provider-neutral, no funds-flow assumptions baked in):

- Repository, CI, formatting/linting configuration
- Architecture decision records (`docs/spec/decision-log.md`)
- Threat-model documentation
- Domain types that do not encode provider behavior (`shared-types`-style work)
- Test fixtures and sandbox harness design
- Mock-provider scenario expansion
- Contract tests every adapter must pass (`packages/payment-provider-contract-tests`)

**Forbidden** (would build production architecture on an unconfirmed funds flow):

- Real contribution capture flows
- Stripe-specific schemas or webhook tables
- Card-display UI
- Organizer onboarding tied to Stripe Connect (or any provider's program object model)
- Production ledger migrations
- Treating `StripeFinancialProvider` as production architecture in any form

The dividing line: anything whose shape would change if condition 1 or 2 came back "no" is
forbidden until those conditions are met.
