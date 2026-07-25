// Slice I6 — provider-level coverage for `activeVinksProvider`'s own filtering/enrichment,
// exercising the real `_isActive`/role-branch logic against a fake repository (not overriding
// the provider wholesale, matching the established pattern in
// `activity/activity_providers_test.dart`).

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/models/vink.dart';
import 'package:vinkin_mobile/core/repositories/vink_repository.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';
import 'package:vinkin_mobile/core/networking/api_client.dart';
import 'package:vinkin_mobile/features/home/home_providers.dart';

class _FakeVinkRepository extends VinkRepository {
  _FakeVinkRepository({required this.vinks, this.snapshots = const {}, this.participantViews = const {}})
    : super(ApiClient(tokenStore: SecureTokenStore(), appVersion: Future.value('test')));

  final List<Vink> vinks;
  final Map<String, VinkSnapshot> snapshots;
  final Map<String, ParticipantVinkView> participantViews;

  @override
  Future<List<Vink>> listMyVinks({dynamic cancelToken}) async => vinks;

  @override
  Future<VinkSnapshot> getSnapshot(String vinkId, {dynamic cancelToken}) async => snapshots[vinkId]!;

  @override
  Future<ParticipantVinkView> getParticipantView(String vinkId, {dynamic cancelToken}) async =>
      participantViews[vinkId]!;
}

Vink _vink(String id, {required String state, String? role}) => Vink(
  id: id,
  publicCode: 'code-$id',
  purchaseCategory: 'GROCERY',
  state: state,
  requiredAmountMinor: 4000,
  fundedAmountMinor: 0,
  version: 1,
  organizerUserId: 'organizer-1',
  role: role,
);

const _progress = ContributionProgress(
  confirmedAmountMinor: 0,
  totalAmountMinor: 4000,
  confirmedParticipantCount: 0,
  totalParticipantCount: 1,
);

VinkSnapshot _organizerSnapshot(String vinkId, String state) => VinkSnapshot(
  vink: _vink(vinkId, state: state, role: 'organizer'),
  participants: const [
    VinkParticipant(
      id: 'organizer-1',
      displayName: 'Org',
      role: 'ORGANIZER',
      status: 'JOINED',
      allocatedAmountMinor: 4000,
    ),
  ],
  unallocatedAmountMinor: 0,
  allowedActions: const [],
  card: null,
  contributionProgress: _progress,
);

ParticipantVinkView _participantView(String state) => ParticipantVinkView(
  vink: ParticipantVinkSummary(
    purchaseCategory: 'GROCERY',
    state: state,
    requiredAmountMinor: 4000,
    confirmedAmountMinor: 0,
    confirmedParticipantCount: 0,
    totalParticipantCount: 2,
    vinkOutcome: 'open',
  ),
  participant: const ParticipantSelf(
    displayName: 'Me',
    allocatedAmountMinor: 2000,
    contributionStatus: 'not_started',
  ),
);

void main() {
  test('terminal-state Vinks (COMPLETED/CANCELLED/EXPIRED) are excluded — only active Vinks reach Home', () async {
    final repository = _FakeVinkRepository(
      vinks: [
        _vink('open-vink', state: 'OPEN', role: 'organizer'),
        _vink('done-vink', state: 'COMPLETED', role: 'organizer'),
        _vink('cancelled-vink', state: 'CANCELLED', role: 'organizer'),
        _vink('expired-vink', state: 'EXPIRED', role: 'organizer'),
      ],
      snapshots: {'open-vink': _organizerSnapshot('open-vink', 'OPEN')},
    );
    final container = ProviderContainer(overrides: [vinkRepositoryProvider.overrideWithValue(repository)]);
    addTearDown(container.dispose);

    final active = await container.read(activeVinksProvider.future);

    expect(active.map((a) => a.vink.id).toList(), ['open-vink']);
  });

  test('a mixed organizer + participant Vink list enriches each entry via the correct role-scoped fetch', () async {
    final repository = _FakeVinkRepository(
      vinks: [
        _vink('org-vink', state: 'OPEN', role: 'organizer'),
        _vink('member-vink', state: 'OPEN', role: 'participant'),
      ],
      snapshots: {'org-vink': _organizerSnapshot('org-vink', 'OPEN')},
      participantViews: {'member-vink': _participantView('OPEN')},
    );
    final container = ProviderContainer(overrides: [vinkRepositoryProvider.overrideWithValue(repository)]);
    addTearDown(container.dispose);

    final active = await container.read(activeVinksProvider.future);

    expect(active, hasLength(2));
    final org = active.firstWhere((a) => a.vink.id == 'org-vink');
    final member = active.firstWhere((a) => a.vink.id == 'member-vink');
    expect(org.vink.isOrganizerRole, isTrue);
    expect(member.vink.isOrganizerRole, isFalse);
    expect(member.contributionProgress.totalParticipantCount, 2);
  });
}
