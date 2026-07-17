# VinkIn — Questions for Counsel

_Send with `provider-overview.md` and `funds-flow.md`. Engineering frames these; counsel
decides. Answers are gate evidence (gate conditions 6 and 8,
`docs/architecture/06-milestone-0-gate.md`)._

## 1. Money transmission (launch-blocking)

VinkIn takes possession — via provider-held accounts — of funds from multiple consumers and
directs them to a merchant through a platform-issued card.

- Under the provider structures we're evaluating (platform balance / FBO account at a partner
  bank), is VinkIn a money transmitter under state MTL regimes? Which exemptions
  (agent-of-payee, payment processor, bank-agency) plausibly apply, and in which states?
- What facts in the funds flow would strengthen or destroy those exemptions (e.g., who is
  merchant of record on contribution charges; how long funds are held; refund mechanics)?
- Precedent worth reviewing: group-payment products that restructured or shut down over
  program/banking issues (e.g., Braid, 2023).

## 2. Consumer-protection allocation

- **Regulation E / EFTA**: do participant contributions or the organizer's card use create
  Reg E obligations for VinkIn, and who handles error-resolution claims?
- **Disputes**: participant charges name VinkIn (or the program) as merchant of record — what
  descriptor, receipt, and refund-policy obligations follow? On the issued-card side, who
  disputes a bad merchant transaction: the organizer, VinkIn, or the program bank?
- **Negative balances**: when a merchant settles above the funded amount and the organizer's
  recovery charge fails, who legally bears the loss in the structures under consideration?

## 3. Terms, consent, and disclosures

- Required disclosure format for a participant approving a share **with a maximum exposure**
  above the base amount (restaurant tip case) — what satisfies UDAAP expectations?
- Organizer terms for: card control, accountability for adjustments, consent to off-session
  recovery charges on a saved payment method (and whether that consent survives disputes).
- Guest checkout (no account): what terms/privacy acceptance is required at pay time?

## 4. KYC/AML program scope

- Given full KYC on organizers only: is a written CIP/AML program required of VinkIn itself,
  or is reliance on the provider's program sufficient? Participant thresholds?
- Velocity/structuring monitoring expectations for many small contributions converging on
  single purchases.

## 5. Housekeeping

- **Escheatment**: unclaimed refunds from failed sessions (guest paid, refund undeliverable) —
  state unclaimed-property obligations and required record retention.
- **State registrations** needed for the closed beta (single state vs. multi-state rollout
  sequencing).
- Record-keeping/audit obligations for the append-only ledger to be usable as evidence.
