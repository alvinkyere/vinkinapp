// Slice I2B — Activity screen empty state still renders correctly once its underlying vink
// list can include participant-role vinks (recentActivityProvider itself is unaffected by
// I2B for participant-role entries — see the I2B completion report's own flagged gap: no
// customer-safe activity-feed endpoint exists yet for a mere participant, so this screen's
// per-vink `/activity` fetch stays organizer-only for now). This test only proves the screen
// doesn't regress/crash under the new response shape.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:vinkin_mobile/core/analytics/analytics.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/features/activity/activity_providers.dart';
import 'package:vinkin_mobile/features/activity/activity_screen.dart';

void main() {
  testWidgets('Activity empty state renders when there is no activity', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          recentActivityProvider.overrideWith((ref) async => (entries: <VinkActivity>[], failedCount: 0)),
        ],
        child: const MaterialApp(home: ActivityScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Nothing here yet'), findsOneWidget);
  });

  testWidgets(
    'PARTIAL-FAILURE RESILIENCE (flag off): a failed row does not collapse the screen — '
    'successful entries still render alongside a note',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            recentActivityProvider.overrideWith(
              (ref) async => (entries: <VinkActivity>[], failedCount: 2),
            ),
          ],
          child: const MaterialApp(home: ActivityScreen()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Nothing here yet'), findsNothing, reason: 'not treated as truly empty');
      expect(find.textContaining("couldn't load"), findsOneWidget);
    },
  );

  group('Slice I6 (D29, C33) — outcome-summary list, flag on', () {
    testWidgets('renders a terminal vink\'s outcome row and tapping it navigates to Vink details', (
      tester,
    ) async {
      String? capturedVinkId;
      final router = GoRouter(
        initialLocation: '/activity',
        routes: [
          GoRoute(
            path: '/activity',
            builder: (context, state) => const ActivityScreen(homeActivityV2: true),
          ),
          GoRoute(
            path: '/activity/:vinkId',
            builder: (context, state) {
              capturedVinkId = state.pathParameters['vinkId'];
              return const SizedBox();
            },
          ),
          GoRoute(path: '/home', builder: (context, state) => const SizedBox()),
        ],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            analyticsProvider.overrideWithValue(DebugAnalytics()),
            vinkOutcomesProvider.overrideWith(
              (ref) async => (
                summaries: [
                  (
                    vinkId: 'done-vink',
                    vinkTitle: 'Team Lunch',
                    outcomeLabel: 'completed',
                    purchaseCategory: 'GROCERY',
                    date: DateTime.utc(2026, 1, 1),
                    amountMinor: 4000,
                  ),
                ],
                failedCount: 0,
              ),
            ),
          ],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Team Lunch'), findsOneWidget);
      expect(find.textContaining('Completed'), findsOneWidget);

      await tester.tap(find.text('Team Lunch'));
      await tester.pumpAndSettle();

      expect(capturedVinkId, 'done-vink');
    });

    testWidgets('empty state renders when there are no terminal Vinks yet', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            analyticsProvider.overrideWithValue(DebugAnalytics()),
            vinkOutcomesProvider.overrideWith(
              (ref) async => (summaries: <VinkOutcomeSummary>[], failedCount: 0),
            ),
          ],
          child: const MaterialApp(home: ActivityScreen(homeActivityV2: true)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Nothing here yet'), findsOneWidget);
    });

    testWidgets(
      'R0 REGRESSION: no per-day or overall spending total is ever rendered — each row shows '
      'its own amount only',
      (tester) async {
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              analyticsProvider.overrideWithValue(DebugAnalytics()),
              vinkOutcomesProvider.overrideWith(
                (ref) async => (
                  summaries: [
                    (
                      vinkId: 'vink-1',
                      vinkTitle: 'Team Lunch',
                      outcomeLabel: 'completed',
                      purchaseCategory: 'GROCERY',
                      date: DateTime.utc(2026, 1, 1),
                      amountMinor: 4000,
                    ),
                    (
                      vinkId: 'vink-2',
                      vinkTitle: 'Groceries',
                      outcomeLabel: 'completed',
                      purchaseCategory: 'GROCERY',
                      date: DateTime.utc(2026, 1, 1),
                      amountMinor: 6000,
                    ),
                  ],
                  failedCount: 0,
                ),
              ),
            ],
            child: const MaterialApp(home: ActivityScreen(homeActivityV2: true)),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Team Lunch'), findsOneWidget);
        expect(find.text('Groceries'), findsOneWidget);
        // Neither row's own amount, nor the two summed together, appear as a combined total.
        expect(find.textContaining('Total'), findsNothing);
        expect(find.textContaining(r'$100.00'), findsNothing);
      },
    );

    testWidgets(
      'PARTIAL-FAILURE RESILIENCE: a failed row does not collapse the screen — successful '
      'outcomes still render alongside a note',
      (tester) async {
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              analyticsProvider.overrideWithValue(DebugAnalytics()),
              vinkOutcomesProvider.overrideWith(
                (ref) async => (
                  summaries: [
                    (
                      vinkId: 'done-vink',
                      vinkTitle: 'Team Lunch',
                      outcomeLabel: 'completed',
                      purchaseCategory: 'GROCERY',
                      date: DateTime.utc(2026, 1, 1),
                      amountMinor: 4000,
                    ),
                  ],
                  failedCount: 1,
                ),
              ),
            ],
            child: const MaterialApp(home: ActivityScreen(homeActivityV2: true)),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Team Lunch'), findsOneWidget, reason: 'the successful row still renders');
        expect(find.textContaining("couldn't load"), findsOneWidget);
      },
    );
  });
}
