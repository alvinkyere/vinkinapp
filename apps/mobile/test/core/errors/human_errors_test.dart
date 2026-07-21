import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/core/errors/human_errors.dart';

void main() {
  const knownCodes = [
    'USER_NOT_FOUND',
    'VINK_NOT_FOUND',
    'VINK_NOT_JOINABLE',
    'VINK_VERSION_CONFLICT',
    'PARTICIPANT_NOT_FOUND',
    'PARTICIPANT_EXITED',
    'PARTICIPANT_ALREADY_ADDED',
    'INVITE_ALREADY_SENT',
    'INVALID_SPLIT',
    'UNSUPPORTED_SPLIT_METHOD',
    'AUTHORIZATION_DECLINED',
    'FORBIDDEN',
    'VALIDATION_FAILED',
    'RATE_LIMITED',
    'GUEST_UNAUTHENTICATED',
    'INVALID_AMOUNT',
  ];

  test('every real backend error code maps to human copy, never the raw code', () {
    for (final code in knownCodes) {
      final message = humanErrorMessage(ApiException(statusCode: 422, code: code));
      expect(message, isNot(contains(code)), reason: '$code leaked into user-facing copy');
      expect(message, isNot(equals(code)));
    }
  });

  test('an unrecognized error code still gets human, non-blaming copy — never a raw code', () {
    final message = humanErrorMessage(const ApiException(statusCode: 500, code: 'SOME_FUTURE_CODE'));
    expect(message, isNot(contains('SOME_FUTURE_CODE')));
    expect(message, isNotEmpty);
  });

  test('AUTHORIZATION_DECLINED copy is reassuring: nothing was charged', () {
    final message = humanErrorMessage(const ApiException(statusCode: 422, code: 'AUTHORIZATION_DECLINED'));
    expect(message.toLowerCase(), contains('nothing was charged'));
  });
}
