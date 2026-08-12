import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/models/payment_method.dart';

void main() {
  group('PaymentModeInfo (RM4C-B, D49)', () {
    test('parses a mock-mode server response with no publishable key', () {
      final info = PaymentModeInfo.fromJson({
        'mode': 'mock',
        'publishableKey': null,
        'methods': [
          {'type': 'card', 'displayName': 'Debit or credit card', 'availability': 'available'},
          {
            'type': 'apple_pay',
            'displayName': 'Apple Pay',
            'availability': 'requires_configuration',
            'unavailableReason': 'Additional Apple merchant configuration required.',
          },
        ],
      });
      expect(info.mode, FinancialProviderMode.mock);
      expect(info.publishableKey, isNull);
      final card = info.methods.firstWhere((m) => m.type == PaymentMethodType.card);
      expect(card.isAvailable, isTrue);
      expect(card.unavailableReason, isNull);
      final applePay = info.methods.firstWhere((m) => m.type == PaymentMethodType.applePay);
      expect(applePay.isAvailable, isFalse);
      expect(applePay.unavailableReason, isNotNull);
    });

    test('parses a stripe_sandbox response and carries the publishable key through', () {
      final info = PaymentModeInfo.fromJson({
        'mode': 'stripe_sandbox',
        'publishableKey': 'pk_test_abc',
        'methods': [
          {'type': 'card', 'displayName': 'Debit or credit card', 'availability': 'available'},
          {
            'type': 'venmo',
            'displayName': 'Venmo',
            'availability': 'coming_soon',
            'unavailableReason': 'Venmo is not available in this sandbox yet.',
          },
          {
            'type': 'cash_app_pay',
            'displayName': 'Cash App Pay',
            'availability': 'coming_soon',
            'unavailableReason': 'Cash App Pay is not available in this sandbox yet.',
          },
        ],
      });
      expect(info.mode, FinancialProviderMode.stripeSandbox);
      expect(info.publishableKey, 'pk_test_abc');
      expect(info.methods.length, 3);
    });
  });

  group('PaymentSessionResult (RM4C-C, D49)', () {
    test('parses a fresh session with a client secret', () {
      final result = PaymentSessionResult.fromJson({
        'contribution': {'id': 'c1', 'status': 'AUTHORIZATION_PENDING'},
        'vinkState': 'OPEN',
        'clientSecret': 'pi_123_secret_abc',
        'replayed': false,
      });
      expect(result.contributionId, 'c1');
      expect(result.contributionStatus, 'AUTHORIZATION_PENDING');
      expect(result.clientSecret, 'pi_123_secret_abc');
      expect(result.replayed, isFalse);
    });

    test('parses a replayed session with no fresh client secret', () {
      final result = PaymentSessionResult.fromJson({
        'contribution': {'id': 'c1', 'status': 'AUTHORIZATION_PENDING'},
        'vinkState': 'OPEN',
        'clientSecret': null,
        'replayed': true,
      });
      expect(result.clientSecret, isNull);
      expect(result.replayed, isTrue);
    });
  });
}
