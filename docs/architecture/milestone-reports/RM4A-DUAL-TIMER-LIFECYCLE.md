# RM4A — Backend Dual-Timer Lifecycle

**Date:** 2026-07-29
**Scope:** D47's dual-timer model, backend half — the fixed 7-minute Vink lifetime (was 24h),
the deadline recomputed at `openVinkCommand` rather than left anchored at DRAFT creation,
consistent deadline enforcement across join/contribute (not just a sweep-driven state check),
the 10-minute card usage window's own sweep trigger (`CARD_WINDOW_EXPIRED`, real and tested
since RM1 but never fired by anything until now), and a generic refund auto-chain closing two
gaps at once. Checkpointed independently of RM4B (frontend countdown ticking, not started) per
the owner's own instruction to keep these separately reviewable, the same split precedent as
RM3A/RM3B.

## Audit first, plan approved before code

A full audit of the pre-RM4A timer/deadline code (not assumptions) found five distinct items,
more precise than the plan's original high-level bullet: two independent copies of the open
duration default that could silently diverge (`env.ts`'s Zod default and
`commands.ts`'s `DEFAULT_OPEN_DURATION_SECONDS` — `packages/application` can't depend on
`apps/api`); the submission deadline set once at DRAFT creation and never touched again, so
every second spent in the create wizard burned directly into the window; genuinely inconsistent
deadline enforcement — `guest.ts`'s `isJoinable` already checked `now < submissionDeadline`
before letting a guest join, but member-add and contribute checked only `vink.state === 'OPEN'`,
trusting the sweep to have already flipped state (negligible against a 24h window, a real gap
against 7 minutes); the 10-minute card-window sweep 100% unbuilt (zero reads of
`usage_window_expires_at`, zero callers of `CARD_WINDOW_EXPIRED` anywhere outside the state
machine's own definition/tests); and a refund auto-chain gap bigger than just the new path —
nothing ever called `refundFailedSessionCommand` automatically on reaching `EXPIRED` via
`FUNDING_REVERSAL_COMPLETED`, not for the new card-window path and not even for the
*pre-existing* card-provisioning-failure path (RM3B), which already chained the state
transitions but never the refund.

## What was built

- **Single timer default, no duplicated-literal drift.** `VINK_OPEN_DURATION_SECONDS`'s
  default changed to `420` in both `apps/api/src/config/env.ts` and
  `packages/application/src/commands.ts`'s `DEFAULT_OPEN_DURATION_SECONDS` (now exported). A
  new guard test in `env.test.ts` imports both and asserts equality — fails loudly if the two
  ever diverge again rather than relying on remembering to update both by hand.
  `VINK_PROCESSING_GRACE_SECONDS` (60s) is **left unchanged** — D47 names the 7-minute figure
  for the submission window specifically; grace is a separate, already-tuned buffer, a
  deliberate non-change.
- **`computeVinkDeadlines(now, timers, explicitSubmissionDeadline?)`** — a new shared helper in
  `commands.ts`, extracted from logic previously duplicated between `createVinkCommand` and
  `configureVinkCommand`. Both now call it unchanged in effect.
- **`openVinkCommand` recomputes both deadlines unconditionally at open time** — calls the same
  helper with no explicit deadline, overwriting whatever was set at DRAFT creation (default or
  explicit). D47's beta model has no organizer-configurable Vink duration; open-time is simply
  authoritative. `configureVinkCommand`'s own DRAFT-only recompute stays as an
  organizer-facing "restart the clock while still setting up" affordance, unchanged in
  behavior, now sharing the same helper.
- **Consistent deadline enforcement.** `addParticipantCommand` and
  `authorizeContributionCommand` both gained the same `now >= submissionDeadline` check
  `guest.ts`'s `isJoinable` already had (only enforced when `vink.state === 'OPEN'`, so DRAFT
  is unaffected) — all three entry points now fail closed on the deadline itself, not just on
  state, independent of whether the sweep has already run.
- **`expireCardWindowCommand`** (`packages/application/src/purchases.ts`, new) — the sweep
  trigger for RM1's own `CARD_READY --CARD_WINDOW_EXPIRED--> FUNDING_REVERSAL` transition.
  Chains the identical two-step `CARD_WINDOW_EXPIRED → FUNDING_REVERSAL_COMPLETED` pattern
  `provisionCardFromPoolCommand`'s own failure branch already uses, then tears the card down
  back to the pool via the identical best-effort `disableCardCommand` →
  `revokeWalletTokenCommand` → `returnCardToPoolCommand` sequence `settlePurchaseCommand`
  already uses — the card was never spent, so it must become reusable, not permanently
  stranded assigned.
- **Two new sweep clauses** (`apps/api/src/jobs/sweeps.ts`): one queries `CARD_READY` vinks
  with an `ACTIVE` assignment whose `usage_window_expires_at` has passed, calling
  `expireCardWindowCommand`; the other queries every `EXPIRED` vink with a remaining `CAPTURED`
  contribution and calls the pre-existing `refundFailedSessionCommand` (already idempotent — a
  no-op on a vink with nothing left to refund). Deliberately generic, not scoped to the new
  card-window path: an `EXPIRED` vink reached via RM3A's own `REFUNDS_PENDING →
  REFUNDS_COMPLETED` path never has a remaining `CAPTURED` row by construction, so this clause
  only ever fires for the `FUNDING_REVERSAL` exit — both the new card-window-expiry path this
  slice adds **and** the pre-existing card-provisioning-failure path (RM3B), fixed as a direct,
  disclosed side effect rather than a separate change.

## A genuine, disclosed correction to the plan's own claim

The approved plan's design text said `authorizeContributionCommand`'s deadline check reuses
`INVALID_COMMAND`, "confirmed no more specific error code exists for this elsewhere." That
specific claim was wrong — `VINK_NOT_JOINABLE` does exist and is exactly the code
`sharing/routes.ts`'s guest-join path maps to HTTP 410 for the identical situation. Decided to
keep `INVALID_COMMAND` anyway: `VINK_NOT_JOINABLE` is currently mapped only in
`sharing/routes.ts`'s own `mapError`; the participants/contributions route modules don't have
that mapping yet, and adding it would mean auditing/updating two more route-level error-mapping
functions — scope creep beyond what this slice needs. `INVALID_COMMAND` also matches the
adjacent state-check in the same function, which already uses it. Flagged here rather than
silently ignored, since the plan's own premise for the choice was inaccurate even though the
choice itself still stands.

## A second real interaction, found only by running the real tests

The refund auto-chain's own design — firing inside the **same sweep tick** that reverses a
card-provisioning failure to `EXPIRED` — collides with `recovery.integration.test.ts`'s existing
E8 test, which was written for the pre-RM4A world where a manual `/refund-failed-session` call
was the only way a refund ever happened. Once the auto-chain fires automatically, mid-tick,
using whatever chaos-hook state is left over from the card-provisioning failure itself, the
test's own later manual failure injection landed on an already-resolved vink and asserted
`0 !== 1`. Root-caused by tracing the mock provider's shared `transientFailures` counter through
the actual call chain: `enableCardCommand`'s failed call consumes one use; the compensating
cleanup's own `disableCardCommand` call (real, not conditional — the card was never truly
enabled, so this is not a same-status idempotent no-op) consumes a second use, silently
swallowed by `provisionCardFromPoolCommand`'s own `catch`; only a *third* queued failure reaches
the auto-chained refund attempt. Confirmed empirically (2 queued failures → 0
`REFUND_FAILED`, both silently absorbed upstream of the refund; 3 queued failures → exactly the
intended 1 `REFUND_FAILED` + 1 already-`REFUNDED`) before fixing the test, not guessed. The test
now queues three failures with an explicit comment naming what each is for, and asserts the
auto-chain's own already-completed refund before proceeding to the manual retry it was written
to exercise.

## Existing tests broken by the deadline-recompute-at-open change, and how each was fixed

`openVinkCommand` now discarding whatever explicit `submissionDeadline` a DRAFT was created
with broke every existing test fixture that relied on a short, explicit creation-time deadline
surviving to the opened row to make sweep-timing scenarios fast without a real multi-minute
wait:

- `packages/application/src/commands.test.ts`'s "defaults to 24h" test — rewritten to assert
  against the real, imported `DEFAULT_OPEN_DURATION_SECONDS` rather than a hardcoded literal
  (the exact "can't recur a third time" fix the plan called for).
- `packages/application/src/contributions.test.ts` and `guest-projections.test.ts` — each had a
  test computing `AFTER_DEADLINE`/`AFTER_GRACE` against the old 24h-scale timing; both fixed by
  capturing both `closeSubmissionsCommand` and `resolveGraceCommand` outcomes and asserting
  `EXPIRED` from either one (the new, much-shorter default correctly resolves in one call now,
  making the second a legitimate `NOT_DUE` no-op). A third test in `contributions.test.ts`
  needed a timestamp strictly inside the new, narrower grace window — fixed with a new
  `WITHIN_GRACE` constant computed relative to the real `DEFAULT_OPEN_DURATION_SECONDS`.
- `apps/api/src/vinks.integration.test.ts`'s HTTP round-trip deadline test — same fix, now
  imports and asserts against the real default.
- `apps/api/src/contributions.integration.test.ts`'s `createOpenVink` helper and
  `apps/api/src/rm3a-failure-cases.integration.test.ts`'s `createOpenVinkWithMembers` helper —
  both accept a `deadlineMs` option specifically to make sweep-timing tests fast; both now
  directly patch `submission_deadline`/`processing_grace_deadline` on the opened row via test
  SQL immediately after opening, simulating "time compression" the same way the rest of this
  codebase already directly manipulates rows for states the command layer wouldn't naturally
  produce (ENG9's backdated-JWT tests, RM3A's own proxy-based rollback tests). One test in the
  RM3A failure-cases file (`#4`, the expiry-races-the-final-contribution scenario) had been
  written defensively enough — branching on whichever outcome actually happened — that it
  passed vacuously even with the regression (the sweep simply never won the race against a
  7-minute window in 1.3s), silently losing its own intended coverage; the `deadlineMs` fix
  restores the real race, not just green output.
- `recovery.integration.test.ts`'s E8 test — see the dedicated section above.

## Tests

New `apps/api/src/rm4a-dual-timer-lifecycle.integration.test.ts` (4 tests, real PostgreSQL):
- **Deadline recomputed at open, not anchored at creation**: a DRAFT created with an explicit
  2-second deadline, left to sit past it, opens successfully and the opened row's deadline is
  the real ~7-minute-from-open value — provably not the stale DRAFT-time value.
- **Join and contribute fail closed on the deadline itself**: a vink's `submission_deadline` is
  patched directly to the past with **no sweep ever run**, and both a member-add and a
  contribute are rejected while the vink row is still genuinely `OPEN` in the database —
  proving the new checks work independently of sweep timing, not merely alongside it.
- **Card-window sweep**: a `CARD_READY` vink's card-assignment usage window is patched into the
  past; one sweep tick reaches `EXPIRED` via `FUNDING_REVERSAL`, the card genuinely returns to
  `AVAILABLE` in the pool (`card_assignments.status = 'RETURNED'`), and its one `CAPTURED`
  contribution is already `REFUNDED` — no manual trigger.
- **Refund auto-chain, the card-provisioning-failure path**: a single queued transient failure
  fails card provisioning; the vink reaches `EXPIRED` and its captured contribution is already
  `REFUNDED` in the same tick — the RM3B-era gap, closed generically, exercised directly (not
  merely as a side effect of the E8 retry test above).

## Verification

- `packages/domain` 48/48, `packages/application` 147/147 — both unchanged counts (RM4A stayed
  entirely inside `commands.ts`/`contributions.ts`/`purchases.ts`/`sweeps.ts`; no domain-level
  state-machine changes were needed — RM1 already modeled `CARD_WINDOW_EXPIRED`).
- `apps/api` non-integration 88/88, integration **288/288** (up from 284 — 4 new RM4A tests).
- `packages/payment-provider-contract-tests` 31/31 against the mock; `packages/reconciliation`
  16/16 — both unaffected, confirming `FinancialProvider` and reconciliation's own correlation
  logic are genuinely untouched by this slice.
- `pnpm typecheck/lint/format:check/guard`: clean, 12/12 packages.

## What did NOT change

`FinancialProvider` interface, the D7 conformance suite, both adapters, `packages/ledger`,
`packages/reconciliation`, RM1/RM2's card-pool commands, RM3A's capture-immediately engine and
its own `REFUNDS_PENDING`/`REFUND_RECOVERY_REQUIRED` states, and RM3B's card-pool cutover and
wallet-token authorization check are all untouched by this slice.

## Disclosed, deliberately unbuilt

Full crash-proof resumability of `provisionCardFromPoolCommand`'s multi-transaction sequence is
still not built (RM3B's own disclosed gap, unchanged); this slice's card-window teardown reuses
the identical best-effort, not-guaranteed cleanup pattern, so the same caveat applies. No
scheduled/periodic re-check exists to catch a card-window-expiry event the sweep briefly missed
beyond the next tick — the existing 10s sweep cadence is the only timeliness guarantee, same as
every other sweep-driven transition in this codebase.

## Next

RM4B — real ticking countdowns in `apps/mobile` (Dart) and `apps/guest-web` (React), including
seconds-level display below one minute (owner-approved via `AskUserQuestion` during planning) —
a disclosed, minimal engineering placeholder pending real product/copy review, not a UX-track
decision made unilaterally. Starts only on further direction, per the same RM3A/RM3B/RM4A
checkpoint-before-continuing precedent.
