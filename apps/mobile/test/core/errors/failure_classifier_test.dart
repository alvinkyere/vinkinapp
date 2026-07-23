import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/core/errors/failure_classifier.dart';

ClassifiedFailure _classify(int statusCode, String code) =>
    classifyFailure(ApiException(statusCode: statusCode, code: code));

void main() {
  group('ENG1 #3: classifyFailure — typed retry classification', () {
    test('a non-ApiException (raw network/parse failure) classifies as retryable', () {
      final result = classifyFailure(Exception('socket closed'));
      expect(result.category, FailureCategory.retryable);
      expect(result.canRetry, isTrue);
      expect(result.requiresSignIn, isFalse);
    });

    test('401 is authenticationRequired and demands sign-in, never a retry', () {
      final result = _classify(401, 'UNAUTHENTICATED');
      expect(result.category, FailureCategory.authenticationRequired);
      expect(result.requiresSignIn, isTrue);
      expect(result.canRetry, isFalse);
    });

    test('PARTICIPANT_ALREADY_ADDED and INVITE_ALREADY_SENT are alreadyCompleted, not errors', () {
      for (final code in ['PARTICIPANT_ALREADY_ADDED', 'INVITE_ALREADY_SENT']) {
        final result = _classify(409, code);
        expect(result.category, FailureCategory.alreadyCompleted, reason: code);
        expect(result.canRetry, isFalse, reason: '$code: retrying would just repeat the duplicate');
        expect(result.shouldRefreshState, isTrue, reason: '$code: the client\'s view is what\'s stale');
        expect(result.requiresSignIn, isFalse, reason: code);
      }
    });

    test('VINK_VERSION_CONFLICT is conflict: retry only makes sense after a refresh', () {
      final result = _classify(409, 'VINK_VERSION_CONFLICT');
      expect(result.category, FailureCategory.conflict);
      expect(result.shouldRefreshState, isTrue);
      expect(result.canRetry, isTrue);
    });

    test('ILLEGAL_TRANSITION (e.g. a double-tapped Open/Cancel) is conflict too', () {
      final result = _classify(409, 'ILLEGAL_TRANSITION');
      expect(result.category, FailureCategory.conflict);
      expect(result.shouldRefreshState, isTrue);
    });

    test('VINK_NOT_JOINABLE, PARTICIPANT_EXITED, GUEST_UNAUTHENTICATED are expired, not retryable', () {
      for (final code in ['VINK_NOT_JOINABLE', 'PARTICIPANT_EXITED', 'GUEST_UNAUTHENTICATED']) {
        final result = _classify(410, code);
        expect(result.category, FailureCategory.expired, reason: code);
        expect(result.canRetry, isFalse, reason: '$code: retrying the identical request cannot help');
      }
    });

    test('VINK_NOT_FOUND, PARTICIPANT_NOT_FOUND, USER_NOT_FOUND, FORBIDDEN are terminal', () {
      for (final code in ['VINK_NOT_FOUND', 'PARTICIPANT_NOT_FOUND', 'USER_NOT_FOUND', 'FORBIDDEN']) {
        final result = _classify(404, code);
        expect(result.category, FailureCategory.terminal, reason: code);
        expect(result.canRetry, isFalse, reason: code);
      }
    });

    test('ENG3: APP_VERSION_UNSUPPORTED (426) is terminal — an update, not a retry, is the only way forward', () {
      final result = _classify(426, 'APP_VERSION_UNSUPPORTED');
      expect(result.category, FailureCategory.terminal);
      expect(result.canRetry, isFalse);
      expect(result.requiresSignIn, isFalse);
      expect(result.message, 'This version of VinkIn is no longer supported. Please update the app.');
    });

    test('INVALID_SPLIT, UNSUPPORTED_SPLIT_METHOD, VALIDATION_FAILED, INVALID_AMOUNT are validation', () {
      for (final code in ['INVALID_SPLIT', 'UNSUPPORTED_SPLIT_METHOD', 'VALIDATION_FAILED', 'INVALID_AMOUNT']) {
        final result = _classify(422, code);
        expect(result.category, FailureCategory.validation, reason: code);
        expect(result.canRetry, isFalse, reason: '$code: the identical input will fail identically');
      }
    });

    test('RATE_LIMITED and 5xx are retryable', () {
      expect(_classify(429, 'RATE_LIMITED').category, FailureCategory.retryable);
      expect(_classify(503, 'SOME_SERVER_CODE').category, FailureCategory.retryable);
    });

    test('an unmapped code (e.g. AUTHORIZATION_DECLINED) falls back to unknown but still allows retry', () {
      final result = _classify(422, 'AUTHORIZATION_DECLINED');
      expect(result.category, FailureCategory.unknown);
      expect(result.canRetry, isTrue);
    });

    test('every classified message is human copy, never the raw code', () {
      for (final code in [
        'PARTICIPANT_ALREADY_ADDED',
        'VINK_VERSION_CONFLICT',
        'VINK_NOT_JOINABLE',
        'VINK_NOT_FOUND',
        'INVALID_SPLIT',
      ]) {
        final result = _classify(400, code);
        expect(result.message, isNot(contains(code)));
        expect(result.message, isNotEmpty);
      }
    });

    test('no category ever both requires sign-in and offers a retry', () {
      for (final code in [
        'UNAUTHENTICATED',
        'PARTICIPANT_ALREADY_ADDED',
        'VINK_VERSION_CONFLICT',
        'VINK_NOT_JOINABLE',
        'VINK_NOT_FOUND',
        'INVALID_SPLIT',
        'RATE_LIMITED',
        'AUTHORIZATION_DECLINED',
      ]) {
        final result = _classify(code == 'UNAUTHENTICATED' ? 401 : 400, code);
        if (result.requiresSignIn) expect(result.canRetry, isFalse, reason: code);
      }
    });
  });
}
