/**
 * Domain event → client message type (Plan §14 channel vocabulary). A `Record<DomainEventName,
 * …>` makes the mapping exhaustive — adding a new domain event without updating this file is
 * a type error, not a silent gap.
 *
 * Plan §14 names every message type the client vocabulary needs for the required UI states;
 * several domain events (card/merchant/recovery/refund internals) have no listed counterpart.
 * Those map to the additive `vink_state_changed` fallback — flagged here, not silently
 * invented — carrying the original event type so a client can still branch on specifics if
 * it wants to. `snapshot` is not driven by an outbox event; it is sent once per connection
 * by the route itself.
 */

import type { DomainEventName } from '../../../../packages/domain/src/index.ts';

export type ClientMessageType =
  | 'participant_joined'
  | 'participant_updated'
  | 'contribution_pending'
  | 'contribution_authorized'
  | 'contribution_declined'
  | 'funding_progress_updated'
  | 'submissions_closed'
  | 'processing_grace_started'
  | 'vink_funded'
  | 'card_ready'
  | 'purchase_authorized'
  | 'purchase_completed'
  | 'vink_expired'
  | 'vink_cancelled'
  | 'vink_state_changed'; // additive fallback (flagged) — see module doc

const MESSAGE_TYPE: Record<DomainEventName, ClientMessageType> = {
  VinkCreated: 'vink_state_changed',
  VinkOpened: 'vink_state_changed',
  ParticipantJoined: 'participant_joined',
  ParticipantAllocationChanged: 'funding_progress_updated',
  ContributionRequested: 'contribution_pending',
  ContributionAuthorizationStarted: 'contribution_pending',
  ContributionAuthorized: 'contribution_authorized',
  ContributionDeclined: 'contribution_declined',
  ContributionResolutionRequired: 'contribution_pending',
  SubmissionsClosed: 'submissions_closed',
  ProcessingGraceStarted: 'processing_grace_started',
  VinkFunded: 'vink_funded',
  VinkExpired: 'vink_expired',
  TemporaryCardRequested: 'vink_state_changed',
  TemporaryCardIssued: 'card_ready',
  TemporaryCardFailed: 'vink_state_changed',
  MerchantAuthorizationReceived: 'vink_state_changed',
  MerchantAuthorizationApproved: 'purchase_authorized',
  MerchantAuthorizationDeclined: 'vink_state_changed',
  MerchantLocked: 'vink_state_changed',
  PurchaseCaptured: 'vink_state_changed',
  SettlementVarianceDetected: 'vink_state_changed',
  RecoveryObligationCreated: 'vink_state_changed',
  RefundRequested: 'vink_state_changed',
  RefundCompleted: 'vink_state_changed',
  VinkCompleted: 'purchase_completed',
  VinkCancelled: 'vink_cancelled',
  OrganizerRestricted: 'vink_state_changed',
  MerchantAuthorizationReversed: 'vink_state_changed',
  ContributionCaptureStarted: 'funding_progress_updated',
  ContributionCancellationStarted: 'vink_state_changed',
  ContributionCaptured: 'funding_progress_updated',
  ContributionCancelled: 'vink_state_changed',
  ContributionSettled: 'funding_progress_updated',
  RefundFailed: 'vink_state_changed',
  ParticipantRemoved: 'participant_updated',
  // Invites feature (2026-07-23, D44) — no new Plan §14 message type: an invite appearing or
  // being accepted is, from the client's perspective, exactly "the participant list changed,
  // refetch" — the same reaction `participant_joined` already causes. A decline lands the
  // participant on REMOVED, so it reuses ParticipantRemoved's own mapping.
  ParticipantInvited: 'participant_joined',
  ParticipantInviteAccepted: 'participant_joined',
  ParticipantInviteDeclined: 'participant_updated',
  // RM1 (D47) — the card-phase timeout exit, same shape as TemporaryCardFailed: no listed
  // Plan §14 message type, additive fallback.
  CardWindowExpired: 'vink_state_changed',
};

export function clientMessageType(eventType: DomainEventName): ClientMessageType {
  return MESSAGE_TYPE[eventType];
}
