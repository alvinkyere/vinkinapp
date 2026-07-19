import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clientMessageType, type ClientMessageType } from './message-mapping.ts';
import type { DomainEventName } from '../../../../packages/domain/src/index.ts';

// Mirrors packages/domain/src/domain-events.ts verbatim. The Record in message-mapping.ts is
// already exhaustive at compile time (a missing case is a type error); this is a redundant
// runtime check that every one of them resolves to a real, non-empty message type.
const ALL_DOMAIN_EVENTS: DomainEventName[] = [
  'VinkCreated',
  'VinkOpened',
  'ParticipantJoined',
  'ParticipantAllocationChanged',
  'ContributionRequested',
  'ContributionAuthorizationStarted',
  'ContributionAuthorized',
  'ContributionDeclined',
  'ContributionResolutionRequired',
  'SubmissionsClosed',
  'ProcessingGraceStarted',
  'VinkFunded',
  'VinkExpired',
  'TemporaryCardRequested',
  'TemporaryCardIssued',
  'TemporaryCardFailed',
  'MerchantAuthorizationReceived',
  'MerchantAuthorizationApproved',
  'MerchantAuthorizationDeclined',
  'MerchantLocked',
  'PurchaseCaptured',
  'SettlementVarianceDetected',
  'RecoveryObligationCreated',
  'RefundRequested',
  'RefundCompleted',
  'VinkCompleted',
  'VinkCancelled',
  'OrganizerRestricted',
  'MerchantAuthorizationReversed',
  'ContributionCaptureStarted',
  'ContributionCancellationStarted',
  'ContributionCaptured',
  'ContributionCancelled',
  'ContributionSettled',
  'RefundFailed',
  'ParticipantRemoved',
];

const KEY_EVENTS: Array<[DomainEventName, ClientMessageType]> = [
  ['ParticipantJoined', 'participant_joined'],
  ['ParticipantRemoved', 'participant_updated'],
  ['ContributionAuthorized', 'contribution_authorized'],
  ['ContributionDeclined', 'contribution_declined'],
  ['SubmissionsClosed', 'submissions_closed'],
  ['ProcessingGraceStarted', 'processing_grace_started'],
  ['VinkFunded', 'vink_funded'],
  ['TemporaryCardIssued', 'card_ready'],
  ['MerchantAuthorizationApproved', 'purchase_authorized'],
  ['VinkCompleted', 'purchase_completed'],
  ['VinkExpired', 'vink_expired'],
  ['VinkCancelled', 'vink_cancelled'],
];

describe('client message mapping (Plan §14)', () => {
  it('maps every domain event to a non-empty message type', () => {
    for (const eventType of ALL_DOMAIN_EVENTS) {
      const messageType = clientMessageType(eventType);
      assert.equal(typeof messageType, 'string');
      assert.ok(messageType.length > 0, `${eventType} mapped to an empty type`);
    }
  });

  it('maps the Plan §14-named events to their exact wire vocabulary', () => {
    for (const [eventType, expected] of KEY_EVENTS) {
      assert.equal(clientMessageType(eventType), expected);
    }
  });

  it('events with no Plan §14 counterpart use the flagged vink_state_changed fallback', () => {
    for (const eventType of [
      'VinkCreated',
      'MerchantLocked',
      'RecoveryObligationCreated',
    ] as const) {
      assert.equal(clientMessageType(eventType), 'vink_state_changed');
    }
  });
});
