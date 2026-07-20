import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/components/vink_participant_row.dart';
import 'package:vinkin_mobile/features/vink_lobby/participant_payment_state.dart';

void main() {
  test('no contribution attempt yet reads as waiting', () {
    expect(paymentStateFor(null), VinkParticipantPaymentState.waiting);
  });

  test('in-flight statuses read as processing', () {
    for (final status in ['CREATED', 'AUTHORIZATION_PENDING', 'RESOLUTION_PENDING', 'CAPTURE_PENDING', 'CANCELLATION_PENDING']) {
      expect(paymentStateFor(status), VinkParticipantPaymentState.processing, reason: status);
    }
  });

  test('settled-success statuses read as paid', () {
    for (final status in ['AUTHORIZED', 'CAPTURED', 'SETTLED']) {
      expect(paymentStateFor(status), VinkParticipantPaymentState.paid, reason: status);
    }
  });

  test('a declined or cancelled attempt reads as waiting again, not paid', () {
    expect(paymentStateFor('DECLINED'), VinkParticipantPaymentState.waiting);
    expect(paymentStateFor('CANCELLED'), VinkParticipantPaymentState.waiting);
  });
}
