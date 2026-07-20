import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/components/vink_status_badge.dart';

void main() {
  const allD11States = [
    'DRAFT',
    'OPEN',
    'SUBMISSIONS_CLOSED',
    'PROCESSING_GRACE',
    'FUNDED',
    'CARD_PROVISIONING',
    'CARD_READY',
    'FUNDING_REVERSAL',
    'PURCHASE_AUTHORIZED',
    'SETTLING',
    'COMPLETED',
    'RECOVERY_REQUIRED',
    'RECOVERY_PENDING',
    'CANCELLED',
    'RESTRICTED',
    'EXPIRED',
  ];

  test('every canonical D11 vink state has a human label distinct from its raw name', () {
    for (final state in allD11States) {
      final label = vinkStatusLabel(state);
      expect(label, isNot(equals(state)), reason: '$state must never be shown to a user verbatim');
      // No SCREAMING_SNAKE_CASE / underscores leaking through into the human label.
      expect(label, isNot(contains('_')), reason: '$state -> "$label" still looks like a backend name');
    }
  });
}
