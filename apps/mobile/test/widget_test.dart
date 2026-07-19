// Smoke test: the app boots to the Welcome screen when no session is stored. Real
// end-to-end verification for PV9 happens on the iOS Simulator against the live backend
// (see the PV9 milestone report) — this test only proves the widget tree assembles.

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/app/app.dart';

void main() {
  // flutter_secure_storage has no real Keychain in the test harness — stub the channel to
  // report "nothing stored", exactly what a fresh install looks like.
  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      (call) async => call.method == 'read' ? null : true,
    );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
  });

  testWidgets('boots to the Welcome screen with no stored session', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    expect(find.text('VinkIn'), findsOneWidget);
    expect(find.text('Create an account'), findsOneWidget);
  });
}
