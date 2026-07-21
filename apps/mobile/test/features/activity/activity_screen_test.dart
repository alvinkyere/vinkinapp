// Slice I2B — Activity screen empty state still renders correctly once its underlying vink
// list can include participant-role vinks (recentActivityProvider itself is unaffected by
// I2B for participant-role entries — see the I2B completion report's own flagged gap: no
// customer-safe activity-feed endpoint exists yet for a mere participant, so this screen's
// per-vink `/activity` fetch stays organizer-only for now). This test only proves the screen
// doesn't regress/crash under the new response shape.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/features/activity/activity_providers.dart';
import 'package:vinkin_mobile/features/activity/activity_screen.dart';

void main() {
  testWidgets('Activity empty state renders when there is no activity', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          recentActivityProvider.overrideWith((ref) async => const []),
        ],
        child: const MaterialApp(home: ActivityScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Nothing here yet'), findsOneWidget);
  });
}
