/**
 * ENG6 Slice 5 — reconciliation scaffolding. Types shared between the pure classification
 * rules here and apps/api's DB-backed correlation queries. Deliberately provider-neutral:
 * nothing here names Stripe, the mock, or any other adapter — only VinkIn's own domain
 * concepts (contributions, purchase authorizations, settlements) and the already-normalized
 * `ProviderEvent` shape every adapter emits.
 */

import type { ProviderEvent } from '../../payment-provider/src/index.ts';

/**
 * Explicit, reviewed classification vocabulary (owner-specified, not invented):
 * - EXPECTED: the correlated VinkIn record's current state is consistent with what the
 *   provider reports — a clean match, recorded for audit completeness, no action implied.
 * - PENDING: the event genuinely precedes anything VinkIn could have recorded yet (e.g. a
 *   pre-decision authorization *request*) — not yet actionable, may resolve on its own.
 * - MISMATCHED: a VinkIn record was found, but its state or amount conflicts with what the
 *   provider reports — a real discrepancy for operator review.
 * - ORPHANED: no VinkIn record exists at all for a provider object this event type is
 *   expected to correlate against — provider-side activity with no VinkIn counterpart.
 * - UNRECOGNIZED: this event type has no VinkIn domain concept to correlate against at all
 *   (e.g. `dispute.created` — VinkIn models no disputes today) — a forward-compatible bucket,
 *   not a failure.
 */
export type ReconciliationClassification =
  'EXPECTED' | 'PENDING' | 'MISMATCHED' | 'ORPHANED' | 'UNRECOGNIZED';

/** Which VinkIn table/domain concept a given event type is expected to correlate against.
 * `'none'` means the event type has no VinkIn domain concept at all (always UNRECOGNIZED). */
export type CorrelationTargetKind =
  'contribution' | 'purchase_authorization' | 'settlement' | 'none';

/** The result of the DB-layer correlation lookup, handed to the pure `classify` function —
 * a plain snapshot, not a live query, so classification stays unit-testable without a
 * database. `entityStatus`/`entityAmountMinor` are whatever single status/amount column is
 * most relevant for that target kind (see apps/api's ReconciliationStore for exactly which
 * column each target kind reads). */
export interface CorrelationLookup {
  targetKind: CorrelationTargetKind;
  found: boolean;
  entityId?: string;
  entityStatus?: string;
  entityAmountMinor?: number;
}

export interface ClassificationResult {
  classification: ReconciliationClassification;
  /** Human-readable reason — this IS the audit trail's own explanation, not a log-only
   * message; stored verbatim in `reconciliation_findings.details`. */
  reason: string;
  /** Only ever a description of what an operator should look at — never an instruction this
   * codebase executes automatically (ENG6's own hard boundary: proposed remediation records,
   * not automatic repairs). */
  proposedRemediation?: string;
}

export interface ReconciliationFindingInput {
  event: ProviderEvent;
  correlation: CorrelationLookup;
  result: ClassificationResult;
}
