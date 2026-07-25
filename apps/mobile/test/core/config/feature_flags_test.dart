import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/config/feature_flags.dart';

void main() {
  test(
    'the approved reference UI is the default build',
    () {
      expect(FeatureFlags.canonicalCreateFlow, isTrue);
      expect(FeatureFlags.homeActivityV2, isTrue);
      expect(FeatureFlags.invitesEnabled, isTrue);
      expect(FeatureFlags.inkProgressVessel, isTrue);
    },
  );
}
