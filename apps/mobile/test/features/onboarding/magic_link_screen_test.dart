// ENG5 Slice 3 — the two independent actions this screen offers: request a link (same
// generic-success shape as forgot-password) and complete a login by pasting either a raw
// token or a full link (proves the client-side extraction actually works, not just that a
// request is sent).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/design_system/components/vink_inline_error.dart';
import 'package:vinkin_mobile/features/onboarding/magic_link_screen.dart';

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
    'requesting a link calls the request route and shows the generic success copy',
    (tester) async {
      final client = FakeApiClient((method, path, body) async {
        if (path == '/api/v1/auth/magic-link/request') {
          expect(body, {'email': 'someone@example.com'});
          return {'status': 'REQUESTED'};
        }
        return {};
      });

      await tester.pumpWidget(
        ProviderScope(
          overrides: [apiClientProvider.overrideWithValue(client)],
          child: const MaterialApp(home: MagicLinkScreen()),
        ),
      );
      await tester.pump();

      await tester.enterText(
        find.byType(TextField).first,
        'someone@example.com',
      );
      await tester.tap(find.text('Send login link'));
      await tester.pumpAndSettle();

      expect(find.textContaining("we've sent a"), findsOneWidget);
    },
  );

  testWidgets(
    'pasting a full confirm link extracts the token and signs the user in',
    (tester) async {
      String? capturedToken;
      final client = FakeApiClient((method, path, body) async {
        if (path == '/api/v1/auth/magic-link/confirm') {
          capturedToken = body?['token'] as String?;
          return {
            'user': {
              'id': 'u1',
              'username': 'someone',
              'displayName': 'Someone',
              'email': 'someone@example.com',
              'phone': null,
              'emailVerified': true,
            },
            'accessToken': 'access-1',
            'refreshToken': 'refresh-1',
          };
        }
        return {};
      });

      await tester.pumpWidget(
        ProviderScope(
          overrides: [apiClientProvider.overrideWithValue(client)],
          child: const MaterialApp(home: MagicLinkScreen()),
        ),
      );
      await tester.pump();

      await tester.enterText(
        find.byType(TextField).last,
        'https://api.vinkin.org/api/v1/auth/magic-link/confirm?token=mlt_abc123',
      );
      await tester.tap(find.text('Log in'));
      await tester.pumpAndSettle();

      expect(capturedToken, 'mlt_abc123');
    },
  );

  testWidgets('pasting a bare token (no URL) is sent as-is', (tester) async {
    String? capturedToken;
    final client = FakeApiClient((method, path, body) async {
      if (path == '/api/v1/auth/magic-link/confirm') {
        capturedToken = body?['token'] as String?;
        return {
          'user': {
            'id': 'u1',
            'username': 'someone',
            'displayName': 'Someone',
            'email': null,
            'phone': null,
            'emailVerified': false,
          },
          'accessToken': 'access-1',
          'refreshToken': 'refresh-1',
        };
      }
      return {};
    });

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: const MaterialApp(home: MagicLinkScreen()),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextField).last, 'mlt_bareTokenXYZ');
    await tester.tap(find.text('Log in'));
    await tester.pumpAndSettle();

    expect(capturedToken, 'mlt_bareTokenXYZ');
  });

  testWidgets('an invalid token shows an inline error, not a crash', (
    tester,
  ) async {
    final client = FakeApiClient((method, path, body) async {
      if (path == '/api/v1/auth/magic-link/confirm') {
        throw const ApiException(
          statusCode: 400,
          code: 'INVALID_MAGIC_LINK_TOKEN',
        );
      }
      return {};
    });

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: const MaterialApp(home: MagicLinkScreen()),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextField).last, 'mlt_expired');
    await tester.tap(find.text('Log in'));
    await tester.pumpAndSettle();

    expect(find.byType(VinkInlineError), findsOneWidget);
  });
}
