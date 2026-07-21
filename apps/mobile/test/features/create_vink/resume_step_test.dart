import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/models/vink.dart';
import 'package:vinkin_mobile/features/create_vink/create_vink_screen.dart';

VinkSnapshot _snapshot({required int unallocatedAmountMinor}) => VinkSnapshot(
  vink: const Vink(
    id: 'vink-1',
    publicCode: 'ABCDEF1234',
    purchaseCategory: 'GROCERY',
    state: 'DRAFT',
    requiredAmountMinor: 12000,
    fundedAmountMinor: 0,
    version: 1,
    organizerUserId: 'organizer-1',
  ),
  participants: const [],
  unallocatedAmountMinor: unallocatedAmountMinor,
  allowedActions: const [],
  card: null,
);

void main() {
  group('ENG1 #5: resumeStepFor — a persisted DRAFT resumes at its exact valid step', () {
    test('no other participants yet → Add people (step 2)', () {
      final step = resumeStepFor(_snapshot(unallocatedAmountMinor: 12000), hasOtherParticipants: false);
      expect(step, 2);
    });

    test('participants exist but the split is incomplete → Split (step 3)', () {
      final step = resumeStepFor(_snapshot(unallocatedAmountMinor: 4000), hasOtherParticipants: true);
      expect(step, 3);
    });

    test('participants exist and the split is fully allocated → Review (step 4)', () {
      final step = resumeStepFor(_snapshot(unallocatedAmountMinor: 0), hasOtherParticipants: true);
      expect(step, 4);
    });

    test('no other participants takes priority even if somehow already fully allocated', () {
      // Can't really happen (the organizer alone can't cover 100% under the app's own rules)
      // but the function must still be unambiguous about which case wins.
      final step = resumeStepFor(_snapshot(unallocatedAmountMinor: 0), hasOtherParticipants: false);
      expect(step, 2);
    });
  });
}
