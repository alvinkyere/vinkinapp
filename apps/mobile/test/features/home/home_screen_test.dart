// Slice I2B — Home screen participant-inclusive rendering: role-based destination routing
// (organizer entries stay on the existing flow, participant entries carry ?role=participant),
// RESTRICTED reachability for a participant-role vink (must not disappear), and the empty
// state under the new (possibly role-annotated) response shape.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/models/user.dart';
import 'package:vinkin_mobile/core/models/vink.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/features/activity/activity_providers.dart';
import 'package:vinkin_mobile/features/home/home_providers.dart';
import 'package:vinkin_mobile/features/home/home_screen.dart';

class _FakeAuthController extends AuthController {
  @override
  AuthState build() => const AuthSignedIn(
    VinkinUser(id: 'u1', username: 'org', displayName: 'Org'),
    'token',
  );
}

class _CapturedRoute {
  String? vinkId;
  String? role;
}

Vink _vink({required String id, required String state, String? role}) => Vink(
  id: id,
  publicCode: 'CODE$id',
  purchaseCategory: 'GROCERY',
  state: state,
  requiredAmountMinor: 4000,
  fundedAmountMinor: 0,
  version: 1,
  organizerUserId: 'organizer-1',
  role: role,
);

Widget _buildTestApp({
  required List<ActiveVink> active,
  required _CapturedRoute captured,
}) {
  final router = GoRouter(
    initialLocation: '/home',
    routes: [
      GoRoute(path: '/home', builder: (context, state) => const HomeScreen()),
      GoRoute(
        path: '/create-vink',
        builder: (context, state) => const SizedBox(),
      ),
      GoRoute(path: '/activity', builder: (context, state) => const SizedBox()),
      GoRoute(
        path: '/vinks/:vinkId',
        builder: (context, state) {
          captured.vinkId = state.pathParameters['vinkId'];
          captured.role = state.uri.queryParameters['role'];
          return const SizedBox();
        },
      ),
    ],
  );

  return ProviderScope(
    overrides: [
      authControllerProvider.overrideWith(_FakeAuthController.new),
      activeVinksProvider.overrideWith((ref) async => active),
      recentActivityProvider.overrideWith((ref) async => const []),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  testWidgets(
    'an organizer-role active vink routes to /vinks/:id with no role param',
    (tester) async {
      final captured = _CapturedRoute();
      final vink = _vink(id: 'org-vink', state: 'OPEN', role: 'organizer');
      await tester.pumpWidget(
        _buildTestApp(
          active: [(vink: vink, participantCount: 2)],
          captured: captured,
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(VinkSecondaryButton).first);
      await tester.pumpAndSettle();

      expect(captured.vinkId, 'org-vink');
      expect(captured.role, isNull);
    },
  );

  testWidgets(
    'a participant-role active vink routes to /vinks/:id?role=participant — the actual '
    'routing-by-role decision, not just the flag/list layer',
    (tester) async {
      final captured = _CapturedRoute();
      final vink = _vink(id: 'member-vink', state: 'OPEN', role: 'participant');
      await tester.pumpWidget(
        _buildTestApp(
          active: [(vink: vink, participantCount: 3)],
          captured: captured,
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(VinkSecondaryButton).first);
      await tester.pumpAndSettle();

      expect(captured.vinkId, 'member-vink');
      expect(captured.role, 'participant');
    },
  );

  testWidgets(
    'rollback-to-flag-off behavior: role absent (as a flag-off server response leaves it) '
    'routes exactly like an explicit organizer role — no role query param',
    (tester) async {
      final captured = _CapturedRoute();
      final vink = _vink(id: 'legacy-vink', state: 'OPEN', role: null);
      await tester.pumpWidget(
        _buildTestApp(
          active: [(vink: vink, participantCount: 1)],
          captured: captured,
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(VinkSecondaryButton).first);
      await tester.pumpAndSettle();

      expect(captured.vinkId, 'legacy-vink');
      expect(captured.role, isNull);
    },
  );

  testWidgets(
    'RESTRICTED reachability: a participant-role RESTRICTED vink still renders a reachable '
    'Active Vinks card — it must not disappear',
    (tester) async {
      final captured = _CapturedRoute();
      final vink = _vink(
        id: 'restricted-vink',
        state: 'RESTRICTED',
        role: 'participant',
      );
      await tester.pumpWidget(
        _buildTestApp(
          active: [(vink: vink, participantCount: 3)],
          captured: captured,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Nothing active right now'), findsNothing);
      expect(find.byType(InkWell), findsWidgets);

      await tester.tap(find.byType(VinkSecondaryButton).first);
      await tester.pumpAndSettle();

      expect(captured.vinkId, 'restricted-vink');
      expect(captured.role, 'participant');
    },
  );

  testWidgets(
    'Home empty state renders when the active-vinks response is empty',
    (tester) async {
      final captured = _CapturedRoute();
      await tester.pumpWidget(
        _buildTestApp(active: const [], captured: captured),
      );
      await tester.pumpAndSettle();

      expect(find.text('Nothing active right now'), findsOneWidget);
    },
  );
}
