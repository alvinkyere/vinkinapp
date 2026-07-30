/**
 * Vink session state machine — Plan §8, implemented verbatim as a transition table.
 * These state names are the CANONICAL vocabulary for the whole system (D11 as amended:
 * the alternate doc-03 vocabulary is retired; documentation adapts to this code).
 *
 * D12: a transition and its domain event are inseparable — every table entry names the
 * event it emits, and `transitionVink` returns `{ to, emits }`. A silent transition is
 * unrepresentable. Persistence layers must commit the state write and the outbox insert
 * for `emits` in one PostgreSQL transaction (Plan §11/§12); that wiring is PV3+ — this
 * module is the pure decision core.
 *
 * The FUNDED/EXPIRED decision out of PROCESSING_GRACE is made by exactly one resolver code
 * path, exactly once (D5) — callers of FUNDING_CONFIRMED / FUNDING_FAILED must be that
 * resolver.
 *
 * The FUNDING_REVERSAL → EXPIRED edge is a G13 interpretation, ratified by the owner
 * 2026-07-17 (D11 amendment).
 *
 * RM3A (D47): unfunded expiry may need to refund already-captured money (capture-immediately
 * funding engine), not merely cancel holds. REFUNDS_PENDING / REFUND_RECOVERY_REQUIRED sit
 * between PROCESSING_GRACE and EXPIRED — mirroring the existing RECOVERY_REQUIRED /
 * RECOVERY_PENDING precedent for "an outcome that isn't automatically resolvable needs a
 * visible non-terminal holding state" — because EXPIRED is a tested terminal state with no
 * exits; it cannot itself gain an outgoing REFUNDS_PENDING edge. See
 * `packages/application/src/contributions.ts`'s `resolveFunding` failure branch.
 */

import { IllegalTransitionError } from './errors.ts';
import type { DomainEventName } from './domain-events.ts';

export type VinkState =
  | 'DRAFT'
  | 'OPEN'
  | 'SUBMISSIONS_CLOSED'
  | 'PROCESSING_GRACE'
  | 'FUNDED'
  | 'REFUNDS_PENDING' // RM3A (D47): unfunded expiry, refunding already-captured contributions
  | 'REFUND_RECOVERY_REQUIRED' // RM3A (D47): a refund failed or a contribution's provider truth is unknown
  | 'EXPIRED'
  | 'CARD_PROVISIONING'
  | 'CARD_READY'
  | 'FUNDING_REVERSAL'
  | 'PURCHASE_AUTHORIZED'
  | 'SETTLING'
  | 'COMPLETED'
  | 'RECOVERY_REQUIRED'
  | 'RECOVERY_PENDING'
  | 'CANCELLED'
  | 'RESTRICTED';

export type VinkEvent =
  | 'VINK_OPENED' // organizer opens the draft
  | 'ORGANIZER_CANCELLED'
  | 'SUBMISSION_DEADLINE_REACHED'
  | 'ALL_CONTRIBUTIONS_AUTHORIZED'
  | 'PROCESSING_GRACE_STARTED'
  | 'FUNDING_CONFIRMED' // session resolver only (D5)
  | 'FUNDING_FAILED' // session resolver only (D5)
  | 'REFUNDS_COMPLETED' // RM3A (D47): every captured contribution refunded, or none needed it
  | 'REFUND_RECOVERY_NEEDED' // RM3A (D47): a refund failed, or a contribution's status is still unknown
  | 'REFUND_RECOVERY_RESOLVED' // RM3A (D47): sweep-confirmed every outstanding contribution resolved
  | 'CARD_PROVISIONING_STARTED'
  | 'CARD_ISSUED'
  | 'CARD_PROVISIONING_FAILED'
  | 'CARD_WINDOW_EXPIRED' // RM1 (D47): the 10-minute card usage window elapsed unused
  | 'FUNDING_REVERSAL_COMPLETED' // G13 edge, ratified (D11 amendment)
  | 'MERCHANT_AUTHORIZATION_APPROVED'
  | 'PURCHASE_CAPTURED'
  | 'AUTHORIZATION_REVERSED'
  | 'SETTLEMENT_MATCHED'
  | 'SETTLEMENT_OVERAGE_DETECTED'
  | 'RECOVERY_STARTED'
  | 'RECOVERY_RESOLVED'
  | 'RECOVERY_DEFAULTED';

export interface VinkTransition {
  to: VinkState;
  /** Domain event emitted atomically with this transition (D12). */
  emits: DomainEventName;
}

export const VINK_TERMINAL_STATES: readonly VinkState[] = [
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'RESTRICTED',
];

const TRANSITIONS: Readonly<Record<VinkState, Partial<Record<VinkEvent, VinkTransition>>>> = {
  DRAFT: {
    VINK_OPENED: { to: 'OPEN', emits: 'VinkOpened' },
  },
  OPEN: {
    ORGANIZER_CANCELLED: { to: 'CANCELLED', emits: 'VinkCancelled' },
    SUBMISSION_DEADLINE_REACHED: { to: 'SUBMISSIONS_CLOSED', emits: 'SubmissionsClosed' },
    ALL_CONTRIBUTIONS_AUTHORIZED: { to: 'SUBMISSIONS_CLOSED', emits: 'SubmissionsClosed' },
  },
  SUBMISSIONS_CLOSED: {
    PROCESSING_GRACE_STARTED: { to: 'PROCESSING_GRACE', emits: 'ProcessingGraceStarted' },
  },
  PROCESSING_GRACE: {
    FUNDING_CONFIRMED: { to: 'FUNDED', emits: 'VinkFunded' },
    // RM3A (D47): destination changed from EXPIRED to REFUNDS_PENDING — capture-immediately
    // means some contributions may already hold real captured money that must be refunded,
    // not merely cancelled, before this vink can reach its true terminal state.
    FUNDING_FAILED: { to: 'REFUNDS_PENDING', emits: 'VinkRefundsPending' },
  },
  REFUNDS_PENDING: {
    REFUNDS_COMPLETED: { to: 'EXPIRED', emits: 'VinkExpired' },
    REFUND_RECOVERY_NEEDED: {
      to: 'REFUND_RECOVERY_REQUIRED',
      emits: 'VinkRefundRecoveryRequired',
    },
  },
  REFUND_RECOVERY_REQUIRED: {
    REFUND_RECOVERY_RESOLVED: { to: 'EXPIRED', emits: 'VinkExpired' },
  },
  FUNDED: {
    // Owner's illustrative "CardProvisioningStarted" — realized as the Plan §12 catalog
    // name TemporaryCardRequested (flagged in D12).
    CARD_PROVISIONING_STARTED: { to: 'CARD_PROVISIONING', emits: 'TemporaryCardRequested' },
  },
  CARD_PROVISIONING: {
    CARD_ISSUED: { to: 'CARD_READY', emits: 'TemporaryCardIssued' },
    CARD_PROVISIONING_FAILED: { to: 'FUNDING_REVERSAL', emits: 'TemporaryCardFailed' },
  },
  CARD_READY: {
    MERCHANT_AUTHORIZATION_APPROVED: {
      to: 'PURCHASE_AUTHORIZED',
      emits: 'MerchantAuthorizationApproved',
    },
    // RM1 (D47): the organizer's 10-minute card usage window elapsed with no purchase made —
    // same exit shape as CARD_PROVISIONING_FAILED (wind down via FUNDING_REVERSAL, refund
    // every already-captured contribution). The sweep that actually fires this is RM4's job;
    // this slice only makes the transition itself real and tested.
    CARD_WINDOW_EXPIRED: { to: 'FUNDING_REVERSAL', emits: 'CardWindowExpired' },
  },
  FUNDING_REVERSAL: {
    FUNDING_REVERSAL_COMPLETED: { to: 'EXPIRED', emits: 'VinkExpired' },
  },
  PURCHASE_AUTHORIZED: {
    PURCHASE_CAPTURED: { to: 'SETTLING', emits: 'PurchaseCaptured' },
    AUTHORIZATION_REVERSED: { to: 'CARD_READY', emits: 'MerchantAuthorizationReversed' },
  },
  SETTLING: {
    SETTLEMENT_MATCHED: { to: 'COMPLETED', emits: 'VinkCompleted' },
    SETTLEMENT_OVERAGE_DETECTED: {
      to: 'RECOVERY_REQUIRED',
      emits: 'SettlementVarianceDetected',
    },
  },
  RECOVERY_REQUIRED: {
    RECOVERY_STARTED: { to: 'RECOVERY_PENDING', emits: 'RecoveryObligationCreated' },
  },
  RECOVERY_PENDING: {
    RECOVERY_RESOLVED: { to: 'COMPLETED', emits: 'VinkCompleted' },
    RECOVERY_DEFAULTED: { to: 'RESTRICTED', emits: 'OrganizerRestricted' },
  },
  COMPLETED: {},
  CANCELLED: {},
  EXPIRED: {},
  RESTRICTED: {},
};

export function isVinkTerminal(state: VinkState): boolean {
  return VINK_TERMINAL_STATES.includes(state);
}

export function canTransitionVink(from: VinkState, event: VinkEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/**
 * Returns the transition (next state + the event it emits) or throws
 * IllegalTransitionError — illegal transitions are errors, never no-ops.
 */
export function transitionVink(from: VinkState, event: VinkEvent): VinkTransition {
  const transition = TRANSITIONS[from][event];
  if (transition === undefined) throw new IllegalTransitionError('Vink', from, event);
  return transition;
}

/** All legal (from, event, to, emits) tuples — used by exhaustive tests and docs generation. */
export function vinkTransitionTable(): ReadonlyArray<{
  from: VinkState;
  event: VinkEvent;
  to: VinkState;
  emits: DomainEventName;
}> {
  return (Object.keys(TRANSITIONS) as VinkState[]).flatMap((from) =>
    (Object.entries(TRANSITIONS[from]) as [VinkEvent, VinkTransition][]).map(
      ([event, transition]) => ({ from, event, to: transition.to, emits: transition.emits }),
    ),
  );
}
