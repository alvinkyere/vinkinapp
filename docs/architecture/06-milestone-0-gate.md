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

## Sandbox-only exception (D46, 2026-07-26) — narrow, does not close the gate

The gate still governs all ten conditions above and everything real-money-shaped below.
**One narrow, explicitly bounded exception** is carved out of the Forbidden list, per owner
direction and recorded in `docs/spec/decision-log.md` D46: a **sandbox-only** provider
integration (initially Stripe) is permitted for technical validation and demonstration —
proving VinkIn's architecture maps onto a real provider's actual API shape, not proving the
business relationship, compliance posture, or funds-flow approval that M0's ten conditions
still require.

**Permitted under this exception, and only this:**

- Sandbox/test-mode API credentials only — never live-mode keys, in any environment
  (development, staging, test, or the demo environment) — hard-enforced in code, not just by
  convention (a boot-time check refusing to start if a key matching Stripe's live-mode prefix
  is ever configured, mirroring this codebase's existing fail-fast config discipline)
- Simulated/sandbox balances, cards, and transactions only — Stripe's own sandbox network,
  never real card-network movement or real consumer funds
- A webhook endpoint and signing secret isolated from any future live-mode endpoint —
  different route, different secret, never shared configuration
- Feature-flagged, same off-by-default/boot-refused-outside-development-test discipline as
  every other provider-dependent flag already in this codebase (`VINKIN_EMAIL_VERIFICATION_
  ENABLED` et al.) — live-mode execution must be structurally impossible while this flag
  drives sandbox-only behavior, not merely discouraged

**This exception does NOT:**

- Authorize real-money movement, live card issuance, or consumer fund custody
- Satisfy gate conditions 1–10 above — a working sandbox demo is not a provider's written
  funds-flow confirmation, not counsel review, not a KYC program, not a commercial agreement
- Authorize a public launch or any production traffic
- Change the dividing line below for anything outside sandbox-mode work specifically

## Real-Money Beta architecture exception (D47, 2026-07-28) — narrow, does not close the gate

The gate still governs all ten conditions above. A second, equally narrow exception — carved
out alongside D46's, not replacing it — permits building the **full intended shape** of the
Real-Money Beta architecture the owner approved and recorded in `docs/spec/decision-log.md`
D47 (VinkIn-as-cardholder funds flow, the reusable card pool, the dual-timer Vink/card
lifecycle, wallet-only card exposure), **against the sandbox provider only**, under the exact
same hard guards D46 already established (sandbox/test-mode credentials only in every
environment, a live-mode key fails to boot, feature-flagged and off-by-default outside
development/test).

This is what specifically permits, in sandbox mode only:

- **Card-display UI** — narrowed, not removed wholesale, from the Forbidden list below: the
  wallet-provisioning-only experience D47 specifies (no "View Card Details" screen exists in
  that design at all) may be built and demoed against sandbox-issued cards
- The reusable-card-pool schema, dual-timer lifecycle, and wallet-token provisioning/
  revocation flows D47 describes, built against `MockFinancialProvider`/the sandbox
  `StripeFinancialProvider` exactly as ENG6's existing sandbox work already does

**This exception does NOT:**

- Do anything D46's own "does NOT" list already says it doesn't (real-money movement, live
  card issuance, consumer fund custody, public launch, gate conditions 1–10)
- Authorize VinkIn's own real Stripe Financial Account to be provisioned or used — that is a
  real Stripe account action outside sandbox scope entirely, gated on the owner performing it,
  not a code decision
- Authorize real Apple/Google Wallet push-provisioning credentials to be requested or used —
  wallet UX may be built and demoed with whatever the sandbox/test tooling for each platform
  allows; the same external-credential dependency that kept Sign in with Apple/Google
  server-only (ENG5) and Android App Links unfinished (ENG4 Slice 10) applies here too

## While the gate is open

**Permitted** (provider-neutral, no funds-flow assumptions baked in):

- Repository, CI, formatting/linting configuration
- Architecture decision records (`docs/spec/decision-log.md`)
- Threat-model documentation
- Domain types that do not encode provider behavior (`shared-types`-style work)
- Test fixtures and sandbox harness design
- Mock-provider scenario expansion
- Contract tests every adapter must pass (`packages/payment-provider-contract-tests`)
- **Sandbox-only** provider adapter code, webhook tables, and demos under the D46 exception
  above — schemas/tables isolated from any future live-mode equivalent, sandbox credentials
  only
- **Sandbox-only** Real-Money Beta architecture under the D47 exception above — card pool,
  dual-timer lifecycle, wallet-token provisioning/revocation, and wallet-only card-display UI,
  built and demoed against the sandbox provider only

**Forbidden** (would build production architecture on an unconfirmed funds flow):

- Real contribution capture flows (i.e., against live-mode provider credentials or real funds)
- **Live-mode** Stripe schemas, webhook tables, or credentials of any kind
- Card-display UI **outside the D47 sandbox exception above** (i.e., against anything other
  than sandbox-issued cards)
- Real Apple/Google Wallet push-provisioning credentials (sandbox/test tooling for each
  platform is permitted under D47; the real merchant identifier/entitlement is not)
- Organizer onboarding tied to Stripe Connect (or any provider's program object model)
- Production ledger migrations
- Treating `StripeFinancialProvider` as production architecture in any form — a sandbox-mode
  adapter passing the contract suite is a technical proof, not a production-readiness one
- VinkIn's own real (non-sandbox) Stripe Financial Account being provisioned or used

The dividing line: anything whose shape would change if condition 1 or 2 came back "no" is
forbidden until those conditions are met — this now includes anything that would change if
either the D46 or D47 sandbox exception were narrowed or revoked.
