// Slice I2B — role parsing on the shared Vink model, and the new ParticipantVinkView wire
// shape (`packages/application/src/guest.ts`'s ParticipantVinkView).

import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/models/vink.dart';

Map<String, dynamic> _rawVink({String? role}) => {
  'id': 'vink-1',
  'publicCode': 'ABC123',
  'purchaseCategory': 'GROCERY',
  'state': 'OPEN',
  'requiredAmount': {'amountMinor': 4000},
  'fundedAmount': {'amountMinor': 0},
  'version': 1,
  'organizerUserId': 'organizer-1',
  'role': role,
};

void main() {
  group('Vink.fromJson role parsing (Slice I2B)', () {
    test(
      'role absent (flag-off / pre-I2B server) parses to null and isOrganizerRole true',
      () {
        final vink = Vink.fromJson(_rawVink());
        expect(vink.role, isNull);
        expect(vink.isOrganizerRole, isTrue);
      },
    );

    test("role: 'organizer' parses through and isOrganizerRole is true", () {
      final vink = Vink.fromJson(_rawVink(role: 'organizer'));
      expect(vink.role, 'organizer');
      expect(vink.isOrganizerRole, isTrue);
    });

    test("role: 'participant' parses through and isOrganizerRole is false", () {
      final vink = Vink.fromJson(_rawVink(role: 'participant'));
      expect(vink.role, 'participant');
      expect(vink.isOrganizerRole, isFalse);
    });
  });

  group('ParticipantVinkView.fromJson (Slice I2B)', () {
    test('parses the full wire shape from getParticipantVinkView', () {
      final view = ParticipantVinkView.fromJson({
        'vink': {
          'purchaseCategory': 'GROCERY',
          'state': 'RESTRICTED',
          'requiredAmountMinor': 12000,
          'contributionProgress': {
            'confirmedAmountMinor': 12000,
            'totalAmountMinor': 12000,
            'confirmedParticipantCount': 3,
            'totalParticipantCount': 3,
          },
          'vinkOutcome': 'completed',
        },
        'participant': {
          'displayName': 'Member A',
          'allocatedAmountMinor': 5000,
          'contributionStatus': 'confirmed',
        },
      });

      expect(view.vink.state, 'RESTRICTED');
      expect(view.vink.vinkOutcome, 'completed');
      expect(view.vink.confirmedAmountMinor, 12000);
      expect(view.vink.confirmedParticipantCount, 3);
      expect(view.vink.totalParticipantCount, 3);
      expect(view.participant.displayName, 'Member A');
      expect(view.participant.allocatedAmountMinor, 5000);
      expect(view.participant.contributionStatus, 'confirmed');
    });
  });
}
