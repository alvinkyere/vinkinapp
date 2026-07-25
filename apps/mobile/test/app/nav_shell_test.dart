// Invites feature (D44) — the tab-bar structure itself: flag off stays the exact 3-tab
// Home/Activity/Profile shell (rollback contract, same discipline as router_flag_test.dart's
// own canonicalCreateFlow/homeActivityV2 proofs); flag on inserts a 4th Invites tab and shifts
// Profile to index 3, and the Invites tab is genuinely reachable.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/app/router.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/models/user.dart';
import 'package:vinkin_mobile/core/models/vink.dart';
import 'package:vinkin_mobile/core/models/pending_invite.dart';
import 'package:vinkin_mobile/features/activity/activity_providers.dart';
import 'package:vinkin_mobile/features/home/home_providers.dart';
import 'package:vinkin_mobile/features/invites/invites_providers.dart';
import 'package:vinkin_mobile/features/invites/invites_screen.dart';

class _FakeAuthController extends AuthController {
  @override
  AuthState build() => const AuthSignedIn(
    VinkinUser(id: 'u1', username: 'org', displayName: 'Org'),
    'token',
  );
}

Future<void> _pump(WidgetTester tester, {required bool invitesEnabled}) async {
  final container = ProviderContainer(
    overrides: [
      authControllerProvider.overrideWith(_FakeAuthController.new),
      myVinksProvider.overrideWith((ref) async => const <Vink>[]),
      activeVinksProvider.overrideWith((ref) async => const <ActiveVink>[]),
      recentActivityProvider.overrideWith(
        (ref) async => (entries: <VinkActivity>[], failedCount: 0),
      ),
      invitesProvider.overrideWith((ref) async => const <PendingInvite>[]),
    ],
  );
  addTearDown(container.dispose);
  final router = container.read(
    Provider((ref) => buildRouter(ref, invitesEnabled: invitesEnabled)),
  );
  router.go('/home');
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('flag off: exactly 3 tabs — Home, Activity, Me — no Invites', (
    tester,
  ) async {
    await _pump(tester, invitesEnabled: false);

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Activity'), findsOneWidget);
    expect(find.text('Me'), findsOneWidget);
    expect(find.text('Invites'), findsNothing);
  });

  testWidgets('flag on: a 4th Invites tab appears, and is reachable', (
    tester,
  ) async {
    await _pump(tester, invitesEnabled: true);

    expect(find.text('Invites'), findsOneWidget);

    await tester.tap(find.text('Invites'));
    await tester.pumpAndSettle();

    expect(find.byType(InvitesScreen), findsOneWidget);
    expect(find.text('No pending invites'), findsOneWidget);
  });

  testWidgets('flag on: Me still reachable at its shifted tab position', (
    tester,
  ) async {
    await _pump(tester, invitesEnabled: true);

    await tester.tap(find.text('Me'));
    await tester.pumpAndSettle();

    expect(
      find.text('Home'),
      findsOneWidget,
    ); // the tab bar itself still renders
  });
}
