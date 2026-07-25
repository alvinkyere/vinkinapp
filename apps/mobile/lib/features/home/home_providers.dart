import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models/vink.dart';
import '../../core/repositories/vink_repository.dart';
import '../../design_system/components/vink_participant_row.dart';
import '../vink_lobby/participant_payment_state.dart';

/// Organizer-owned vinks, and — once the server's `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`
/// flag is on (Slice I2B) — vinks this signed-in user merely participates in too, each
/// carrying [Vink.role]. Entirely server-driven: with the flag off, `GET /api/v1/vinks`
/// never returns a participant-role entry, so every code path below collapses to today's
/// exact organizer-only behavior with no client-side flag of its own (Phase 10 §12 — no
/// second feature-flag system).
final myVinksProvider = FutureProvider.autoDispose<List<Vink>>((ref) async {
  return ref.read(vinkRepositoryProvider).listMyVinks();
});

/// The D11 states that still need attention, in the Home screen's sense of "active" —
/// everything that isn't a final resting state.
///
/// Slice I6 fix (found while building the two-section redesign, not a new behavior change of
/// its own): RESTRICTED used to be excluded here for the ORGANIZER only, silently vanishing
/// from every Home surface — directly contradicting Phase 3 §1's own design ("RESTRICTED
/// (organizer)" belongs in "needs your attention"). The participant branch already correctly
/// kept RESTRICTED active (comment preserved below); the organizer branch is now identical,
/// closing the gap. Unconditional, not gated behind [FeatureFlags.homeActivityV2] — this is a
/// correctness fix, not new UX, the same way I2D's crash-bug fix wasn't flag-gated either.
const _terminalStates = {'COMPLETED', 'CANCELLED', 'EXPIRED'};

bool _isActive(Vink vink) => !_terminalStates.contains(vink.state);

/// Slice I6 (Phase 3 §1) — which of Home's two sections a Vink belongs in. RESTRICTED is
/// `needsAttention` for the organizer (the recovery ladder needs them) but deliberately
/// `waitingOnOthers` for a mere participant — D24/D25's own rule that a participant's money
/// is already resolved by the time RESTRICTED is reachable, matching Phase 3 §1's own
/// "RESTRICTED (**organizer**)" phrasing.
enum AttentionBucket { needsAttention, waitingOnOthers }

/// Pure, directly unit-tested (I6's own named requirement) — organizer branch. Reuses
/// `paymentStateFor` (already established in `vink_lobby/participant_payment_state.dart` for
/// the exact same raw-status-to-friendly categorization) rather than inventing a parallel one.
AttentionBucket organizerAttentionBucket({
  required String vinkState,
  required List<String> allowedActions,
  required String? ownContributionStatus,
}) {
  if (vinkState == 'RESTRICTED') return AttentionBucket.needsAttention;
  if (vinkState == 'OPEN' &&
      paymentStateFor(ownContributionStatus) !=
          VinkParticipantPaymentState.paid) {
    return AttentionBucket.needsAttention;
  }
  if (allowedActions.contains('OPEN_VINK') ||
      allowedActions.contains('COVER_REMAINING')) {
    return AttentionBucket.needsAttention;
  }
  return AttentionBucket.waitingOnOthers;
}

/// Pure, directly unit-tested — participant branch. [ownContributionStatus] here is already
/// the friendly `GuestContributionStatus` label (`ParticipantVinkView.participant
/// .contributionStatus`), unlike the organizer branch's raw status — the two branches read
/// genuinely different server shapes, so they stay two small functions rather than one that
/// silently expects two different string vocabularies from the same parameter.
AttentionBucket participantAttentionBucket({
  required String vinkState,
  required String ownContributionStatus,
}) {
  if (vinkState == 'OPEN' &&
      (ownContributionStatus == 'not_started' ||
          ownContributionStatus == 'declined_retryable')) {
    return AttentionBucket.needsAttention;
  }
  return AttentionBucket.waitingOnOthers;
}

typedef ActiveVink = ({
  Vink vink,
  int participantCount,
  AttentionBucket attentionBucket,
  ContributionProgress contributionProgress,

  /// Slice 3 (Home visual polish) — real display names, organizer-role entries only. Empty
  /// for a participant-role entry: `ParticipantVinkView` never carries another participant's
  /// identity (D24/D25), so there is nothing privacy-safe to show here for that role — the
  /// card falls back to its existing plain "N people" text instead of an avatar stack.
  List<String> participantNames,
});

/// One enrichment fetch per active Vink (pilot scale — same N+1 justification as
/// `features/activity/activity_providers.dart`) to surface participant count and the
/// attention-bucket classification, neither of which `GET /api/v1/vinks` carries. Branches by
/// role (Slice I2B): the organizer-only snapshot endpoint (`GET /api/v1/vinks/:id`) 403s for a
/// mere participant, so a participant-role entry is enriched via the customer-safe
/// `.../participant-view` route instead — never the organizer snapshot.
final activeVinksProvider = FutureProvider.autoDispose<List<ActiveVink>>((
  ref,
) async {
  final repository = ref.read(vinkRepositoryProvider);
  final vinks = await ref.watch(myVinksProvider.future);
  final active = vinks.where(_isActive).toList();
  final results = <ActiveVink>[];
  for (final vink in active) {
    if (vink.isOrganizerRole) {
      final snapshot = await repository.getSnapshot(vink.id);
      final organizerId = snapshot.participants
          .firstWhere((participant) => participant.isOrganizer)
          .id;
      results.add((
        vink: vink,
        participantCount: snapshot.participants.length,
        attentionBucket: organizerAttentionBucket(
          vinkState: vink.state,
          allowedActions: snapshot.allowedActions,
          ownContributionStatus:
              snapshot.contributionStatusByParticipant[organizerId],
        ),
        contributionProgress: snapshot.contributionProgress,
        participantNames: [
          for (final participant in snapshot.participants)
            participant.displayName,
        ],
      ));
    } else {
      final view = await repository.getParticipantView(vink.id);
      results.add((
        vink: vink,
        participantCount: view.vink.totalParticipantCount,
        attentionBucket: participantAttentionBucket(
          vinkState: vink.state,
          ownContributionStatus: view.participant.contributionStatus,
        ),
        // Slice I6: normalized into the same ContributionProgress shape the organizer branch
        // already gets directly from the server, from the equivalent fields
        // ParticipantVinkSummary already carries — never derived from fundedAmountMinor.
        contributionProgress: ContributionProgress(
          confirmedAmountMinor: view.vink.confirmedAmountMinor,
          totalAmountMinor: view.vink.requiredAmountMinor,
          confirmedParticipantCount: view.vink.confirmedParticipantCount,
          totalParticipantCount: view.vink.totalParticipantCount,
        ),
        participantNames: const [],
      ));
    }
  }
  return results;
});
