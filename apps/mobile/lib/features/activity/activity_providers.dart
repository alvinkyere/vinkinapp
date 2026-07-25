import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models/activity_entry.dart';
import '../../core/repositories/vink_repository.dart';
import '../create_vink/purchase_category.dart';
import '../home/home_providers.dart';

typedef VinkActivity = ({
  String vinkId,
  String vinkTitle,
  ActivityEntry entry,
  bool isOrganizerRole,
});

/// A per-vink fetch failing (network blip, a since-removed Vink, a transient 5xx) must never
/// take down the rest of the list — [failedCount] lets the screen show a small, honest "some
/// items couldn't load" note alongside whatever DID load, rather than either silently hiding
/// the failure or collapsing the whole screen into a single retry-everything error state.
typedef VinkActivityLoadResult = ({List<VinkActivity> entries, int failedCount});

/// Merges each of the user's own Vinks' activity feeds into one reverse-chronological list —
/// an N+1 fetch (one per Vink), acceptable at pilot scale (a handful of Vinks per user), not
/// built for hundreds of them.
///
/// Slice I2D: branches per vink by role. `myVinksProvider` has returned a participant-role
/// union since I2A, but until this slice every entry in that union was fetched through the
/// organizer-only `getActivity` — a 403 for any participant-role vink, unhandled inside this
/// loop, which failed the ENTIRE feed (not just that one vink's entries) for any user who is a
/// participant on even one Vink. `getParticipantActivity` (the new, customer-safe read) is the
/// fix and the feature at once. `isOrganizerRole` is carried per entry (not just per provider
/// call) because one merged feed can mix vinks of both roles — `activityCopy` needs it to
/// choose the correct phrasing for the viewer, per entry.
///
/// Slice I6 (owner-directed partial-failure resilience): each vink's own fetch is now isolated
/// in its own try/catch — one vink's failure is skipped and counted, never propagated to fail
/// the whole `Future` the way an unhandled exception here would have.
final recentActivityProvider = FutureProvider.autoDispose<VinkActivityLoadResult>((
  ref,
) async {
  final repository = ref.read(vinkRepositoryProvider);
  final vinks = await ref.watch(myVinksProvider.future);
  final entries = <VinkActivity>[];
  var failedCount = 0;
  for (final vink in vinks) {
    try {
      final list = vink.isOrganizerRole
          ? await repository.getActivity(vink.id)
          : await repository.getParticipantActivity(vink.id);
      for (final entry in list) {
        entries.add((
          vinkId: vink.id,
          vinkTitle: purchaseCategoryLabel(vink.purchaseCategory),
          entry: entry,
          isOrganizerRole: vink.isOrganizerRole,
        ));
      }
    } catch (_) {
      failedCount++;
    }
  }
  entries.sort((a, b) => b.entry.at.compareTo(a.entry.at));
  return (entries: entries, failedCount: failedCount);
});

/// Slice I6 (Phase 3 §4, D29) — a vink-level outcome summary row, one per terminal Vink, the
/// data model Activity's flag-on list actually renders. `state`→outcome is the same simple
/// classification `VinkStatusBadge` already does client-side (this codebase's own established
/// precedent that CURRENT-state labeling, unlike re-deriving state *transitions*, is fine on
/// the client — Plan §19 is about not reimplementing the state machine, not about reading an
/// already-known current state). Deliberately omits `returned` — Phase 3 §4 itself flags that
/// vocabulary as not yet settled ("partially built"); not invented here.
const _terminalOutcomeStates = {
  'COMPLETED': 'completed',
  'CANCELLED': 'cancelled',
  'EXPIRED': 'expired',
};

/// The single milestone event type whose timestamp is this outcome's own "date," per state.
const _terminalMilestoneEventType = {
  'COMPLETED': 'VinkCompleted',
  'CANCELLED': 'VinkCancelled',
  'EXPIRED': 'VinkExpired',
};

typedef VinkOutcomeSummary = ({
  String vinkId,
  String vinkTitle,
  String outcomeLabel,
  DateTime date,
  int amountMinor,
  String purchaseCategory,
});

/// Same partial-failure contract as [VinkActivityLoadResult] above.
typedef VinkOutcomesLoadResult = ({List<VinkOutcomeSummary> summaries, int failedCount});

final vinkOutcomesProvider = FutureProvider.autoDispose<VinkOutcomesLoadResult>((
  ref,
) async {
  final repository = ref.read(vinkRepositoryProvider);
  final vinks = await ref.watch(myVinksProvider.future);
  final summaries = <VinkOutcomeSummary>[];
  var failedCount = 0;
  for (final vink in vinks) {
    final outcomeLabel = _terminalOutcomeStates[vink.state];
    if (outcomeLabel == null) continue;
    try {
      final list = vink.isOrganizerRole
          ? await repository.getActivity(vink.id)
          : await repository.getParticipantActivity(vink.id);
      final milestoneEventType = _terminalMilestoneEventType[vink.state];
      final milestone = list
          .where((entry) => entry.eventType == milestoneEventType)
          .toList();
      // Falls back to the Vink's own deadline in the (unexpected — D12 guarantees every
      // transition emits its event) case the milestone entry itself isn't found, rather than
      // ever crashing this list over one missing timestamp.
      final date = milestone.isEmpty
          ? (vink.submissionDeadline ?? DateTime.now())
          : milestone.last.at;
      summaries.add((
        vinkId: vink.id,
        vinkTitle: vink.purpose ?? purchaseCategoryLabel(vink.purchaseCategory),
        outcomeLabel: outcomeLabel,
        date: date,
        amountMinor: vink.requiredAmountMinor,
        purchaseCategory: vink.purchaseCategory,
      ));
    } catch (_) {
      failedCount++;
    }
  }
  summaries.sort((a, b) => b.date.compareTo(a.date));
  return (summaries: summaries, failedCount: failedCount);
});
