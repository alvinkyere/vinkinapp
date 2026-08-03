/**
 * Contribution state machine — Plan §9, implemented verbatim as a transition table.
 * Canonical vocabulary per D11 (as amended).
 *
 * D12: every table entry names the domain event it emits; `transitionContribution` returns
 * `{ to, emits }` — a silent transition is unrepresentable.
 *
 * The G13 interpretation edges were ratified by the owner 2026-07-17 (D11 amendment):
 *  1. CANCELLATION_PENDING → CANCELLED (success) | RESOLUTION_PENDING (result unknown).
 *  2. RESOLUTION_PENDING → AUTHORIZED | DECLINED | CAPTURED | CANCELLED via the
 *     resolve-pending-contribution job (Plan §10) once the provider's true outcome is known.
 *  3. REFUND_FAILED → REFUND_PENDING via the retry-refund job (Plan §10, journey E8).
 *
 * DECLINED is terminal for THIS contribution: a retry is a NEW contribution with the next
 * attempt number in its idempotency key (Plan §11 `authorize:{attemptNumber}`, Spec §12).
 *
 * RM3A (D47): CAPTURE_INITIATED is a second edge into CAPTURE_PENDING, deliberately kept
 * separate from SESSION_FUNDED. SESSION_FUNDED keeps its original, literal meaning ("the whole
 * session just funded, capture this now") and is used only by `resolveFunding`'s compatibility
 * shim for a contribution that predates the capture-immediately engine. CAPTURE_INITIATED means
 * "this contribution captures on its own, immediately, because it personally authorized" — the
 * new common path. Keeping the two distinct keeps the audit trail (and any future analytics)
 * able to tell them apart.
 */

import { IllegalTransitionError } from './errors.ts';
import type { DomainEventName } from './domain-events.ts';

export type ContributionStatus =
  | 'CREATED'
  | 'AUTHORIZATION_PENDING'
  | 'AUTHORIZED'
  | 'DECLINED'
  | 'RESOLUTION_PENDING'
  | 'CAPTURE_PENDING'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'CAPTURED'
  | 'SETTLED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REFUND_FAILED';

export type ContributionEvent =
  | 'AUTHORIZATION_STARTED'
  | 'AUTHORIZATION_APPROVED'
  | 'AUTHORIZATION_DECLINED'
  | 'PROVIDER_RESULT_UNKNOWN'
  | 'AUTHORIZATION_TIMED_OUT'
  | 'SESSION_FUNDED' // capture begins because the vink funded (legacy/compat path — RM3A)
  | 'CAPTURE_INITIATED' // RM3A (D47): capture begins immediately, on this contribution's own authorization
  | 'PARTICIPANT_EXITED'
  | 'SESSION_EXPIRED'
  | 'CAPTURE_SUCCEEDED'
  | 'CAPTURE_RESULT_UNKNOWN'
  | 'CANCELLATION_SUCCEEDED'
  | 'CANCELLATION_RESULT_UNKNOWN'
  | 'RESOLVED_AUTHORIZED' // resolve-pending-contribution job outcomes
  | 'RESOLVED_DECLINED'
  | 'RESOLVED_CAPTURED'
  | 'RESOLVED_CANCELLED'
  | 'PURCHASE_SETTLED'
  | 'REFUND_REQUIRED'
  | 'REFUND_SUCCEEDED'
  | 'REFUND_FAILED'
  | 'REFUND_RETRIED'; // retry-refund job

export interface ContributionTransition {
  to: ContributionStatus;
  /** Domain event emitted atomically with this transition (D12). */
  emits: DomainEventName;
}

export const CONTRIBUTION_TERMINAL_STATUSES: readonly ContributionStatus[] = [
  'DECLINED',
  'CANCELLED',
  'SETTLED',
  'REFUNDED',
];

const TRANSITIONS: Readonly<
  Record<ContributionStatus, Partial<Record<ContributionEvent, ContributionTransition>>>
> = {
  CREATED: {
    AUTHORIZATION_STARTED: {
      to: 'AUTHORIZATION_PENDING',
      emits: 'ContributionAuthorizationStarted',
    },
  },
  AUTHORIZATION_PENDING: {
    AUTHORIZATION_APPROVED: { to: 'AUTHORIZED', emits: 'ContributionAuthorized' },
    AUTHORIZATION_DECLINED: { to: 'DECLINED', emits: 'ContributionDeclined' },
    PROVIDER_RESULT_UNKNOWN: {
      to: 'RESOLUTION_PENDING',
      emits: 'ContributionResolutionRequired',
    },
    AUTHORIZATION_TIMED_OUT: {
      to: 'RESOLUTION_PENDING',
      emits: 'ContributionResolutionRequired',
    },
  },
  AUTHORIZED: {
    SESSION_FUNDED: { to: 'CAPTURE_PENDING', emits: 'ContributionCaptureStarted' },
    CAPTURE_INITIATED: { to: 'CAPTURE_PENDING', emits: 'ContributionCaptureInitiated' },
    PARTICIPANT_EXITED: {
      to: 'CANCELLATION_PENDING',
      emits: 'ContributionCancellationStarted',
    },
    SESSION_EXPIRED: {
      to: 'CANCELLATION_PENDING',
      emits: 'ContributionCancellationStarted',
    },
  },
  CAPTURE_PENDING: {
    CAPTURE_SUCCEEDED: { to: 'CAPTURED', emits: 'ContributionCaptured' },
    CAPTURE_RESULT_UNKNOWN: {
      to: 'RESOLUTION_PENDING',
      emits: 'ContributionResolutionRequired',
    },
  },
  CANCELLATION_PENDING: {
    CANCELLATION_SUCCEEDED: { to: 'CANCELLED', emits: 'ContributionCancelled' },
    CANCELLATION_RESULT_UNKNOWN: {
      to: 'RESOLUTION_PENDING',
      emits: 'ContributionResolutionRequired',
    },
  },
  RESOLUTION_PENDING: {
    RESOLVED_AUTHORIZED: { to: 'AUTHORIZED', emits: 'ContributionAuthorized' },
    RESOLVED_DECLINED: { to: 'DECLINED', emits: 'ContributionDeclined' },
    RESOLVED_CAPTURED: { to: 'CAPTURED', emits: 'ContributionCaptured' },
    RESOLVED_CANCELLED: { to: 'CANCELLED', emits: 'ContributionCancelled' },
  },
  CAPTURED: {
    PURCHASE_SETTLED: { to: 'SETTLED', emits: 'ContributionSettled' },
    REFUND_REQUIRED: { to: 'REFUND_PENDING', emits: 'RefundRequested' },
  },
  REFUND_PENDING: {
    REFUND_SUCCEEDED: { to: 'REFUNDED', emits: 'RefundCompleted' },
    REFUND_FAILED: { to: 'REFUND_FAILED', emits: 'RefundFailed' },
  },
  REFUND_FAILED: {
    REFUND_RETRIED: { to: 'REFUND_PENDING', emits: 'RefundRequested' },
  },
  DECLINED: {},
  CANCELLED: {},
  SETTLED: {},
  REFUNDED: {},
};

export function isContributionTerminal(status: ContributionStatus): boolean {
  return CONTRIBUTION_TERMINAL_STATUSES.includes(status);
}

export function canTransitionContribution(
  from: ContributionStatus,
  event: ContributionEvent,
): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/**
 * Returns the transition (next status + the event it emits) or throws
 * IllegalTransitionError — illegal transitions are errors, never no-ops.
 */
export function transitionContribution(
  from: ContributionStatus,
  event: ContributionEvent,
): ContributionTransition {
  const transition = TRANSITIONS[from][event];
  if (transition === undefined) throw new IllegalTransitionError('Contribution', from, event);
  return transition;
}

/** All legal (from, event, to, emits) tuples — used by exhaustive tests. */
export function contributionTransitionTable(): ReadonlyArray<{
  from: ContributionStatus;
  event: ContributionEvent;
  to: ContributionStatus;
  emits: DomainEventName;
}> {
  return (Object.keys(TRANSITIONS) as ContributionStatus[]).flatMap((from) =>
    (Object.entries(TRANSITIONS[from]) as [ContributionEvent, ContributionTransition][]).map(
      ([event, transition]) => ({ from, event, to: transition.to, emits: transition.emits }),
    ),
  );
}
