import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionVink,
  canTransitionVink,
  isVinkTerminal,
  vinkTransitionTable,
  VINK_TERMINAL_STATES,
  type VinkEvent,
  type VinkState,
} from './vink-state-machine.ts';
import { IllegalTransitionError } from './errors.ts';

const ALL_STATES: VinkState[] = [
  'DRAFT',
  'OPEN',
  'SUBMISSIONS_CLOSED',
  'PROCESSING_GRACE',
  'FUNDED',
  'EXPIRED',
  'CARD_PROVISIONING',
  'CARD_READY',
  'FUNDING_REVERSAL',
  'PURCHASE_AUTHORIZED',
  'SETTLING',
  'COMPLETED',
  'RECOVERY_REQUIRED',
  'RECOVERY_PENDING',
  'CANCELLED',
  'RESTRICTED',
];

const ALL_EVENTS: VinkEvent[] = [
  'VINK_OPENED',
  'ORGANIZER_CANCELLED',
  'SUBMISSION_DEADLINE_REACHED',
  'ALL_CONTRIBUTIONS_AUTHORIZED',
  'PROCESSING_GRACE_STARTED',
  'FUNDING_CONFIRMED',
  'FUNDING_FAILED',
  'CARD_PROVISIONING_STARTED',
  'CARD_ISSUED',
  'CARD_PROVISIONING_FAILED',
  'FUNDING_REVERSAL_COMPLETED',
  'MERCHANT_AUTHORIZATION_APPROVED',
  'PURCHASE_CAPTURED',
  'AUTHORIZATION_REVERSED',
  'SETTLEMENT_MATCHED',
  'SETTLEMENT_OVERAGE_DETECTED',
  'RECOVERY_STARTED',
  'RECOVERY_RESOLVED',
  'RECOVERY_DEFAULTED',
];

describe('Vink state machine (Plan §8)', () => {
  it('accepts every legal transition from the Plan §8 diagram, each emitting its event (D12)', () => {
    const expected: Array<[VinkState, VinkEvent, VinkState, string]> = [
      ['DRAFT', 'VINK_OPENED', 'OPEN', 'VinkOpened'],
      ['OPEN', 'ORGANIZER_CANCELLED', 'CANCELLED', 'VinkCancelled'],
      ['OPEN', 'SUBMISSION_DEADLINE_REACHED', 'SUBMISSIONS_CLOSED', 'SubmissionsClosed'],
      ['OPEN', 'ALL_CONTRIBUTIONS_AUTHORIZED', 'SUBMISSIONS_CLOSED', 'SubmissionsClosed'],
      [
        'SUBMISSIONS_CLOSED',
        'PROCESSING_GRACE_STARTED',
        'PROCESSING_GRACE',
        'ProcessingGraceStarted',
      ],
      ['PROCESSING_GRACE', 'FUNDING_CONFIRMED', 'FUNDED', 'VinkFunded'],
      ['PROCESSING_GRACE', 'FUNDING_FAILED', 'EXPIRED', 'VinkExpired'],
      ['FUNDED', 'CARD_PROVISIONING_STARTED', 'CARD_PROVISIONING', 'TemporaryCardRequested'],
      ['CARD_PROVISIONING', 'CARD_ISSUED', 'CARD_READY', 'TemporaryCardIssued'],
      ['CARD_PROVISIONING', 'CARD_PROVISIONING_FAILED', 'FUNDING_REVERSAL', 'TemporaryCardFailed'],
      ['FUNDING_REVERSAL', 'FUNDING_REVERSAL_COMPLETED', 'EXPIRED', 'VinkExpired'],
      [
        'CARD_READY',
        'MERCHANT_AUTHORIZATION_APPROVED',
        'PURCHASE_AUTHORIZED',
        'MerchantAuthorizationApproved',
      ],
      ['PURCHASE_AUTHORIZED', 'PURCHASE_CAPTURED', 'SETTLING', 'PurchaseCaptured'],
      [
        'PURCHASE_AUTHORIZED',
        'AUTHORIZATION_REVERSED',
        'CARD_READY',
        'MerchantAuthorizationReversed',
      ],
      ['SETTLING', 'SETTLEMENT_MATCHED', 'COMPLETED', 'VinkCompleted'],
      [
        'SETTLING',
        'SETTLEMENT_OVERAGE_DETECTED',
        'RECOVERY_REQUIRED',
        'SettlementVarianceDetected',
      ],
      ['RECOVERY_REQUIRED', 'RECOVERY_STARTED', 'RECOVERY_PENDING', 'RecoveryObligationCreated'],
      ['RECOVERY_PENDING', 'RECOVERY_RESOLVED', 'COMPLETED', 'VinkCompleted'],
      ['RECOVERY_PENDING', 'RECOVERY_DEFAULTED', 'RESTRICTED', 'OrganizerRestricted'],
    ];
    for (const [from, event, to, emits] of expected) {
      const transition = transitionVink(from, event);
      assert.equal(transition.to, to, `${from} --${event}--> ${to}`);
      assert.equal(transition.emits, emits, `${from} --${event}--> must emit ${emits}`);
    }
    // The machine contains exactly these transitions and nothing more.
    assert.equal(vinkTransitionTable().length, expected.length);
  });

  it('D12: no transition is silent — every table entry names its emitted event', () => {
    for (const { from, event, emits } of vinkTransitionTable()) {
      assert.equal(typeof emits, 'string', `${from} --${event}--> must emit an event`);
      assert.ok(emits.length > 0);
    }
  });

  it('rejects every state × event pair not in the table with IllegalTransitionError', () => {
    let rejected = 0;
    for (const from of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        if (canTransitionVink(from, event)) continue;
        assert.throws(
          () => transitionVink(from, event),
          (error: unknown) =>
            error instanceof IllegalTransitionError &&
            error.code === 'ILLEGAL_TRANSITION' &&
            error.aggregate === 'Vink' &&
            error.from === from &&
            error.event === event,
          `${from} --${event}--> must throw`,
        );
        rejected += 1;
      }
    }
    assert.equal(rejected, ALL_STATES.length * ALL_EVENTS.length - vinkTransitionTable().length);
  });

  it('terminal states are exactly COMPLETED, CANCELLED, EXPIRED, RESTRICTED and have no exits', () => {
    assert.deepEqual([...VINK_TERMINAL_STATES].sort(), [
      'CANCELLED',
      'COMPLETED',
      'EXPIRED',
      'RESTRICTED',
    ]);
    for (const state of VINK_TERMINAL_STATES) {
      assert.equal(isVinkTerminal(state), true);
      for (const event of ALL_EVENTS) {
        assert.equal(canTransitionVink(state, event), false, `${state} must not accept ${event}`);
      }
    }
  });

  it('a session that expired cannot reopen (journey E6 guard)', () => {
    for (const event of ALL_EVENTS) {
      assert.equal(canTransitionVink('EXPIRED', event), false);
    }
  });

  it('every non-terminal state can reach a terminal state', () => {
    const table = vinkTransitionTable();
    const reachesTerminal = new Set<VinkState>(VINK_TERMINAL_STATES);
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
    for (const state of ALL_STATES) {
      assert.equal(reachesTerminal.has(state), true, `${state} must reach a terminal state`);
    }
  });
});
