# Milestone Report — PV7 (Recovery and Refunds)

Date: 2026-07-18 · Track: product validation (D10) · §45 report format.

## What was implemented

- **`packages/ledger`**: three recovery postings (Plan §18) — receivable (platform fronts
  the merchant overage: DR organizer_recovery_receivable / CR platform_cash), charge
  (organizer pays: DR processor_clearing / CR receivable), writeoff (default: DR
  vink_purchase_expense / CR receivable).
- **Migration 0006**: `recovery_obligations` (attempt count, retry ladder support; partial
  UNIQUE — one open obligation per vink).
- **`packages/application` recovery engine** (`recovery.ts`, E7 second half / Spec §23):
  `startRecoveryCommand` — RECOVERY_REQUIRED → obligation created + receivable posted →
  RECOVERY_STARTED → RECOVERY_PENDING → charge the **organizer** off-session (reusing the
  neutral authorize+capture primitive, the mock's `offSessionRecovery` capability) →
  charged: RESOLVED + charge posting → RECOVERY_RESOLVED → COMPLETED; declined: attempt
  count checked against `RECOVERY_MAX_ATTEMPTS` (3) → RETRY_SCHEDULED or DEFAULTED
  (writeoff posting → RECOVERY_DEFAULTED → RESTRICTED). `retryRecoveryCommand` is the
  retry-recovery job body, same ladder. Participants are never touched — proven by test.
- **`packages/application` refund engine** (`refunds.ts`, journeys E2 post-capture / E8):
  `refundFailedSessionCommand` refunds every CAPTURED contribution of an EXPIRED vink
  (REFUND_REQUIRED → provider refund → REFUND_SUCCEEDED + reversal posting, or
  REFUND_FAILED on a retryable provider error — **not swallowed**, an explicit observable
  state). `retryRefundCommand` is the retry-refund job body (E8), idempotent no-op on a
  non-failed contribution.
- **`apps/api`**: simulator-only routes (recovery/start, recovery/retry,
  refund-failed-session, contributions/:id/retry-refund); `recovery` view added to the
  organizer vink snapshot (status, amount, attempt count). Postgres store methods for
  settlements/recovery obligations.
- **Defect found and fixed during integration testing** (same shape as PV3's defect #1):
  `provisionCardCommand`'s failure branch wrote the FUNDING_REVERSAL transitions and then
  **threw inside the unit of work** — PostgreSQL rolled the whole transaction back,
  silently undoing the reversal and leaving the vink FUNDED forever. The in-memory test
  double doesn't roll back on throw, so 35 unit tests passed while this was broken; the
  real-PostgreSQL integration suite caught it on the first run. Fixed by returning a
  discriminated outcome from the transaction and raising the `ApplicationError` only after
  it commits (`packages/application/src/purchases.ts`).

## Files changed

New: `packages/application/src/{recovery,refunds}.ts` + their `.test.ts`,
`apps/api/src/modules/recovery/routes.ts`, `apps/api/src/db/migrations/0006_recovery.sql`,
`apps/api/src/recovery.integration.test.ts`, this report. Modified: ledger
`postings.ts`/test, application `ports/index/queries/testing/in-memory/purchases`, domain
`entities.ts` (`RecoveryObligation.attemptCount`), api `store/app`, docs statuses.

## Database changes

Migration 0006 (above). Recovery/refund postings extend the same append-only/balanced
ledger triggers from PV5/PV6 — no new enforcement needed.

## APIs added

Simulator (allowlisted envs): `POST /internal/simulator/vinks/:vinkId/recovery/start`,
`.../recovery/retry`, `.../refund-failed-session`, `POST
/internal/simulator/vinks/:vinkId/contributions/:contributionId/retry-refund`. Plus
`recovery` on the `GET /api/v1/vinks/:vinkId` snapshot.

## UI added

None (PV9–PV11 render these states).

## Tests added

22 new (2 ledger + 8 application + 4 integration + fixtures; totals: **173 unit + 40
integration**, all green vs real local PostgreSQL 16):
- Ledger: recovery posting shapes + balance.
- Application: E7 resolved-on-first-charge with balanced ledger and participants
  untouched; declined charges retry through the full ladder to DEFAULTED → RESTRICTED with
  the writeoff posted; a declined-then-successful retry resolves; recovery rejected outside
  RECOVERY_REQUIRED. Refunds: every captured contribution refunded with the ledger netting
  every account to zero; **E8** — a transient provider failure yields REFUND_FAILED
  (observable, not swallowed) and retry-refund resolves it; retry on an already-refunded
  contribution is a no-op.
- Integration (**PV7 exit gate — "every failed or adjusted financial path reaches an
  explicit, observable state"**): E7 full HTTP journey to COMPLETED with the snapshot
  showing `recovery.status = RESOLVED`; decline-ladder to RESTRICTED; **E8 caught the
  reversal-rollback defect above and confirmed the fix** — REFUND_FAILED → retry →
  REFUNDED with the ledger balanced throughout.

## Known limitations

1. Recovery due-date/backoff scheduling (§23's 1d/3d/7d cadence) is represented as a single
   `dueAt` field; the actual backoff timer job is PV-track infrastructure work, not built
   here — `retryRecoveryCommand` is the job body, ready for a scheduler to call it.
2. `RESTRICTED` retains only what the state machine encodes; the fuller FinancialAccount
   §3.1 allowed-actions-while-restricted behavior (join/contribute/refunds still permitted)
   is production-track scope, not modeled in the PV entities.
3. The organizer recovery charge reuses contribution-shaped provider calls (authorize +
   capture with `usage: 'RECOVERY'`); a real adapter's off-session recovery flow may differ
   — flagged for the provider-adapter design review.
4. No UI or notification for "you owe a recovery charge" — PV9 surface.

## Security review

- Participants are never recharged for a settlement overage — enforced by the design (only
  the organizer's payment method is touched) and proven by test (contribution statuses
  checked after every recovery test).
- Recovery and refund routes are simulator-only (allowlist-gated); production wiring is job
  bodies only.
- The PV3-shaped defect this milestone found and fixed is a standing lesson: **any
  command that writes a "failure" transition and then throws must be audited** for the same
  rollback bug. Recorded here and in the code comment as a pattern to check for in future
  commands.
- Every transition remains one row-locked unit of work with its outbox event (D12); ledger
  triggers are the final guard, unchanged from PV5.

## Next milestone

**PV8 — Real-Time Experience**: WebSocket channels (`vink:{vinkId}`), snapshot
reconciliation on reconnect, funding-progress/participant/timer live updates driven off the
outbox (finally consuming the `outbox_events.published_at` column that has sat unused since
PV3). This is also the natural point to revisit the "provider calls inside the DB
transaction" flag from D10, since a real outbox publisher changes that calculus. Owner
actions unchanged: push (CI), Docker Desktop for local Redis/WebSocket paths.
