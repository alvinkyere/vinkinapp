import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/features/create_vink/canonical/delivery_mode.dart';

void main() {
  group('DeliveryMode wire contract (mirrors inviteGuestSchema, I4B)', () {
    test('wire values are the exact lowercase strings the API expects', () {
      expect(DeliveryMode.sms.wireValue, 'sms');
      expect(DeliveryMode.email.wireValue, 'email');
      expect(DeliveryMode.manual.wireValue, 'manual');
    });

    test('fromWireValue round-trips the uppercase value the API echoes back', () {
      expect(DeliveryMode.fromWireValue('SMS'), DeliveryMode.sms);
      expect(DeliveryMode.fromWireValue('EMAIL'), DeliveryMode.email);
      expect(DeliveryMode.fromWireValue('MANUAL'), DeliveryMode.manual);
      expect(DeliveryMode.fromWireValue('sms'), DeliveryMode.sms); // case-insensitive
    });

    test('fromWireValue is null for an absent/unknown value — never guesses', () {
      expect(DeliveryMode.fromWireValue(null), isNull);
      expect(DeliveryMode.fromWireValue('carrier_pigeon'), isNull);
    });

    test('Percentage is not a value in this enum at all — no such option exists to select (D22)', () {
      expect(DeliveryMode.values.length, 3);
      expect(DeliveryMode.values, containsAll([DeliveryMode.sms, DeliveryMode.email, DeliveryMode.manual]));
    });
  });

  group('validateContactDestination — SMS requires a phone destination', () {
    test('rejects an empty phone', () {
      expect(validateContactDestination(DeliveryMode.sms, ''), isNotNull);
      expect(validateContactDestination(DeliveryMode.sms, '   '), isNotNull);
    });

    test('rejects an obviously-not-a-phone string', () {
      expect(validateContactDestination(DeliveryMode.sms, 'not-a-phone'), isNotNull);
      expect(validateContactDestination(DeliveryMode.sms, 'abc'), isNotNull);
    });

    test('accepts a plausibly-shaped phone number', () {
      expect(validateContactDestination(DeliveryMode.sms, '+15551234567'), isNull);
      expect(validateContactDestination(DeliveryMode.sms, '5551234567'), isNull);
    });
  });

  group('validateContactDestination — EMAIL requires an email destination', () {
    test('rejects an empty email', () {
      expect(validateContactDestination(DeliveryMode.email, ''), isNotNull);
    });

    test('rejects an obviously-not-an-email string', () {
      expect(validateContactDestination(DeliveryMode.email, 'not-an-email'), isNotNull);
      expect(validateContactDestination(DeliveryMode.email, 'missing-at-sign.com'), isNotNull);
    });

    test('accepts a plausibly-shaped email address', () {
      expect(validateContactDestination(DeliveryMode.email, 'guest@example.com'), isNull);
    });
  });

  group('validateContactDestination — MANUAL requires no automatic-delivery destination', () {
    test('always valid regardless of what is passed — manual never sends it to the API', () {
      expect(validateContactDestination(DeliveryMode.manual, ''), isNull);
      expect(validateContactDestination(DeliveryMode.manual, 'garbage'), isNull);
    });
  });

  group('customer-safe expectation copy — no provider/diagnostic language', () {
    test('every mode has a short, customer-safe expectation caption', () {
      for (final mode in DeliveryMode.values) {
        expect(mode.shortExpectation, isNotEmpty);
        expect(mode.shortExpectation.toLowerCase(), isNot(contains('provider')));
        expect(mode.shortExpectation.toLowerCase(), isNot(contains('accepted')));
        expect(mode.shortExpectation.toLowerCase(), isNot(contains('attempt')));
      }
    });
  });
}
