import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models/pending_invite.dart';
import '../../core/repositories/vink_repository.dart';

/// Invites feature (D44) — `GET /api/v1/invites`, newest-invited-first. A single, already-
/// atomic server query (unlike Activity's own per-vink N+1 fetch), so no partial-failure
/// wrapper is needed here — a plain `FutureProvider` already gives the right loading/error/
/// data states.
final invitesProvider = FutureProvider.autoDispose<List<PendingInvite>>((
  ref,
) async {
  return ref.read(vinkRepositoryProvider).listMyInvites();
});

/// Home's "Not now" is dismiss-only (§4.4 of the plan) — the invite still exists, still shows
/// in the Invites tab; this is purely a per-session "don't show this card on Home again"
/// preference, never a server call. Resets on app restart, which is the correct behavior for
/// a lightweight dismissal, not a real decline.
final dismissedInviteIdsProvider = StateProvider<Set<String>>(
  (ref) => const {},
);
