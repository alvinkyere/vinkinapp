# RM3A — Capture-Immediately Funding Engine

**Date:** 2026-07-29
**Scope:** the highest-risk slice of the Real-Money Beta plan (D47) — changing the contribution
funding engine from authorize-then-capture-on-completion to capture-immediately-per-
contribution, per the owner's own detailed RM3A brief (10 named failure-case tests, an exit
checklist, and a policy refinement on what "refund automatically" means). RM3B (cutting the
FUNDED-Vink flow onto RM1/RM2's card pool) is a separate, independently-checkpointed slice per
the owner's own explicit instruction.

## Design process

A full audit of the real code (not assumptions) preceded any change — see the plan file's own
"Audit findings" section for the complete list, with file:line citations. Two findings shaped
the whole design: (1) the contribution state machine already modeled `CAPTURE_RESULT_UNKNOWN`/
`RESOLVED_CAPTURED` as legal transitions, but grep confirmed neither was ever fired in
application code — RM3A makes them real rather than inventing new states; (2)
`resolveContributionCommand`'s own provider-truth resolver had no branch at all for a
`CAPTURED` provider status — a previously-latent gap RM3A's design makes reachable and had to
close.

**The central design conflict, resolved and disclosed.** The owner's own proposed sequence —
`EXPIRED → REFUNDS_PENDING → REFUNDED` — would make `EXPIRED` a non-terminal state with an
outgoing edge, violating `vink-state-machine.ts`'s own tested invariant ("terminal states are
exactly COMPLETED, CANCELLED, EXPIRED, RESTRICTED and have no exits"). Resolved by mirroring
the codebase's own existing precedent for "an outcome that isn't automatically resolvable needs
a visible non-terminal holding state" (`RECOVERY_REQUIRED`/`RECOVERY_PENDING` for settlement
overage): two new **non-terminal** states, `REFUNDS_PENDING` and `REFUND_RECOVERY_REQUIRED`,
sit before `EXPIRED`, which remains the true terminal. The contribution-level outcome the owner
asked for (tracked per-contribution to `REFUNDED`/`REFUND_FAILED`/manual review, never a blind
"everyone was refunded" claim) is fully preserved — only the state name adjacent to `EXPIRED`
moved to respect the existing invariant.

## What was built

- **Domain**: `vink-state-machine.ts` gains `REFUNDS_PENDING`/`REFUND_RECOVERY_REQUIRED` (+4
  transitions: `FUNDING_FAILED`'s destination changes from `EXPIRED` to `REFUNDS_PENDING`;
  `REFUNDS_COMPLETED`/`REFUND_RECOVERY_NEEDED`/`REFUND_RECOVERY_RESOLVED` are new). `VINK_
  TERMINAL_STATES` is unchanged. `contribution-state-machine.ts` gains one new edge,
  `CAPTURE_INITIATED` (`AUTHORIZED → CAPTURE_PENDING`), deliberately kept **separate** from the
  existing `SESSION_FUNDED` edge — `SESSION_FUNDED` keeps its original literal meaning ("the
  whole session funded, capture this") and is used only by the compatibility shim below;
  `CAPTURE_INITIATED` means "this contribution captures on its own, immediately." Two new
  domain events (`VinkRefundsPending`, `VinkRefundRecoveryRequired`); `REFUNDS_COMPLETED`/
  `REFUND_RECOVERY_RESOLVED` both reuse the existing `VinkExpired` event, matching the
  codebase's own precedent (`FUNDING_FAILED` and `FUNDING_REVERSAL_COMPLETED` already share it).
- **Migration `0026`**: `vinks.state` CHECK constraint gains the two new states, following
  migration `0025`'s exact drop/re-add pattern.
- **`packages/application/src/contributions.ts`**, the core rewrite: `captureImmediately`
  (`AUTHORIZED → CAPTURE_PENDING → CAPTURED`, or `RESOLUTION_PENDING` on a retryable ambiguous
  outcome) is called from `authorizeContributionCommand` right after `AUTHORIZATION_APPROVED` —
  same two ledger postings this codebase always inserted at capture time, just moved earlier,
  per contribution. `maybeCloseAndResolve` now checks `CAPTURED` instead of `AUTHORIZED`.
  `resolveFunding`'s "everyone funded" branch is now a pure aggregate read (capture already
  happened); its failure branch refunds every `CAPTURED` contribution (via `refunds.ts`'s newly
  -exported `refundOne`) instead of only cancelling holds, transitioning through
  `REFUNDS_PENDING` first, then to `EXPIRED` or `REFUND_RECOVERY_REQUIRED` depending on whether
  every refund succeeded. A `RESOLUTION_PENDING` contribution encountered in the failure branch
  is no longer blindly cancelled — a new shared helper, `resolveAgainstProviderTruth` (extracted
  from `resolveContributionCommand`'s own logic, now reused by both), checks real provider
  status first, since this status can now originate from a capture-side ambiguity where money
  may genuinely already be captured. A **compatibility shim** (explicit, for "a historical
  authorization-hold contribution encountered after deployment"): a live contribution still
  found `AUTHORIZED` — impossible via the new code path, but possible for pre-deploy data — is
  caught up via the exact original `SESSION_FUNDED`-driven capture logic before the aggregate
  check runs.
- **`refunds.ts`**: `refundOne` exported (was private) — it never had a vink-state precondition
  itself, only its `refundFailedSessionCommand` wrapper does, so the failure branch above reuses
  it directly without touching that wrapper's contract. New `resolveRefundRecoveryCommand`
  (mirrors `closeSubmissionsCommand`'s vink-row-locked shape): a `REFUND_RECOVERY_REQUIRED` vink
  resolves to `EXPIRED` once none of its contributions are still `REFUND_FAILED`/`RESOLUTION_
  PENDING`.
- **`apps/api/src/jobs/sweeps.ts`**: two new clauses — auto-retry every `REFUND_FAILED`
  contribution via the existing (previously never sweep-triggered) `retryRefundCommand`, gated
  by a simple fixed cooldown (disclosed as a deliberate simplification, no exponential backoff);
  and auto-resolve `REFUND_RECOVERY_REQUIRED` vinks via the new command. Also wrapped the
  existing `resolveContributionCommand` sweep call in try/catch (it wasn't, unlike
  `provisionCardCommand` in the same file) — a small defensive hardening, more relevant now that
  this path carries real captured-money resolution.

## What did NOT change (by design, disclosed)

`FinancialProvider` interface, the D7 conformance suite, both adapters, ledger posting shapes,
`packages/reconciliation`, `idempotencyKey`/`operationId` builders, `refundFailedSessionCommand`
/`retryRefundCommand`'s own contracts, RM1/RM2's card pool schema and commands, and
`provisionCardCommand`/`purchases.ts` (the legacy one-shot card flow, which a FUNDED vink still
enters exactly as before) are all untouched. RM3A only reshapes the `PROCESSING_GRACE`-exit
path; the existing `FUNDING_REVERSAL → EXPIRED` edge (post-FUNDED card-provisioning failure,
PV7) keeps its pre-existing, unchanged behavior — a noticed-but-deliberately-deferred adjacent
gap (its own refund isn't auto-chained either) flagged as a candidate for RM3B/RM4, not fixed
here to keep this slice scoped to what the owner actually asked for.

## A real, disclosed finding: retry-after-full-rollback is correctly REFUSED, not silently safe

Case #2's own test (below) surfaced something genuinely important that the plan's original
framing had wrong: when a local transaction rolls back **after** a real provider capture but
**before** the `CREATED` contribution row itself ever persists, a plain client retry generates
a brand-new contribution id — and that id is embedded in the provider call's own `metadata`
(`authorizeContribution`'s `metadata.contributionId`). The `operationId` key string is
identical (`attemptNumber` recomputes to 1 either way), but the underlying parameters differ,
and the provider's own idempotency guard (§12: "same key + different params is a conflict, not
a silent overwrite," already contract-tested) correctly **refuses** to treat this as a safe
replay rather than silently adopting the earlier capture under an unrelated new local identity.
This is the actual, load-bearing safety property: recovering from that specific scenario is
reconciliation's job (proven by case #1, against the exact same captured payment), never a
blind client retry. The *other*, more common half of "a local command retries" — a genuine E5
lost-response where the original row **survives** — already safely replays via the surviving
row's own id, proven by the (updated, still-passing) "lost response (E5)" tests in both
`contributions.test.ts` and `contributions.integration.test.ts`.

## The 10 failure-case tests

New file `apps/api/src/rm3a-failure-cases.integration.test.ts` (7 tests, real PostgreSQL) plus
two already-covered by existing, re-verified tests:

1. **Provider captures, local transaction fails** — a `UnitOfWork` proxy makes `insertLedger
   Posting` throw right after a genuine provider capture succeeds; the whole transaction rolls
   back (zero local rows survive); the provider's own event log + `retrievePaymentStatus` prove
   the money really was captured; a synthetic webhook event classifies as **ORPHANED**
   (corrected from the plan's original guess of MISMATCHED — no local row survives to
   "disagree" with, matching the existing "no VinkIn record at all" test's own precedent).
2. **Local command retries after a successful provider capture** — see the finding above; both
   halves proven (refused when identity is lost, safely replays when it survives).
3. **Two final contributions race to complete the Vink** — already fully proven, unchanged, by
   the existing `contributions.integration.test.ts`'s `ENG9 #14` test, which already exercises
   this exact immediate-capture code path (nothing in it depended on the old hold model).
4. **Vink expiry races with the final contribution** — a genuine `Promise.all` race between the
   final `authorize` call and a real deadline sweep for the vink's own row lock; asserts the
   correct invariant holds under EITHER race outcome (FUNDED with both captured, or EXPIRED
   with the earlier one REFUNDED) — never a lost or double capture.
5. **Refund creation succeeds, local refund recording fails** — same proxy technique as #1,
   applied inside `refundOne`'s own transaction; the local row stays stale at `CAPTURED` while
   the provider genuinely shows `REFUNDED`; classifies as **MISMATCHED** (a real local row
   exists here, just stale — the correct, distinct classification from case #1's ORPHANED).
6. **One refund succeeds while another fails** — 3 participants, 2 captured + 1 declined so the
   vink can never fast-path to FUNDED; a transient failure hits one of the two refund attempts;
   the vink lands **`REFUND_RECOVERY_REQUIRED`**, not `EXPIRED`; the sweep's own new auto-retry
   (simulated a cooldown period later, not a real wait) resolves it to `EXPIRED` without
   operator intervention.
7. **Fully funded Vink has no available pool card** — explicitly out of RM3A's scope (RM1/RM2's
   card pool isn't wired into this flow yet); deferred to RM3B, not tested here.
8. **Card reservation succeeds, next provider operation fails** — also out of scope; already
   covered by RM2's own `callProviderOrQuarantine` tests, to be re-verified once wired in RM3B.
9. **Duplicate provider webhooks arrive out of order** — genuinely out-of-order delivery (two
   real events, occurred_at reversed relative to insertion order) against a contribution
   produced by the real capture-immediately path, both classify **EXPECTED**; a true *duplicate*
   delivery (same `provider_event_id` twice) is impossible to even construct against the real
   schema — a `webhook_events.(provider, provider_event_id)` UNIQUE constraint enforces the
   dedupe at the DB level, already proven separately by `webhooks.integration.test.ts`'s own
   "REPLAY PROTECTION" test.
10. **A historical AUTHORIZED contribution encountered after deployment** — a contribution row
    inserted directly via SQL at `AUTHORIZED` (bypassing the new code path entirely, simulating
    genuine pre-deploy data), then a deadline sweep; the compatibility shim correctly captures
    it inline and funds the vink.

## Tests

- `packages/domain`: **48/48**, unchanged (exhaustiveness tests updated for the 5 new
  states/events, not weakened).
- `packages/application`: **147/147**, unchanged count — 4 existing tests rewritten (not
  deleted) to assert the new immediate-capture sequence instead of the old hold-then-batch one.
- `apps/api`: **280/280** (up from 273 — 7 new RM3A failure-case tests); 3 existing integration
  tests rewritten for the same reason as above (the "funded journey," "decline + deadline," and
  "lost response" tests in `contributions.integration.test.ts`).
- `packages/payment-provider-contract-tests`: unchanged, **31/31** against the mock, **14/14**
  passing (16 disclosed skips) against the real Stripe sandbox — re-verified this session to
  confirm RM3A's changed *calling pattern* still holds against the *unchanged* interface.

## Verification

- `pnpm typecheck`/`lint`/`format:check`/`guard`: clean, 12/12 packages.
- Every touched/new test file re-run against real infrastructure (real local PostgreSQL, real
  Redis where relevant) — not just typechecked.
- The full repo-wide `apps/api` (280/280), `packages/application` (147/147), and
  `packages/domain` (48/48) suites re-run in full (not just touched files) to confirm zero
  regression elsewhere.

## Owner's exit criteria, checked explicitly

- Newly created contributions use immediate capture — **yes** (`captureImmediately`, proven by
  the rewritten "funded journey" test showing `CAPTURED` on the very first authorization).
- A captured contribution is posted exactly once — **yes** (case #2's idempotency-conflict
  proof; the E5 replay tests; ENG9 #14's concurrent-race proof).
- Unfunded expiry initiates real refunds exactly once — **yes** (the rewritten "decline +
  deadline" test; case #4).
- Refund failures are visible and recoverable — **yes** (`REFUND_FAILED`, sweep auto-retry,
  `REFUND_RECOVERY_REQUIRED`, case #6).
- The final-funding race produces one transition — **yes** (ENG9 #14, case #4; both prove
  exactly one `VinkFunded` outbox event and no lost/double capture).
- A fully funded Vink uses `cards`/`card_assignments`, not the legacy one-shot path; no card
  becomes available after an ambiguous outcome; the final-funding race produces one card
  reservation; card reservation succeeds but the next provider operation fails — **not RM3A's
  scope**, explicitly deferred to RM3B per the owner's own instruction to split RM3 into two
  independently-checkpointed slices; RM1/RM2 already proved the card-pool half of this
  (`callProviderOrQuarantine`, the reassignment security property), unaffected by RM3A.
- Real Stripe sandbox proves capture and refund behavior — **yes**, re-verified this session
  (14/14 passing, unchanged interface).
- Real PostgreSQL proves the final-payment/expiry concurrency race — **yes** (ENG9 #14, case
  #4, both against real PostgreSQL with genuine `Promise.all` concurrency).
- Reconciliation can identify provider-success/local-failure cases — **yes** (cases #1 and #5,
  correctly distinguished as ORPHANED vs. MISMATCHED depending on whether a local row survives).

## Next

RM3B — cut the FUNDED-Vink flow over to RM1/RM2's card pool schema (replacing
`provisionCardCommand`'s legacy one-shot path) and wire `authorizeMerchantPurchaseCommand`'s
decision logic to the presented wallet token, per the owner's own instruction to checkpoint
RM3A first and keep the two independently reviewable.
