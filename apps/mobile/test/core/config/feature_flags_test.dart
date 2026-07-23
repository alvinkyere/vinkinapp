import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/config/feature_flags.dart';

void main() {
  test('canonicalCreateFlow defaults to off — a build with no --dart-define gets the '
      'five-step wizard, unchanged', () {
    expect(FeatureFlags.canonicalCreateFlow, isFalse);
  });
}
