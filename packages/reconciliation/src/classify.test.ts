/**
 * ENG6 Slice 5 — pure classification rules against provider-neutral fixtures (no PostgreSQL,
 * no provider SDK, no HTTP). Every fixture here is a plain `ProviderEvent` + a plain
 * `CorrelationLookup` — the exact shape any adapter's already-normalized event takes, and the
 * exact shape apps/api's DB-layer correlation query returns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classify.ts';
import type { CorrelationLookup } from './types.ts';
import type { ProviderEvent } from '../../payment-provider/src/index.ts';

function event(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    provider: 'mock',
    providerEventId: 'evt_1',
    type: 'payment.captured',
    occurredAt: '2026-01-01T00:00:00.000Z',
    objectId: 'pay_1',
    payload: {},
    ...overrides,
  };
}

test('UNRECOGNIZED: an event type with no VinkIn domain concept (dispute.created)', () => {
  const result = classify(event({ type: 'dispute.created', objectId: 'dp_1' }), {
    targetKind: 'none',
    found: false,
  });
  assert.equal(result.classification, 'UNRECOGNIZED');
  assert.match(result.reason, /no VinkIn domain concept/);
});

test('PENDING: a real-time authorization request precedes any VinkIn decision', () => {
  const result = classify(event({ type: 'card.authorization.request', objectId: 'auth_1' }), {
    targetKind: 'purchase_authorization',
    found: false,
  });
  assert.equal(result.classification, 'PENDING');
});

test('ORPHANED: no VinkIn record at all for a known event type (MISSING PREDECESSOR)', () => {
  const result = classify(event({ type: 'payment.captured', objectId: 'pay_ghost' }), {
    targetKind: 'contribution',
    found: false,
  });
  assert.equal(result.classification, 'ORPHANED');
  assert.match(result.reason, /pay_ghost/);
  assert.ok(result.proposedRemediation !== undefined, 'a proposed remediation, never an action');
});

test('EXPECTED: a captured event with matching status and amount', () => {
  const lookup: CorrelationLookup = {
    targetKind: 'contribution',
    found: true,
    entityId: 'contrib-1',
    entityStatus: 'CAPTURED',
    entityAmountMinor: 5_000,
  };
  const result = classify(
    event({ type: 'payment.captured', payload: { amountMinor: 5_000 } }),
    lookup,
  );
  assert.equal(result.classification, 'EXPECTED');
});

test('MISMATCHED: a status conflict — provider reports captured but VinkIn is still just authorized', () => {
  const lookup: CorrelationLookup = {
    targetKind: 'contribution',
    found: true,
    entityId: 'contrib-2',
    entityStatus: 'AUTHORIZED',
  };
  const result = classify(event({ type: 'payment.captured' }), lookup);
  assert.equal(result.classification, 'MISMATCHED');
  assert.match(result.reason, /AUTHORIZED/);
});

test('MISMATCHED (LATE CAPTURE): a capture arrives while VinkIn still shows only authorized', () => {
  // The same scenario named explicitly, per ENG6's own required-scenarios list: a capture
  // event whose occurred_at is well after authorization, but VinkIn's own record hasn't
  // caught up — this is exactly the kind of drift reconciliation exists to surface, not to
  // silently treat as eventually-consistent.
  const lookup: CorrelationLookup = {
    targetKind: 'contribution',
    found: true,
    entityId: 'contrib-late',
    entityStatus: 'AUTHORIZED',
  };
  const result = classify(
    event({ type: 'payment.captured', occurredAt: '2026-01-02T00:00:00.000Z' }),
    lookup,
  );
  assert.equal(result.classification, 'MISMATCHED');
});

test('EXPECTED (REVERSAL): a cancellation VinkIn has already correctly recorded', () => {
  const lookup: CorrelationLookup = {
    targetKind: 'contribution',
    found: true,
    entityId: 'contrib-3',
    entityStatus: 'CANCELLED',
  };
  const result = classify(event({ type: 'payment.canceled' }), lookup);
  assert.equal(result.classification, 'EXPECTED');
});

test('MISMATCHED (REVERSAL): a cancellation VinkIn has not yet caught up to', () => {
  const lookup: CorrelationLookup = {
    targetKind: 'contribution',
    found: true,
    entityId: 'contrib-4',
    entityStatus: 'AUTHORIZED',
  };
  const result = classify(event({ type: 'payment.canceled' }), lookup);
  assert.equal(result.classification, 'MISMATCHED');
});

test('EXPECTED (REFUND): a refund whose amount matches VinkIn exactly', () => {
  const lookup: CorrelationLookup = {
    targetKind: 'contribution',
    found: true,
    entityId: 'contrib-5',
    entityStatus: 'REFUNDED',
    entityAmountMinor: 2_500,
  };
  const result = classify(
    event({ type: 'refund.completed', payload: { amountMinor: 2_500 } }),
    lookup,
  );
  assert.equal(result.classification, 'EXPECTED');
});

test('MISMATCHED (REFUND): a refund amount that disagrees with VinkIn', () => {
  const lookup: CorrelationLookup = {
    targetKind: 'contribution',
    found: true,
    entityId: 'contrib-6',
    entityStatus: 'REFUNDED',
    entityAmountMinor: 2_500,
  };
  const result = classify(
    event({ type: 'refund.completed', payload: { amountMinor: 1_000 } }),
    lookup,
  );
  assert.equal(result.classification, 'MISMATCHED');
  assert.match(result.reason, /1000|2500/);
});

test('EXPECTED (SETTLEMENT / two-hop target): a matching card capture', () => {
  const lookup: CorrelationLookup = {
    targetKind: 'settlement',
    found: true,
    entityId: 'settlement-1',
    entityStatus: 'MATCHED',
    entityAmountMinor: 8_000,
  };
  const result = classify(
    event({ type: 'card.capture.created', payload: { amountMinor: 8_000 } }),
    lookup,
  );
  assert.equal(result.classification, 'EXPECTED');
});

test('never returns an executable instruction — proposedRemediation is always operator-facing prose', () => {
  const lookup: CorrelationLookup = { targetKind: 'contribution', found: false };
  const result = classify(event({ type: 'payment.captured' }), lookup);
  assert.equal(typeof result.proposedRemediation, 'string');
  assert.match(result.proposedRemediation!, /operator review/i);
});
