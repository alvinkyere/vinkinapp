// ENG3 Slice 6 ("typed error mapping completion"): proves login_screen.dart's migration to
// CommandRunner/classifyFailure actually renders the right message for the one code this
// screen cares about, sourced from the shared table (`human_errors.dart`), not a raw code or
// a hand-rolled string baked into the screen itself.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/features/onboarding/login_screen.dart';

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

  testWidgets('a wrong password shows the shared INVALID_CREDENTIALS copy, not a raw code', (
    tester,
  ) async {
    final client = FakeApiClient((method, path, body) async {
      if (path == '/api/v1/auth/login') {
        throw const ApiException(statusCode: 401, code: 'INVALID_CREDENTIALS');
      }
      return {};
    });

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: const MaterialApp(home: LoginScreen()),
      ),
    );
    await tester.pump(); // let AuthController.build()'s _restoreSession settle

    await tester.enterText(find.byType(TextField).at(0), 'someone');
    await tester.enterText(find.byType(TextField).at(1), 'wrong-password');
    await tester.tap(find.byType(VinkPrimaryButton));
    await tester.pumpAndSettle();

    expect(find.text('Incorrect username or password.'), findsOneWidget);
    expect(find.text('INVALID_CREDENTIALS'), findsNothing);
  });
}
