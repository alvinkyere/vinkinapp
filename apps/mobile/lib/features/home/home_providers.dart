import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/models/vink.dart';

/// Organizer-owned vinks, and — once the server's `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`
/// flag is on (Slice I2B) — vinks this signed-in user merely participates in too, each
/// carrying [Vink.role]. Entirely server-driven: with the flag off, `GET /api/v1/vinks`
/// never returns a participant-role entry, so every code path below collapses to today's
/// exact organizer-only behavior with no client-side flag of its own (Phase 10 §12 — no
/// second feature-flag system).
final myVinksProvider = FutureProvider.autoDispose<List<Vink>>((ref) async {
  final client = ref.read(apiClientProvider);
  final response = await client.get('/api/v1/vinks');
  return (response['vinks'] as List<dynamic>)
      .map((entry) => Vink.fromJson(entry as Map<String, dynamic>))
      .toList();
});

/// The D11 states that still need attention, in the Home screen's sense of "active" —
/// everything that isn't a final resting state. For a `role == 'participant'` entry,
/// RESTRICTED is deliberately NOT filtered out here (unlike for the organizer): RESTRICTED is
/// an organizer-only recovery-attention state (Phase 0 §11) and a participant's own money is
/// already resolved by the time it's reachable (the same rule `computeGuestVinkOutcome`
/// already encodes for guests — RESTRICTED reads as `completed`), but it must still be
/// reachable rather than silently disappearing from every Home surface (I2B's own explicit
/// requirement) — Home has no separate "past Vinks" section to fall back to.
const _organizerTerminalStates = {
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'RESTRICTED',
};
const _participantTerminalStates = {'COMPLETED', 'CANCELLED', 'EXPIRED'};

bool _isActive(Vink vink) => vink.isOrganizerRole
    ? !_organizerTerminalStates.contains(vink.state)
    : !_participantTerminalStates.contains(vink.state);

typedef ActiveVink = ({Vink vink, int participantCount});

/// One enrichment fetch per active Vink (pilot scale — same N+1 justification as
/// `features/activity/activity_providers.dart`) to surface participant count, which
/// `GET /api/v1/vinks` doesn't include. Branches by role (Slice I2B): the organizer-only
/// snapshot endpoint (`GET /api/v1/vinks/:id`) 403s for a mere participant, so a
/// participant-role entry is enriched via the customer-safe `.../participant-view` route
/// instead, reading its own `totalParticipantCount` — never the organizer snapshot.
final activeVinksProvider = FutureProvider.autoDispose<List<ActiveVink>>((
  ref,
) async {
  final client = ref.read(apiClientProvider);
  final vinks = await ref.watch(myVinksProvider.future);
  final active = vinks.where(_isActive).toList();
  final results = <ActiveVink>[];
  for (final vink in active) {
    if (vink.isOrganizerRole) {
      final response = await client.get('/api/v1/vinks/${vink.id}');
      final participants = response['participants'] as List<dynamic>;
      results.add((vink: vink, participantCount: participants.length));
    } else {
      final response = await client.get(
        '/api/v1/vinks/${vink.id}/participant-view',
      );
      final view = ParticipantVinkView.fromJson(response);
      results.add((
        vink: vink,
        participantCount: view.vink.totalParticipantCount,
      ));
    }
  }
  return results;
});
