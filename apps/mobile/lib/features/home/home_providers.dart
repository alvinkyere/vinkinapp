import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/models/vink.dart';

final myVinksProvider = FutureProvider.autoDispose<List<Vink>>((ref) async {
  final client = ref.read(apiClientProvider);
  final response = await client.get('/api/v1/vinks');
  return (response['vinks'] as List<dynamic>).map((entry) => Vink.fromJson(entry as Map<String, dynamic>)).toList();
});

/// The D11 states that still need the organizer's attention, in the Home screen's sense of
/// "active" — everything that isn't a final resting state.
const _terminalStates = {'COMPLETED', 'CANCELLED', 'EXPIRED', 'RESTRICTED'};

typedef ActiveVink = ({Vink vink, int participantCount});

/// One snapshot fetch per active Vink (pilot scale — an organizer runs a handful of Vinks
/// at once, same N+1 justification as `features/activity/activity_providers.dart`) just to
/// surface participant count, which `GET /api/v1/vinks` (list-my-vinks) doesn't include.
final activeVinksProvider = FutureProvider.autoDispose<List<ActiveVink>>((ref) async {
  final client = ref.read(apiClientProvider);
  final vinks = await ref.watch(myVinksProvider.future);
  final active = vinks.where((v) => !_terminalStates.contains(v.state)).toList();
  final results = <ActiveVink>[];
  for (final vink in active) {
    final response = await client.get('/api/v1/vinks/${vink.id}');
    final participants = response['participants'] as List<dynamic>;
    results.add((vink: vink, participantCount: participants.length));
  }
  return results;
});
