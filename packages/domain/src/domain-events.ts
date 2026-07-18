/**
 * Domain event catalog — Plan §12 core events, plus seven additive extensions required so
 * that EVERY state transition names an event (D12: a transition and its event are
 * inseparable; a silent transition is unrepresentable).
 *
 * Persistence rule (enforced from PV3+): the state write and the outbox insert for the
 * emitted event commit in the same PostgreSQL transaction (Plan §12).
 */

/** Plan §12 core event names, verbatim. */
export type PlanCoreEventName =
  | 'VinkCreated'
  | 'VinkOpened'
  | 'ParticipantJoined'
  | 'ParticipantAllocationChanged'
  | 'ContributionRequested'
  | 'ContributionAuthorizationStarted'
  | 'ContributionAuthorized'
  | 'ContributionDeclined'
  | 'ContributionResolutionRequired'
  | 'SubmissionsClosed'
  | 'ProcessingGraceStarted'
  | 'VinkFunded'
  | 'VinkExpired'
  | 'TemporaryCardRequested'
  | 'TemporaryCardIssued'
  | 'TemporaryCardFailed'
  | 'MerchantAuthorizationReceived'
  | 'MerchantAuthorizationApproved'
  | 'MerchantAuthorizationDeclined'
  | 'MerchantLocked'
  | 'PurchaseCaptured'
  | 'SettlementVarianceDetected'
  | 'RecoveryObligationCreated'
  | 'RefundRequested'
  | 'RefundCompleted'
  | 'VinkCompleted'
  | 'VinkCancelled'
  | 'OrganizerRestricted';

/** Additive extensions to the Plan §12 catalog (flagged in D12 — needed for full D12 coverage). */
export type ExtensionEventName =
  | 'MerchantAuthorizationReversed'
  | 'ContributionCaptureStarted'
  | 'ContributionCancellationStarted'
  | 'ContributionCaptured'
  | 'ContributionCancelled'
  | 'ContributionSettled'
  | 'RefundFailed'
  | 'ParticipantRemoved'; // PV3: the catalog has ParticipantJoined but no removal event

export type DomainEventName = PlanCoreEventName | ExtensionEventName;
