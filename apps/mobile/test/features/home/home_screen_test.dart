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
import 'package:vinkin_mobile/design_system/components/vink_avatar.dart';
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

// Irrelevant to routing/reachability tests — a fixed placeholder, matching the pre-existing
// convention of supplying every required field with a value the test itself doesn't assert on.
const _progress = ContributionProgress(
  confirmedAmountMinor: 0,
  totalAmountMinor: 4000,
  confirmedParticipantCount: 0,
  totalParticipantCount: 1,
);

Widget _buildTestApp({
  required List<ActiveVink> active,
  required _CapturedRoute captured,
  bool homeActivityV2 = false,
}) {
  final router = GoRouter(
    initialLocation: '/home',
    routes: [
      GoRoute(
        path: '/home',
        builder: (context, state) => HomeScreen(homeActivityV2: homeActivityV2),
      ),
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
      recentActivityProvider.overrideWith((ref) async => (entries: <VinkActivity>[], failedCount: 0)),
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
          // attentionBucket is irrelevant to this test — flag-off rendering never reads it.
          active: [(vink: vink, participantCount: 2, attentionBucket: AttentionBucket.waitingOnOthers, contributionProgress: _progress, participantNames: const [])],
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
          active: [(vink: vink, participantCount: 3, attentionBucket: AttentionBucket.waitingOnOthers, contributionProgress: _progress, participantNames: const [])],
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
          active: [(vink: vink, participantCount: 1, attentionBucket: AttentionBucket.waitingOnOthers, contributionProgress: _progress, participantNames: const [])],
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
          active: [(vink: vink, participantCount: 3, attentionBucket: AttentionBucket.needsAttention, contributionProgress: _progress, participantNames: const [])],
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

  testWidgets(
    'R0: the persistent "Everyone In. One Payment." tagline is absent from signed-in Home, '
    'and is not replaced with a generic greeting either',
    (tester) async {
      final captured = _CapturedRoute();
      await tester.pumpWidget(_buildTestApp(active: const [], captured: captured));
      await tester.pumpAndSettle();

      expect(find.textContaining('Everyone in'), findsNothing);
      expect(find.textContaining('Everyone In'), findsNothing);
      expect(find.textContaining('One Payment'), findsNothing);
      expect(find.textContaining('Hi, '), findsNothing);
      expect(find.textContaining('Welcome'), findsNothing);
    },
  );

  testWidgets(
    'a mixed organizer + participant Home renders both roles, each labeled distinctly',
    (tester) async {
      final captured = _CapturedRoute();
      final orgVink = _vink(id: 'org-vink', state: 'RESTRICTED', role: 'organizer');
      final memberVink = _vink(id: 'member-vink', state: 'OPEN', role: 'participant');
      await tester.pumpWidget(
        _buildTestApp(
          active: [
            (
              vink: orgVink,
              participantCount: 2,
              attentionBucket: AttentionBucket.needsAttention,
              contributionProgress: _progress,
              participantNames: const [],
            ),
            (
              vink: memberVink,
              participantCount: 3,
              attentionBucket: AttentionBucket.waitingOnOthers,
              contributionProgress: _progress,
              participantNames: const [],
            ),
          ],
          captured: captured,
          homeActivityV2: true,
        ),
      );
      await tester.pumpAndSettle();

      // Design directive: a single carousel (attention-bucket ordering preserved, no
      // "Needs your attention"/"Waiting on others" section headings) under one "Active
      // Vinks" heading — the needs-attention organizer card pages in first.
      expect(find.text('Active Vinks'), findsOneWidget);
      expect(find.text('Needs your attention'), findsNothing);
      expect(find.text('Waiting on others'), findsNothing);
      expect(find.text('Organizer'), findsOneWidget);

      await tester.drag(find.byType(PageView), const Offset(-500, 0));
      await tester.pumpAndSettle();

      expect(find.text('Participant'), findsOneWidget);
    },
  );

  testWidgets(
    'Home never renders a raw activity feed (Phase 3 §1) — only a link to the Activity tab',
    (tester) async {
      final captured = _CapturedRoute();
      await tester.pumpWidget(
        _buildTestApp(active: const [], captured: captured, homeActivityV2: true),
      );
      await tester.pumpAndSettle();

      expect(find.text('See Activity'), findsOneWidget);
      expect(find.text('Recent activity'), findsNothing);
      expect(find.text('See all'), findsNothing);
    },
  );

  testWidgets(
    "an active Vink card's accessibility label communicates status and role as text, "
    'not color alone',
    (tester) async {
      final captured = _CapturedRoute();
      final vink = _vink(id: 'org-vink', state: 'RESTRICTED', role: 'organizer');
      await tester.pumpWidget(
        _buildTestApp(
          active: [
            (
              vink: vink,
              participantCount: 2,
              attentionBucket: AttentionBucket.needsAttention,
              contributionProgress: _progress,
              participantNames: const [],
            ),
          ],
          captured: captured,
          homeActivityV2: true,
        ),
      );
      await tester.pumpAndSettle();

      final semanticsWidget = tester.widget<Semantics>(
        find.byWidgetPredicate(
          (w) => w is Semantics && (w.properties.label ?? '').contains('Organizer'),
        ),
      );
      final label = semanticsWidget.properties.label!;
      expect(label, contains('Organizer'));
      expect(label, contains('confirmed'));
      expect(label, contains('Restricted'));
    },
  );

  testWidgets(
    'Slice 3: an organizer-role card with real participant names shows initials avatars, '
    'not the plain people icon',
    (tester) async {
      final captured = _CapturedRoute();
      final vink = _vink(id: 'org-vink', state: 'OPEN', role: 'organizer');
      await tester.pumpWidget(
        _buildTestApp(
          active: [
            (
              vink: vink,
              participantCount: 2,
              attentionBucket: AttentionBucket.waitingOnOthers,
              contributionProgress: _progress,
              participantNames: const ['Alvin', 'Maya'],
            ),
          ],
          captured: captured,
          homeActivityV2: true,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(VinkAvatar), findsNWidgets(2));
      expect(find.byIcon(Icons.people_outline_rounded), findsNothing);
    },
  );

  testWidgets(
    'Slice 3: a participant-role card (no participant names, D24/D25) falls back to the '
    'plain people icon, never an avatar for someone else',
    (tester) async {
      final captured = _CapturedRoute();
      final vink = _vink(id: 'member-vink', state: 'OPEN', role: 'participant');
      await tester.pumpWidget(
        _buildTestApp(
          active: [
            (
              vink: vink,
              participantCount: 3,
              attentionBucket: AttentionBucket.waitingOnOthers,
              contributionProgress: _progress,
              participantNames: const [],
            ),
          ],
          captured: captured,
          homeActivityV2: true,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(VinkAvatar), findsNothing);
      expect(find.byIcon(Icons.people_outline_rounded), findsOneWidget);
    },
  );
}
