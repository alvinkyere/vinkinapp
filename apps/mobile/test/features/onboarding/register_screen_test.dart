// ENG3 Slice 6 ("typed error mapping completion"): proves register_screen.dart's migration to
// CommandRunner/classifyFailure renders the right shared message for USERNAME_TAKEN, sourced
// from `human_errors.dart`, not a raw code or a hand-rolled string baked into the screen.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/features/onboarding/register_screen.dart';

import '../../support/fake_api_client.dart';

const _secureStorageChannel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      _secureStorageChannel,
      (call) async => call.method == 'read' ? null : true,
    );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      _secureStorageChannel,
      null,
    );
  });

  testWidgets('a taken username shows the shared USERNAME_TAKEN copy, not a raw code', (
    tester,
  ) async {
    final client = FakeApiClient((method, path, body) async {
      if (path == '/api/v1/auth/register') {
        throw const ApiException(statusCode: 409, code: 'USERNAME_TAKEN');
      }
      return {};
    });

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: const MaterialApp(home: RegisterScreen()),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextField).at(0), 'Jordan');
    await tester.enterText(find.byType(TextField).at(1), 'jordan');
    await tester.enterText(find.byType(TextField).at(4), 'a-real-password');
    await tester.tap(find.byType(VinkPrimaryButton));
    await tester.pumpAndSettle();

    expect(find.text('That username is already taken.'), findsOneWidget);
    expect(find.text('USERNAME_TAKEN'), findsNothing);
  });
}
