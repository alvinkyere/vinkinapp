import '../../design_system/components/vink_participant_row.dart';

const _processingStatuses = {
  'CREATED',
  'AUTHORIZATION_PENDING',
  'RESOLUTION_PENDING',
  'CAPTURE_PENDING',
  'CANCELLATION_PENDING',
};

const _paidStatuses = {'AUTHORIZED', 'CAPTURED', 'SETTLED'};

/// Projects a raw `Contribution['status']` (or none yet) to the lobby's three-state,
/// human-facing payment indicator (design correction: friendly status language, never a
/// raw backend status string).
VinkParticipantPaymentState paymentStateFor(String? contributionStatus) {
  if (contributionStatus != null &&
      _paidStatuses.contains(contributionStatus)) {
    return VinkParticipantPaymentState.paid;
  }
  if (contributionStatus != null &&
      _processingStatuses.contains(contributionStatus)) {
    return VinkParticipantPaymentState.processing;
  }
  return VinkParticipantPaymentState.waiting;
}
