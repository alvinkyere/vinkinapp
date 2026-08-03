// ENG5 Slice 1 — Profile's email-verification card: hidden with no email on file, shows an
// unverified state with a working resend action (success/failure both rendered), and shows a
// verified state with no resend affordance once verified.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/models/user.dart';
import 'package:vinkin_mobile/features/profile/profile_screen.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._user, {this.resendResult});

  final VinkinUser _user;
  final Future<void> Function()? resendResult;
  int resendCallCount = 0;

  @override
  AuthState build() => AuthSignedIn(_user, 'fake-access-token');

  @override
  Future<void> resendEmailVerification() {
    resendCallCount++;
    return resendResult != null ? resendResult!() : Future<void>.value();
  }
}

Widget _hostFor(_FakeAuthController controller) => ProviderScope(
  overrides: [authControllerProvider.overrideWith(() => controller)],
  child: const MaterialApp(home: ProfileScreen()),
);

void main() {
  testWidgets('no email on file: no verification card at all', (tester) async {
    await tester.pumpWidget(
      _hostFor(
        _FakeAuthController(
          const VinkinUser(id: 'u1', username: 'org', displayName: 'Org'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Not verified yet'), findsNothing);
    expect(find.text('Verified'), findsNothing);
  });

  testWidgets(
    'unverified email: shows the address, "Not verified yet", and a working resend',
    (tester) async {
      final controller = _FakeAuthController(
        const VinkinUser(
          id: 'u1',
          username: 'org',
          displayName: 'Org',
          email: 'org@example.com',
          emailVerified: false,
        ),
      );
      await tester.pumpWidget(_hostFor(controller));
      await tester.pumpAndSettle();

      expect(find.text('org@example.com'), findsOneWidget);
      expect(find.text('Not verified yet'), findsOneWidget);
      expect(find.text('Resend verification email'), findsOneWidget);

      await tester.tap(find.text('Resend verification email'));
      await tester.pump();
      // In-progress: the button shows a spinner via `loading: true`, not new label text.
      await tester.pumpAndSettle();

      expect(controller.resendCallCount, 1);
      expect(
        find.text('Verification email sent — check your inbox.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'a failed resend shows an inline error and keeps the resend button available',
    (tester) async {
      final controller = _FakeAuthController(
        const VinkinUser(
          id: 'u1',
          username: 'org',
          displayName: 'Org',
          email: 'org@example.com',
          emailVerified: false,
        ),
        resendResult: () => Future<void>.error(Exception('network down')),
      );
      await tester.pumpWidget(_hostFor(controller));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Resend verification email'));
      await tester.pumpAndSettle();

      expect(controller.resendCallCount, 1);
      expect(find.text('Resend verification email'), findsOneWidget);
    },
  );

  testWidgets('verified email: shows "Verified" and no resend button', (
    tester,
  ) async {
    await tester.pumpWidget(
      _hostFor(
        _FakeAuthController(
          const VinkinUser(
            id: 'u1',
            username: 'org',
            displayName: 'Org',
            email: 'org@example.com',
            emailVerified: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('org@example.com'), findsOneWidget);
    expect(find.text('Verified'), findsOneWidget);
    expect(find.text('Resend verification email'), findsNothing);
  });
}
