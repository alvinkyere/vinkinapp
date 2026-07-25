import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/models/activity_entry.dart';
import 'package:vinkin_mobile/features/activity/activity_copy.dart';

ActivityEntry _entryFor(String eventType) =>
    ActivityEntry(kind: 'transition', at: DateTime.utc(2026, 1, 1), detail: {'eventType': eventType});

void main() {
  const knownEventTypes = [
    'VinkCreated',
    'ParticipantJoined',
    'ParticipantAllocationChanged',
    'VinkOpened',
    'ContributionAuthorized',
    'ContributionCaptured',
    'VinkFunded',
    'TemporaryCardIssued',
    'MerchantAuthorizationApproved',
    'PurchaseCaptured',
    'VinkCompleted',
    'VinkCancelled',
    'VinkExpired',
    'RefundIssued',
  ];

  test('every known domain event maps to copy naming the vink, never the raw event name', () {
    for (final eventType in knownEventTypes) {
      final copy = activityCopy(_entryFor(eventType), vinkTitle: 'Dinner');
      expect(copy, contains('Dinner'), reason: eventType);
      expect(copy, isNot(contains(eventType)), reason: '$eventType leaked into user-facing copy');
    }
  });

  test('an unrecognized event still produces vink-naming copy instead of throwing', () {
    final copy = activityCopy(_entryFor('SomeFutureEvent'), vinkTitle: 'Dinner');
    expect(copy, contains('Dinner'));
    expect(copy, isNot(contains('SomeFutureEvent')));
  });

  group('Slice I2D — isOrganizerViewer', () {
    test('defaults to true — every existing call site is byte-for-byte unchanged', () {
      expect(
        activityCopy(_entryFor('VinkCreated'), vinkTitle: 'Dinner'),
        'You started Dinner',
      );
      expect(
        activityCopy(_entryFor('VinkCancelled'), vinkTitle: 'Dinner'),
        'You cancelled Dinner',
      );
    });

    test('VinkCreated/VinkCancelled render neutral copy for a participant viewer — never "You"', () {
      final created = activityCopy(_entryFor('VinkCreated'), vinkTitle: 'Dinner', isOrganizerViewer: false);
      final cancelled = activityCopy(
        _entryFor('VinkCancelled'),
        vinkTitle: 'Dinner',
        isOrganizerViewer: false,
      );
      expect(created, isNot(contains('You')));
      expect(cancelled, isNot(contains('You')));
      expect(created, 'This Vink was created');
      expect(cancelled, 'This Vink was cancelled');
    });

    test('every other event type is unaffected by isOrganizerViewer', () {
      final unaffected = knownEventTypes.where((t) => t != 'VinkCreated' && t != 'VinkCancelled');
      for (final eventType in unaffected) {
        final asOrganizer = activityCopy(_entryFor(eventType), vinkTitle: 'Dinner');
        final asParticipant = activityCopy(
          _entryFor(eventType),
          vinkTitle: 'Dinner',
          isOrganizerViewer: false,
        );
        expect(asParticipant, asOrganizer, reason: eventType);
      }
    });
  });
}
