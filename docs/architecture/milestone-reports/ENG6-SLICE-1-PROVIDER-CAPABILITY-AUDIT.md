# ENG6 Slice 1 — Provider Capability and Gap Audit

**Date:** 2026-07-26
**Scope:** Audit the current `FinancialProvider` abstraction against VinkIn's actual workflow.
Grounded entirely in reading real code (`packages/payment-provider`,
`packages/payment-provider-contract-tests`, every real call site in `packages/application`,
`apps/api`) and the repo's own ratified decisions — not assumptions, not documentation alone.

## Headline finding: ENG6 Slices 3–4 as written conflict with the ratified M0 gate

Before the matrix: **this needs owner attention before any further ENG6 work happens.**

`docs/architecture/06-milestone-0-gate.md` is this repo's own stated authority ("This document
is the authority on when M0 closes"). All ten of its gate conditions are still `☐ OPEN` —
including #1 ("at least one provider confirms the proposed funds flow is supportable") and #7
("sandbox S1–S12 tests pass for the chosen provider"). Its own **Forbidden** list, while the
gate is open, explicitly names:

- "Real contribution capture flows"
- "**Stripe-specific schemas or webhook tables**"
- "Treating `StripeFinancialProvider` as production architecture in any form"

Its own dividing line: *"anything whose shape would change if condition 1 or 2 came back 'no'
is forbidden until those conditions are met."*

ENG6 Slice 3 ("Implement one real provider adapter in sandbox mode... this may be Stripe") and
Slice 4 ("Build a hardened webhook boundary") are close to a direct match for what the gate
document calls out by name as forbidden. This may be exactly what the owner intends — reopening
or superseding the gate with this new brief is a legitimate call — but it is not one this
session should make silently. Per this repo's own binding rule (§9, "spec/product changes are
flagged to the owner, never made silently") and D15's own reasoning (a two-phase provider
design "risks guessing a design the real adapter discards" while the gate is open), **Slices 1
and 2 are unambiguously safe to build now** (the gate's own Permitted list: "contract tests
every adapter must pass," "domain types that do not encode provider behavior," "mock-provider
scenario expansion," "sandbox harness design"). Slices 3 onward need an explicit owner call:
does ENG6 supersede the M0 gate, or do Slices 3+ wait for gate conditions 1 and 7? This report
stops at that question rather than guessing past it.

## Method

Read, not assumed: `packages/payment-provider/src/{provider,types,errors,operation-ids}.ts`,
`mock/mock-financial-provider.ts`, all of `payment-provider-contract-tests/src/contract-suite.ts`
(23 tests), every real (non-test) call site of `ctx.provider.*` across
`packages/application/src/{contributions,purchases,recovery,refunds}.ts`, every webhook-related
file in `apps/api/src` (found: none is a real ingestion route), every migration for a webhook/
inbox table (found: none), and `docs/spec/decision-log.md`'s D3/D6/D7/D15 entries.

## The matrix

| VinkIn capability | Current port/interface | Required provider capability | Supported in sandbox? | Legal/provider dependency | Known gap |
|---|---|---|---|---|---|
| Contribution collection (participant → held funds) | `authorizeContribution`/`captureContribution`/`cancelContributionAuthorization`, manual-capture-only (§11), idempotency keys via `operationId.authorize`/`capture` | Authorize-then-capture on a saved payment method; partial capture (base share ≤ authorized max, §21) | Unverified — depends on chosen provider (gate condition 1) | Gate condition 1 (funds-flow support), condition 2 (cardholder/account structure) | **Real, undecided**: `signInWithOAuth`-adjacent customer/payment-method setup (`createCustomer`/`setupPaymentMethod`) is fully speculative — no real provider's actual onboarding/tokenization flow has ever been exercised against this shape |
| Held/available funds visibility | `retrievePaymentStatus` (returns `authorizedAmount`/`capturedTotal`/`refundedTotal`) | Real-time or near-real-time balance/hold query | Contract-tested against the mock only | Gate condition 3 (documented funds-flow timings) | `retrievePaymentStatus` is called **exactly once** in real code (`contributions.ts:597`, the E5 lost-response-replay path) — never used for proactive reconciliation or balance display anywhere |
| Virtual-card creation | `createCardholder`/`issueTemporaryCard`, `spendLimit` = funded total + headroom (§20/§21) | Cardholder object model + card-issuing API | Contract-tested (mock) | Gate condition 2 (cardholder/account ownership), condition 5 (who KYCs whom) | `verifiedIdentityRef` exists on `CreateCardholderInput` but **nothing populates it** — no KYC flow exists anywhere in this codebase (confirmed: zero references to KYC/identity-verification outside this one optional field and the Spec itself) |
| Card controls (MCC/spend limit) | `updateCardControls` (`allowedMccs`/`blockedMccs`/`spendLimit`), `freezeCard`/`closeCard` | Program-level MCC allow/block support, live limit updates | Contract-tested: MCC blocks + cumulative spend-limit enforcement + freeze/close all verified against the mock | Gate condition 1 | `merchantSpecificControls` is declared `false` on the mock and **exercised by no test and no real code path** — an honest capability with zero verification either way |
| Merchant authorization | **VinkIn's own §17 in-process decision** (first-merchant lock, exposure math) — not a provider webhook | Real-time card-authorization webhook (`card.authorization.request` in the type union) | **Not implemented at all** — the type exists, nothing produces or consumes it | Gate condition 1, 3 | **Largest single gap**: today's "merchant authorization" is entirely simulated via `/internal/simulator/*` (ops console, PV11/PV12). A real provider's actual real-time-authorization webhook contract (sub-second response requirement, specific payload shape) has never been designed against |
| Capture | `captureContribution` (contribution side) exists and is contract-tested; **card-transaction capture** (the merchant's actual settlement) has no provider-facing counterpart at all | `card.capture.created` webhook | Not implemented | Gate condition 1, 3 | Same simulator-only gap as merchant authorization — `packages/domain`'s MATCHED/OVERAGE settlement logic (PV6) has never been driven by a real provider event |
| Reversal | `cancelContributionAuthorization` (contribution side, contract-tested: cancel-before-capture releases the hold) | Authorization reversal API | Contract-tested (mock) | Gate condition 1 | Card-transaction-level reversal (as opposed to contribution-authorization cancel) has no interface method or real call site at all |
| Refund | `refundContribution`, "never claim completion early" (§25, `REFUND_INITIATED` vs `REFUND_COMPLETED`) | Refund API with async completion | Contract-tested: "refunds up to the captured total and no further" | Gate condition 1 | None beyond the shared provider-selection gate — this is the most completely specified capability in the current interface |
| Webhook processing | `parseWebhookEvent` (signature verification, `ProviderEvent` normalization) exists on the interface and is contract-tested (signature tampering rejected, duplicate `providerEventId` detected, out-of-order `occurredAt` handled) | Real webhook delivery, signature scheme, retry/replay behavior | Contract-tested **only against the mock's own synthetic events** | Gate condition 1, 3, 7 | **Confirmed by direct search — zero webhook ingestion route exists anywhere in `apps/api`, and zero `(provider, provider_event_id)` dedupe table exists in any migration.** The interface method is real; the HTTP boundary and storage `parseWebhookEvent` results are supposed to feed (ENG6 Slice 4's entire scope) don't exist yet. This is the largest infrastructure gap, separate from the M0-gate question above |
| Reconciliation | None | Provider-vs-ledger comparison (ENG6 Slice 5) | N/A | Gate condition 3 | **Zero reconciliation code exists** — confirmed by search. The ledger (`packages/ledger`, D2/D12) is real, append-only, balanced, and DB-trigger-enforced, but nothing today compares it against provider-side truth, because no real provider truth has ever existed to compare against |
| Identity requirements | `verifiedIdentityRef?: string` (optional, unpopulated) on `CreateCardholderInput` | KYC/AML program requirements (who KYCs whom, at what threshold) | N/A | Gate condition 5 (explicitly unmet), condition 6 (dispute/negative-balance responsibility) | Wide open by design — this is explicitly gate-condition territory, not an engineering gap to close unilaterally |
| Transaction limits | `spendLimit` (card-level, computed from funded total) is the only limit concept anywhere in this codebase | Program-level per-transaction/per-day/per-user limits | N/A | Gate condition 1, 4 (recovery charging permission) | No config, no domain concept, no enforcement beyond the single card spend limit exists — confirmed via `env.ts` and domain search |

## Error taxonomy gap (feeds directly into Slice 2)

Current `ProviderErrorCode` (`packages/payment-provider/src/errors.ts`): `IDEMPOTENCY_CONFLICT`,
`INVALID_STATE`, `AMOUNT_EXCEEDS_AUTHORIZATION`, `OBJECT_NOT_FOUND`, `INVALID_SIGNATURE`,
`PROVIDER_UNAVAILABLE` (the only code marked `retryable`), `NOT_SUPPORTED`,
`PERMANENTLY_DECLINED`.

Against ENG6 Slice 2's requested taxonomy (declined; retryable outage; invalid request;
insufficient funds; compliance blocked; duplicate; unknown outcome):

| ENG6-requested category | Maps to today | Gap |
|---|---|---|
| declined | `PERMANENTLY_DECLINED` | Covered |
| retryable outage | `PROVIDER_UNAVAILABLE` | Covered |
| duplicate | `IDEMPOTENCY_CONFLICT` | Covered (though named for the §12 violation shape, not "duplicate" generically) |
| invalid request | *(none)* | **Gap** — malformed input today surfaces as a thrown validation error outside the `ProviderError` taxonomy entirely, not a classified code |
| insufficient funds | *(none — folded into `PERMANENTLY_DECLINED` with a free-text `declineReason`)* | **Gap** — not machine-distinguishable from any other decline reason today |
| compliance blocked | *(none)* | **Gap** — no concept exists; directly downstream of the unmet KYC/AML gate conditions above |
| unknown outcome | *(none)* | **Gap** — an ambiguous/uncertain provider response (network timeout mid-call, no confirmation either way) isn't a distinct code; today's E5 replay logic handles this at the idempotency-key level (retry-same-key-succeeds), not via a classified error the caller can branch on |

## What already meets ENG6's own bar, not just close to it

- **D7's shared conformance suite is real and already does exactly what Slice 2 asks**: 23
  tests spanning idempotency (replay, conflict, transient-failure retry, lost-response replay),
  capture/refund amount guards, capability-honesty (the multiple-capture and MCC-control tests
  specifically prove a declared-false capability fails loudly, never silently emulates), webhook
  signature/dedup/ordering, and card spend-limit/MCC enforcement. Slice 2's "provider error
  classification" work is a real gap (above); its "typed inputs, no leaked provider shapes"
  requirement is **already fully met** — nothing in `packages/application` ever touches a
  provider-SDK type, confirmed by the existing `check-provider-imports.mjs` guard passing
  clean throughout this entire session.
- **Idempotency-key derivation (§12) is centralized and correct** (`operation-ids.ts`), reused
  identically by both the mock and (necessarily) any future real adapter.
- **D15 already gives ENG6 an honest starting point, not a blind spot**: the provider-calls-
  inside-transaction pattern is a named, dated, ratified decision with an explicit revisit
  trigger ("the real provider's own idempotency and webhook semantics" becoming known) — exactly
  the condition ENG6 Slice 3 would newly satisfy, if the M0-gate question above is resolved in
  ENG6's favor.

## Recommendation

1. **Resolve the M0-gate question first** — a short, explicit owner decision (supersede/reopen
   the gate for ENG6, or hold Slices 3+ until conditions 1/7 are met) unblocks everything else
   without guessing.
2. **Slice 2 (adapter contract hardening) can start immediately regardless of that answer** — it
   only touches the provider-neutral interface, matching the gate's own Permitted list.
3. Whichever way the M0 question resolves, **Slice 4's webhook-ingestion infrastructure gap
   (no route, no dedupe table) is real work independent of which provider is eventually
   chosen** — the shape (signature verification, raw-body preservation, `(provider,
   provider_event_id)` dedupe) is already fully specified by `parseWebhookEvent`'s existing
   contract and doesn't require a real provider to build against, only the mock's own synthetic
   events, which the contract suite already exercises. This piece may be safely buildable now
   even if Slice 3 (a real adapter) waits.
