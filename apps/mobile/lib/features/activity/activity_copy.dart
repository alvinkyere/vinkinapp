import '../../core/models/activity_entry.dart';

/// Maps a raw domain event name to the site's own register — short, warm, concrete,
/// never a backend event/state name. Scoped deliberately to what's derivable from the
/// activity feed's own payload without extra per-event lookups (a participant's *name*
/// isn't in `ParticipantJoined`'s payload, only their id — enriching every feed item with
/// full participant/settlement lookups was cut from this milestone; flagged in the report).
String activityCopy(ActivityEntry entry, {required String vinkTitle}) {
  return switch (entry.eventType) {
    'VinkCreated' => 'You started $vinkTitle',
    'ParticipantJoined' => 'Someone joined $vinkTitle',
    'ParticipantAllocationChanged' => 'Shares were updated for $vinkTitle',
    'VinkOpened' => '$vinkTitle is open for contributions',
    'ContributionAuthorized' => 'A payment was confirmed for $vinkTitle',
    'ContributionCaptured' => 'A payment landed for $vinkTitle',
    'VinkFunded' => 'Everyone is in on $vinkTitle',
    'TemporaryCardIssued' => '$vinkTitle is ready to pay',
    'MerchantAuthorizationApproved' => '$vinkTitle was used at checkout',
    'PurchaseCaptured' => '$vinkTitle purchase completed',
    'VinkCompleted' => '$vinkTitle is all paid up',
    'VinkCancelled' => 'You cancelled $vinkTitle',
    'VinkExpired' => '$vinkTitle expired before everyone joined',
    'RefundIssued' => 'A refund went out for $vinkTitle',
    _ => '$vinkTitle was updated',
  };
}
