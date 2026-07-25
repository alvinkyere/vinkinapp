import '../../core/models/activity_entry.dart';

/// Maps a raw domain event name to the site's own register — short, warm, concrete,
/// never a backend event/state name. Scoped deliberately to what's derivable from the
/// activity feed's own payload without extra per-event lookups (a participant's *name*
/// isn't in `ParticipantJoined`'s payload, only their id — enriching every feed item with
/// full participant/settlement lookups was cut from this milestone; flagged in the report).
///
/// Slice I2D: [isOrganizerViewer] (default `true`, so the organizer's own feed is byte-for-
/// byte unchanged) swaps `VinkCreated`/`VinkCancelled`'s "You..." framing — true only for the
/// organizer — to neutral phrasing when the viewer is a mere participant, since those two are
/// the only cases in this switch that name the viewer as the actor.
String activityCopy(
  ActivityEntry entry, {
  required String vinkTitle,
  bool isOrganizerViewer = true,
}) {
  return switch (entry.eventType) {
    'VinkCreated' =>
      isOrganizerViewer ? 'You started $vinkTitle' : 'This Vink was created',
    'ParticipantJoined' => 'Someone joined $vinkTitle',
    // Invites feature (2026-07-23, D44).
    'ParticipantInvited' => 'Someone was invited to $vinkTitle',
    'ParticipantInviteAccepted' => 'Someone joined $vinkTitle',
    'ParticipantInviteDeclined' => 'An invite to $vinkTitle was declined',
    'ParticipantAllocationChanged' => 'Shares were updated for $vinkTitle',
    'VinkOpened' => '$vinkTitle is open for contributions',
    'ContributionAuthorized' => 'A payment was confirmed for $vinkTitle',
    'ContributionCaptured' => 'A payment landed for $vinkTitle',
    'VinkFunded' => 'Everyone is in on $vinkTitle',
    'TemporaryCardIssued' => '$vinkTitle is ready to pay',
    'MerchantAuthorizationApproved' => '$vinkTitle was used at checkout',
    'PurchaseCaptured' => '$vinkTitle purchase completed',
    'VinkCompleted' => '$vinkTitle is all paid up',
    'VinkCancelled' =>
      isOrganizerViewer
          ? 'You cancelled $vinkTitle'
          : 'This Vink was cancelled',
    'VinkExpired' => '$vinkTitle expired before everyone joined',
    'RefundIssued' => 'A refund went out for $vinkTitle',
    _ => '$vinkTitle was updated',
  };
}

/// Slice I6 (Phase 4 §10) — the short outcome word for an Activity outcome-summary row
/// (`VinkOutcomeSummary.outcomeLabel`, `activity_providers.dart`). Deliberately terse, unlike
/// [activityCopy]'s own full-sentence-per-event style — a list row shows a label, not a
/// sentence; the full outcome statement lives on Vink Details instead.
String outcomeLabelCopy(String outcomeLabel) => switch (outcomeLabel) {
  'completed' => 'Completed',
  'cancelled' => 'Cancelled',
  'expired' => 'Expired',
  _ => outcomeLabel,
};
