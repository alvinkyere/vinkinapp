// ENG5 Slice 2 — the forgot-password screen only ever needs to prove: it collects an email,
// calls the request route, and shows the identical success copy regardless of what the server
// actually did with it (the account-enumeration defense is a server-side property; the client
// just has to render the one success state honestly, never a "yes that account exists" branch).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/features/onboarding/forgot_password_screen.dart';

import '../../support/fake_api_client.dart';

const _secureStorageChannel = MethodChannel(
  'plugins.it_nomads.com/flutter_secure_storage',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          _secureStorageChannel,
          (call) async => call.method == 'read' ? null : true,
        );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_secureStorageChannel, null);
  });

  testWidgets(
    'submitting an email calls the request route and shows the generic success copy',
    (tester) async {
      final client = FakeApiClient((method, path, body) async {
        if (path == '/api/v1/auth/password-reset/request') {
          expect(method, 'POST');
          expect(body, {'email': 'someone@example.com'});
          return {'status': 'REQUESTED'};
        }
        return {};
      });

      await tester.pumpWidget(
        ProviderScope(
          overrides: [apiClientProvider.overrideWithValue(client)],
          child: const MaterialApp(home: ForgotPasswordScreen()),
        ),
      );
      await tester.pump();

      await tester.enterText(find.byType(TextField), 'someone@example.com');
      await tester.tap(find.byType(VinkPrimaryButton));
      await tester.pumpAndSettle();

      expect(find.textContaining("we've sent a reset link"), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    },
  );

  testWidgets(
    'a genuine network failure shows an inline error, not the success copy',
    (tester) async {
      final client = FakeApiClient((method, path, body) async {
        if (path == '/api/v1/auth/password-reset/request') {
          throw const ApiException(statusCode: 500, code: 'INTERNAL_ERROR');
        }
        return {};
      });

      await tester.pumpWidget(
        ProviderScope(
          overrides: [apiClientProvider.overrideWithValue(client)],
          child: const MaterialApp(home: ForgotPasswordScreen()),
        ),
      );
      await tester.pump();

      await tester.enterText(find.byType(TextField), 'someone@example.com');
      await tester.tap(find.byType(VinkPrimaryButton));
      await tester.pumpAndSettle();

      expect(find.textContaining("we've sent a reset link"), findsNothing);
      expect(find.byType(TextField), findsOneWidget);
    },
  );
}
