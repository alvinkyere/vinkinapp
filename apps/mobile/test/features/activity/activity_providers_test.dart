// Slice I2D — regression coverage for the real bug found while building participant-inclusive
// Activity: `recentActivityProvider` called the organizer-only `getActivity` for EVERY vink
// `myVinksProvider` returned, including participant-role ones (possible since Slice I2A) — an
// unhandled 403 inside the merge loop failed the ENTIRE feed for any user who is a participant
// on even one Vink, not just that one vink's entries. `activity_screen_test.dart` never caught
// this because it overrides `recentActivityProvider` wholesale instead of exercising its real
// merge logic. This file drives the real provider against a fake repository instead.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/models/activity_entry.dart';
import 'package:vinkin_mobile/core/models/vink.dart';
import 'package:vinkin_mobile/core/repositories/vink_repository.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';
import 'package:vinkin_mobile/core/networking/api_client.dart';
import 'package:vinkin_mobile/features/activity/activity_providers.dart';

class _FakeVinkRepository extends VinkRepository {
  _FakeVinkRepository({
    required this.vinks,
    this.organizerActivity = const [],
    this.participantActivity = const [],
    this.activityByVinkId = const {},
    this.failingVinkIds = const {},
  }) : super(
         ApiClient(
           tokenStore: SecureTokenStore(),
           appVersion: Future.value('test'),
         ),
       );

  final List<Vink> vinks;
  final List<ActivityEntry> organizerActivity;
  final List<ActivityEntry> participantActivity;

  /// Slice I6 — per-vink override, for tests (like `vinkOutcomesProvider`'s own) that need a
  /// DIFFERENT activity feed per vink rather than one shared list for the whole role.
  final Map<String, List<ActivityEntry>> activityByVinkId;

  /// Slice I6 — any vinkId in this set throws when its own activity is fetched, simulating a
  /// transient per-vink failure for the partial-failure-resilience regression tests.
  final Set<String> failingVinkIds;
  int organizerCalls = 0;
  int participantCalls = 0;

  @override
  Future<List<Vink>> listMyVinks({dynamic cancelToken}) async => vinks;

  @override
  Future<List<ActivityEntry>> getActivity(
    String vinkId, {
    dynamic cancelToken,
  }) async {
    organizerCalls++;
    if (failingVinkIds.contains(vinkId)) {
      throw Exception('simulated failure for $vinkId');
    }
    return activityByVinkId[vinkId] ?? organizerActivity;
  }

  @override
  Future<List<ActivityEntry>> getParticipantActivity(
    String vinkId, {
    dynamic cancelToken,
  }) async {
    participantCalls++;
    if (failingVinkIds.contains(vinkId)) {
      throw Exception('simulated failure for $vinkId');
    }
    return activityByVinkId[vinkId] ?? participantActivity;
  }
}

Vink _vink(String id, {String? role, String state = 'OPEN', String? purpose}) =>
    Vink(
      id: id,
      publicCode: 'code-$id',
      purchaseCategory: 'GROCERY',
      state: state,
      requiredAmountMinor: 8000,
      fundedAmountMinor: 0,
      version: 1,
      organizerUserId: 'someone',
      role: role,
      purpose: purpose,
    );

ActivityEntry _entry(String eventType) => ActivityEntry(
  kind: 'event',
  at: DateTime.utc(2026, 1, 1),
  detail: {'eventType': eventType},
);

void main() {
  test(
    'REGRESSION: a mixed organizer-role + participant-role vink list no longer throws — both feeds merge',
    () async {
      final repository = _FakeVinkRepository(
        vinks: [
          _vink('organizer-vink', role: 'organizer'),
          _vink('participant-vink', role: 'participant'),
        ],
        organizerActivity: [_entry('VinkOpened')],
        participantActivity: [_entry('VinkFunded')],
      );
      final container = ProviderContainer(
        overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      final result = await container.read(recentActivityProvider.future);

      expect(result.entries, hasLength(2));
      expect(result.failedCount, 0);
      expect(
        repository.organizerCalls,
        1,
        reason: 'only the organizer-role vink used getActivity',
      );
      expect(
        repository.participantCalls,
        1,
        reason: 'only the participant-role vink used getParticipantActivity',
      );
    },
  );

  test(
    'each entry carries the correct isOrganizerRole for its own source vink, not a global flag',
    () async {
      final repository = _FakeVinkRepository(
        vinks: [
          _vink('organizer-vink', role: 'organizer'),
          _vink('participant-vink', role: 'participant'),
        ],
        organizerActivity: [_entry('VinkCreated')],
        participantActivity: [_entry('VinkCreated')],
      );
      final container = ProviderContainer(
        overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      final result = await container.read(recentActivityProvider.future);

      final organizerEntry = result.entries.firstWhere(
        (e) => e.vinkId == 'organizer-vink',
      );
      final participantEntry = result.entries.firstWhere(
        (e) => e.vinkId == 'participant-vink',
      );
      expect(organizerEntry.isOrganizerRole, isTrue);
      expect(participantEntry.isOrganizerRole, isFalse);
    },
  );

  test(
    'a vink with no role (pre-I2B/flag-off shape) is treated as organizer, unchanged',
    () async {
      final repository = _FakeVinkRepository(
        vinks: [_vink('legacy-vink')], // role: null
        organizerActivity: [_entry('VinkOpened')],
        participantActivity: [],
      );
      final container = ProviderContainer(
        overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      final result = await container.read(recentActivityProvider.future);

      expect(result.entries, hasLength(1));
      expect(repository.organizerCalls, 1);
      expect(repository.participantCalls, 0);
    },
  );

  test(
    "PARTIAL-FAILURE RESILIENCE: one vink's activity fetch failing doesn't crash the others — "
    'they still render, and failedCount reflects the one that failed',
    () async {
      final repository = _FakeVinkRepository(
        vinks: [
          _vink('good-vink', role: 'organizer'),
          _vink('bad-vink', role: 'organizer'),
        ],
        organizerActivity: [_entry('VinkOpened')],
        failingVinkIds: {'bad-vink'},
      );
      final container = ProviderContainer(
        overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      final result = await container.read(recentActivityProvider.future);

      expect(result.entries, hasLength(1), reason: 'good-vink still renders');
      expect(result.entries.single.vinkId, 'good-vink');
      expect(result.failedCount, 1);
    },
  );

  group('vinkOutcomesProvider (Slice I6, Phase 3 §4/D29)', () {
    test(
      'includes only terminal-state vinks — OPEN is excluded, not yet an outcome',
      () async {
        final repository = _FakeVinkRepository(
          vinks: [
            _vink('open-vink', state: 'OPEN'),
            _vink('done-vink', state: 'COMPLETED'),
          ],
          activityByVinkId: {
            'done-vink': [_entry('VinkCompleted')],
          },
        );
        final container = ProviderContainer(
          overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
        );
        addTearDown(container.dispose);

        final result = await container.read(vinkOutcomesProvider.future);
        final outcomes = result.summaries;

        expect(outcomes.map((o) => o.vinkId), ['done-vink']);
        expect(outcomes.single.outcomeLabel, 'completed');
      },
    );

    test('maps CANCELLED/EXPIRED to their own outcome labels', () async {
      final repository = _FakeVinkRepository(
        vinks: [
          _vink('cancelled-vink', state: 'CANCELLED'),
          _vink('expired-vink', state: 'EXPIRED'),
        ],
        activityByVinkId: {
          'cancelled-vink': [_entry('VinkCancelled')],
          'expired-vink': [_entry('VinkExpired')],
        },
      );
      final container = ProviderContainer(
        overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      final result = await container.read(vinkOutcomesProvider.future);
      final outcomes = result.summaries;

      final byId = {for (final o in outcomes) o.vinkId: o.outcomeLabel};
      expect(byId['cancelled-vink'], 'cancelled');
      expect(byId['expired-vink'], 'expired');
    });

    test(
      'date comes from the milestone event\'s own timestamp, not the fetch time',
      () async {
        final milestoneAt = DateTime.utc(2026, 3, 15, 10, 30);
        final repository = _FakeVinkRepository(
          vinks: [_vink('done-vink', state: 'COMPLETED')],
          activityByVinkId: {
            'done-vink': [
              ActivityEntry(
                kind: 'event',
                at: milestoneAt,
                detail: {'eventType': 'VinkCompleted'},
              ),
            ],
          },
        );
        final container = ProviderContainer(
          overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
        );
        addTearDown(container.dispose);

        final result = await container.read(vinkOutcomesProvider.future);
        final outcomes = result.summaries;

        expect(outcomes.single.date, milestoneAt);
      },
    );

    test(
      'vinkTitle prefers the real purpose (D39) over the category label',
      () async {
        final repository = _FakeVinkRepository(
          vinks: [
            _vink('done-vink', state: 'COMPLETED', purpose: 'Team Lunch'),
          ],
          activityByVinkId: {
            'done-vink': [_entry('VinkCompleted')],
          },
        );
        final container = ProviderContainer(
          overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
        );
        addTearDown(container.dispose);

        final result = await container.read(vinkOutcomesProvider.future);
        final outcomes = result.summaries;

        expect(outcomes.single.vinkTitle, 'Team Lunch');
      },
    );

    test('falls back to the category label when purpose is null', () async {
      final repository = _FakeVinkRepository(
        vinks: [_vink('done-vink', state: 'COMPLETED')],
        activityByVinkId: {
          'done-vink': [_entry('VinkCompleted')],
        },
      );
      final container = ProviderContainer(
        overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      final result = await container.read(vinkOutcomesProvider.future);
      final outcomes = result.summaries;

      expect(outcomes.single.vinkTitle, 'Groceries');
    });

    test('newest first', () async {
      final older = DateTime.utc(2026, 1, 1);
      final newer = DateTime.utc(2026, 2, 1);
      final repository = _FakeVinkRepository(
        vinks: [
          _vink('older-vink', state: 'COMPLETED'),
          _vink('newer-vink', state: 'COMPLETED'),
        ],
        activityByVinkId: {
          'older-vink': [
            ActivityEntry(
              kind: 'event',
              at: older,
              detail: {'eventType': 'VinkCompleted'},
            ),
          ],
          'newer-vink': [
            ActivityEntry(
              kind: 'event',
              at: newer,
              detail: {'eventType': 'VinkCompleted'},
            ),
          ],
        },
      );
      final container = ProviderContainer(
        overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      final result = await container.read(vinkOutcomesProvider.future);
      final outcomes = result.summaries;

      expect(outcomes.map((o) => o.vinkId).toList(), [
        'newer-vink',
        'older-vink',
      ]);
    });

    test(
      "PARTIAL-FAILURE RESILIENCE: one terminal vink's activity fetch failing doesn't crash "
      'the others',
      () async {
        final repository = _FakeVinkRepository(
          vinks: [
            _vink('good-vink', state: 'COMPLETED'),
            _vink('bad-vink', state: 'CANCELLED'),
          ],
          activityByVinkId: {
            'good-vink': [_entry('VinkCompleted')],
          },
          failingVinkIds: {'bad-vink'},
        );
        final container = ProviderContainer(
          overrides: [vinkRepositoryProvider.overrideWithValue(repository)],
        );
        addTearDown(container.dispose);

        final result = await container.read(vinkOutcomesProvider.future);

        expect(result.summaries, hasLength(1));
        expect(result.summaries.single.vinkId, 'good-vink');
        expect(result.failedCount, 1);
      },
    );
  });
}
