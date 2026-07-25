// Invites feature (D44) — invitesProvider's own success/failure paths, matching
// activity_providers_test.dart's established convention of driving the real provider
// against a fake repository rather than overriding the provider wholesale.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/models/pending_invite.dart';
import 'package:vinkin_mobile/core/networking/api_client.dart';
import 'package:vinkin_mobile/core/repositories/vink_repository.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';
import 'package:vinkin_mobile/features/invites/invites_providers.dart';

class _FakeVinkRepository extends VinkRepository {
  _FakeVinkRepository({this.invites, this.error})
    : super(
        ApiClient(
          tokenStore: SecureTokenStore(),
          appVersion: Future.value('test'),
        ),
      );

  final List<PendingInvite>? invites;
  final Object? error;

  @override
  Future<List<PendingInvite>> listMyInvites({dynamic cancelToken}) async {
    if (error != null) throw error!;
    return invites ?? const [];
  }
}

PendingInvite _invite(String vinkId) => PendingInvite(
  vinkId: vinkId,
  purpose: 'Dinner',
  purchaseCategory: 'GROCERY',
  organizerDisplayName: 'Alvin',
  assignedShareMinor: 3000,
  invitedAt: DateTime.utc(2026, 1, 1),
);

void main() {
  test('returns the repository\'s own pending invites', () async {
    final repository = _FakeVinkRepository(invites: [_invite('vink-1')]);
    final container = ProviderContainer(
      overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);

    final result = await container.read(invitesProvider.future);

    expect(result, hasLength(1));
    expect(result.single.vinkId, 'vink-1');
  });

  test('an empty list is a valid, non-error result', () async {
    final repository = _FakeVinkRepository(invites: const []);
    final container = ProviderContainer(
      overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);

    final result = await container.read(invitesProvider.future);

    expect(result, isEmpty);
  });

  test('a failing fetch surfaces as a provider error, not a crash', () async {
    final repository = _FakeVinkRepository(error: Exception('boom'));
    final container = ProviderContainer(
      overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);

    await expectLater(container.read(invitesProvider.future), throwsException);
  });

  test(
    'dismissedInviteIdsProvider starts empty and accumulates dismissed ids',
    () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      expect(container.read(dismissedInviteIdsProvider), isEmpty);

      container
          .read(dismissedInviteIdsProvider.notifier)
          .update((state) => {...state, 'vink-1'});

      expect(container.read(dismissedInviteIdsProvider), {'vink-1'});
    },
  );
}
