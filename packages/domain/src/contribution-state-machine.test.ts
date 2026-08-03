import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionContribution,
  canTransitionContribution,
  isContributionTerminal,
  contributionTransitionTable,
  CONTRIBUTION_TERMINAL_STATUSES,
  type ContributionEvent,
  type ContributionStatus,
} from './contribution-state-machine.ts';
import { IllegalTransitionError } from './errors.ts';

const ALL_STATUSES: ContributionStatus[] = [
  'CREATED',
  'AUTHORIZATION_PENDING',
  'AUTHORIZED',
  'DECLINED',
  'RESOLUTION_PENDING',
  'CAPTURE_PENDING',
  'CANCELLATION_PENDING',
  'CANCELLED',
  'CAPTURED',
  'SETTLED',
  'REFUND_PENDING',
  'REFUNDED',
  'REFUND_FAILED',
];

const ALL_EVENTS: ContributionEvent[] = [
  'AUTHORIZATION_STARTED',
  'AUTHORIZATION_APPROVED',
  'AUTHORIZATION_DECLINED',
  'PROVIDER_RESULT_UNKNOWN',
  'AUTHORIZATION_TIMED_OUT',
  'SESSION_FUNDED',
  'CAPTURE_INITIATED',
  'PARTICIPANT_EXITED',
  'SESSION_EXPIRED',
  'CAPTURE_SUCCEEDED',
  'CAPTURE_RESULT_UNKNOWN',
  'CANCELLATION_SUCCEEDED',
  'CANCELLATION_RESULT_UNKNOWN',
  'RESOLVED_AUTHORIZED',
  'RESOLVED_DECLINED',
  'RESOLVED_CAPTURED',
  'RESOLVED_CANCELLED',
  'PURCHASE_SETTLED',
  'REFUND_REQUIRED',
  'REFUND_SUCCEEDED',
  'REFUND_FAILED',
  'REFUND_RETRIED',
];

describe('Contribution state machine (Plan §9)', () => {
  it('accepts every legal transition, each emitting its event (D12)', () => {
    const expected: Array<[ContributionStatus, ContributionEvent, ContributionStatus, string]> = [
      [
        'CREATED',
        'AUTHORIZATION_STARTED',
        'AUTHORIZATION_PENDING',
        'ContributionAuthorizationStarted',
      ],
      ['AUTHORIZATION_PENDING', 'AUTHORIZATION_APPROVED', 'AUTHORIZED', 'ContributionAuthorized'],
      ['AUTHORIZATION_PENDING', 'AUTHORIZATION_DECLINED', 'DECLINED', 'ContributionDeclined'],
      [
        'AUTHORIZATION_PENDING',
        'PROVIDER_RESULT_UNKNOWN',
        'RESOLUTION_PENDING',
        'ContributionResolutionRequired',
      ],
      [
        'AUTHORIZATION_PENDING',
        'AUTHORIZATION_TIMED_OUT',
        'RESOLUTION_PENDING',
        'ContributionResolutionRequired',
      ],
      ['AUTHORIZED', 'SESSION_FUNDED', 'CAPTURE_PENDING', 'ContributionCaptureStarted'],
      ['AUTHORIZED', 'CAPTURE_INITIATED', 'CAPTURE_PENDING', 'ContributionCaptureInitiated'],
      [
        'AUTHORIZED',
        'PARTICIPANT_EXITED',
        'CANCELLATION_PENDING',
        'ContributionCancellationStarted',
      ],
      ['AUTHORIZED', 'SESSION_EXPIRED', 'CANCELLATION_PENDING', 'ContributionCancellationStarted'],
      ['CAPTURE_PENDING', 'CAPTURE_SUCCEEDED', 'CAPTURED', 'ContributionCaptured'],
      [
        'CAPTURE_PENDING',
        'CAPTURE_RESULT_UNKNOWN',
        'RESOLUTION_PENDING',
        'ContributionResolutionRequired',
      ],
      ['CANCELLATION_PENDING', 'CANCELLATION_SUCCEEDED', 'CANCELLED', 'ContributionCancelled'],
      [
        'CANCELLATION_PENDING',
        'CANCELLATION_RESULT_UNKNOWN',
        'RESOLUTION_PENDING',
        'ContributionResolutionRequired',
      ],
      ['RESOLUTION_PENDING', 'RESOLVED_AUTHORIZED', 'AUTHORIZED', 'ContributionAuthorized'],
      ['RESOLUTION_PENDING', 'RESOLVED_DECLINED', 'DECLINED', 'ContributionDeclined'],
      ['RESOLUTION_PENDING', 'RESOLVED_CAPTURED', 'CAPTURED', 'ContributionCaptured'],
      ['RESOLUTION_PENDING', 'RESOLVED_CANCELLED', 'CANCELLED', 'ContributionCancelled'],
      ['CAPTURED', 'PURCHASE_SETTLED', 'SETTLED', 'ContributionSettled'],
      ['CAPTURED', 'REFUND_REQUIRED', 'REFUND_PENDING', 'RefundRequested'],
      ['REFUND_PENDING', 'REFUND_SUCCEEDED', 'REFUNDED', 'RefundCompleted'],
      ['REFUND_PENDING', 'REFUND_FAILED', 'REFUND_FAILED', 'RefundFailed'],
      ['REFUND_FAILED', 'REFUND_RETRIED', 'REFUND_PENDING', 'RefundRequested'],
    ];
    for (const [from, event, to, emits] of expected) {
      const transition = transitionContribution(from, event);
      assert.equal(transition.to, to, `${from} --${event}--> ${to}`);
      assert.equal(transition.emits, emits, `${from} --${event}--> must emit ${emits}`);
    }
    assert.equal(contributionTransitionTable().length, expected.length);
  });

  it('D12: no transition is silent — every table entry names its emitted event', () => {
    for (const { from, event, emits } of contributionTransitionTable()) {
      assert.equal(typeof emits, 'string', `${from} --${event}--> must emit an event`);
      assert.ok(emits.length > 0);
    }
  });

  it('rejects every status × event pair not in the table with IllegalTransitionError', () => {
    let rejected = 0;
    for (const from of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        if (canTransitionContribution(from, event)) continue;
        assert.throws(
          () => transitionContribution(from, event),
          (error: unknown) =>
            error instanceof IllegalTransitionError &&
            error.aggregate === 'Contribution' &&
            error.from === from &&
            error.event === event,
          `${from} --${event}--> must throw`,
        );
        rejected += 1;
      }
    }
    assert.equal(
      rejected,
      ALL_STATUSES.length * ALL_EVENTS.length - contributionTransitionTable().length,
    );
  });

  it('terminal statuses are DECLINED, CANCELLED, SETTLED, REFUNDED with no exits', () => {
    assert.deepEqual([...CONTRIBUTION_TERMINAL_STATUSES].sort(), [
      'CANCELLED',
      'DECLINED',
      'REFUNDED',
      'SETTLED',
    ]);
    for (const status of CONTRIBUTION_TERMINAL_STATUSES) {
      assert.equal(isContributionTerminal(status), true);
      for (const event of ALL_EVENTS) {
        assert.equal(canTransitionContribution(status, event), false);
      }
    }
  });

  it('a lost response is recoverable via RESOLUTION_PENDING without creating a second contribution path (journey E5)', () => {
    // Lost response → RESOLUTION_PENDING; the resolver later learns the authorization
    // actually succeeded and moves the SAME contribution to AUTHORIZED.
    const afterLoss = transitionContribution('AUTHORIZATION_PENDING', 'PROVIDER_RESULT_UNKNOWN');
    assert.equal(afterLoss.to, 'RESOLUTION_PENDING');
    assert.equal(transitionContribution(afterLoss.to, 'RESOLVED_AUTHORIZED').to, 'AUTHORIZED');
  });

  it('a failed refund can be retried until it succeeds (journey E8)', () => {
    let status = transitionContribution('REFUND_PENDING', 'REFUND_FAILED').to;
    assert.equal(status, 'REFUND_FAILED');
    status = transitionContribution(status, 'REFUND_RETRIED').to;
    assert.equal(status, 'REFUND_PENDING');
    status = transitionContribution(status, 'REFUND_SUCCEEDED').to;
    assert.equal(status, 'REFUNDED');
  });

  it('every status can reach a terminal status', () => {
    const table = contributionTransitionTable();
    const reachesTerminal = new Set<ContributionStatus>(CONTRIBUTION_TERMINAL_STATUSES);
    let grew = true;
    while (grew) {
      grew = false;
      for (const { from, to } of table) {
        if (reachesTerminal.has(to) && !reachesTerminal.has(from)) {
          reachesTerminal.add(from);
          grew = true;
        }
      }
    }
    for (const status of ALL_STATUSES) {
      assert.equal(reachesTerminal.has(status), true, `${status} must reach a terminal status`);
    }
  });
});
