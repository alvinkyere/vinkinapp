import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models/activity_entry.dart';
import '../../core/repositories/vink_repository.dart';
import '../create_vink/purchase_category.dart';
import '../home/home_providers.dart';

typedef VinkActivity = ({String vinkId, String vinkTitle, ActivityEntry entry});

/// Merges each of the organizer's own Vinks' activity feeds into one reverse-chronological
/// list — an N+1 fetch (one per Vink), acceptable at pilot scale (a handful of Vinks per
/// organizer), not built for an organizer with hundreds of them.
final recentActivityProvider = FutureProvider.autoDispose<List<VinkActivity>>((
  ref,
) async {
  final repository = ref.read(vinkRepositoryProvider);
  final vinks = await ref.watch(myVinksProvider.future);
  final entries = <VinkActivity>[];
  for (final vink in vinks) {
    final list = await repository.getActivity(vink.id);
    for (final entry in list) {
      entries.add((
        vinkId: vink.id,
        vinkTitle: purchaseCategoryLabel(vink.purchaseCategory),
        entry: entry,
      ));
    }
  }
  entries.sort((a, b) => b.entry.at.compareTo(a.entry.at));
  return entries;
});
