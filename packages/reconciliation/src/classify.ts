/**
 * ENG6 Slice 5 — the reviewed classification rules themselves. Pure: takes an already-fetched
 * `CorrelationLookup` snapshot (never queries a database itself), so every rule here is
 * unit-testable with plain object fixtures — no PostgreSQL, no provider SDK, no HTTP.
 *
 * Never mutates anything; never returns an instruction this codebase could execute
 * automatically. `proposedRemediation` is always a description for a human, per ENG6's own
 * hard boundary against automatic reconciliation repairs.
 */

import type { ProviderEvent } from '../../payment-provider/src/index.ts';
import { correlationTargetFor } from './correlation-map.ts';
import type { ClassificationResult, CorrelationLookup } from './types.ts';

/** For a given event type, which VinkIn statuses on the correlated record are consistent with
 * that event having genuinely happened. Explicit and reviewed — not inferred from the state
 * machine's own transition tables, since reconciliation must catch VinkIn's OWN state being
 * wrong, not merely restate it. */
const CONSISTENT_STATUSES: Partial<Record<ProviderEvent['type'], readonly string[]>> = {
  'payment.authorized': [
    'AUTHORIZATION_PENDING',
    'AUTHORIZED',
    'CAPTURE_PENDING',
    'CAPTURED',
    'SETTLED',
  ],
  'payment.captured': ['CAPTURED', 'SETTLED'],
  'payment.canceled': ['CANCELLED'],
  'payment.authorization.expired': ['DECLINED', 'CANCELLED'],
  'payment.declined': ['DECLINED'],
  'refund.completed': ['REFUNDED'],
  'card.authorization.created': ['APPROVED', 'CAPTURED', 'REVERSED'],
};

/** Event types whose payload carries an `amountMinor` worth comparing against the correlated
 * record's own amount — confirmed against both the mock's and Stripe's actual emitted payload
 * shapes (Slice 2/3), not assumed. */
const AMOUNT_BEARING_TYPES = new Set<ProviderEvent['type']>([
  'payment.captured',
  'refund.completed',
  'card.capture.created',
]);

function payloadAmountMinor(event: ProviderEvent): number | undefined {
  const raw = event.payload['amountMinor'];
  return typeof raw === 'number' ? raw : undefined;
}

export function classify(event: ProviderEvent, lookup: CorrelationLookup): ClassificationResult {
  const targetKind = correlationTargetFor(event.type);

  if (targetKind === 'none') {
    return {
      classification: 'UNRECOGNIZED',
      reason: `no VinkIn domain concept correlates to provider event type "${event.type}" — nothing to check this against`,
    };
  }

  if (!lookup.found) {
    // `card.authorization.request` is a real-time pre-decision hook (§17) — it is EXPECTED to
    // precede any VinkIn-recorded purchase_authorization row, not a sign of drift.
    if (event.type === 'card.authorization.request') {
      return {
        classification: 'PENDING',
        reason:
          'authorization request precedes any VinkIn-recorded decision — this is the normal pre-decision order, not drift',
      };
    }
    return {
      classification: 'ORPHANED',
      reason: `no VinkIn ${targetKind} record found for provider object "${event.objectId}"`,
      proposedRemediation: `operator review: confirm whether a ${targetKind} for provider object "${event.objectId}" should exist in VinkIn`,
    };
  }

  const allowedStatuses = CONSISTENT_STATUSES[event.type];
  if (
    allowedStatuses !== undefined &&
    lookup.entityStatus !== undefined &&
    !allowedStatuses.includes(lookup.entityStatus)
  ) {
    return {
      classification: 'MISMATCHED',
      reason: `provider reports "${event.type}" but VinkIn's ${targetKind} ${lookup.entityId} has status "${lookup.entityStatus}", which is not consistent with that event`,
      proposedRemediation: `operator review: confirm which system holds the correct state for ${targetKind} ${lookup.entityId} before any correction is made`,
    };
  }

  if (AMOUNT_BEARING_TYPES.has(event.type)) {
    const eventAmount = payloadAmountMinor(event);
    if (
      eventAmount !== undefined &&
      lookup.entityAmountMinor !== undefined &&
      eventAmount !== lookup.entityAmountMinor
    ) {
      return {
        classification: 'MISMATCHED',
        reason: `provider reports amountMinor ${eventAmount} for "${event.type}" but VinkIn's ${targetKind} ${lookup.entityId} records ${lookup.entityAmountMinor}`,
        proposedRemediation: `operator review: reconcile the amount discrepancy on ${targetKind} ${lookup.entityId} — do not adjust automatically`,
      };
    }
  }

  return {
    classification: 'EXPECTED',
    reason: `VinkIn's ${targetKind} ${lookup.entityId} is consistent with provider event "${event.type}"`,
  };
}
