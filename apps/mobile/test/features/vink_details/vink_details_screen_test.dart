// Slice I6 (Phase 4 §11, D29/D31/D43) — Vink Details screen. D43 corrects this slice's own
// first draft (which showed every participant's name+amount+status to every viewer,
// superseded before shipping): the organizer sees only a customer-safe aggregate summary,
// never a per-participant breakdown; a participant sees only their OWN share/outcome. The
// required D31 regression ("never receipt") still applies to every state.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:vinkin_mobile/core/analytics/analytics.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/models/vink.dart';
import 'package:vinkin_mobile/features/vink_details/vink_details_providers.dart';
import 'package:vinkin_mobile/features/vink_details/vink_details_screen.dart';

final _organizerView = VinkDetailsView(
  vinkId: 'vink-1',
  purpose: 'Team Lunch',
  purchaseCategory: 'GROCERY',
  totalMinor: 9000,
  organizerDisplayName: 'Org',
  viewerRole: 'organizer',
  vinkOutcome: 'completed',
  summary: VinkDetailsSummary(
    confirmedAmountMinor: 9000,
    confirmedParticipantCount: 3,
    totalParticipantCount: 3,
  ),
  timeline: [
    VinkDetailsTimelineEntry(eventType: 'VinkOpened', at: DateTime.utc(2026, 1, 1)),
    VinkDetailsTimelineEntry(eventType: 'VinkCompleted', at: DateTime.utc(2026, 1, 2)),
  ],
  merchantSettlementDetail: 'Corner Grocer — settled',
  viewerParticipant: null,
);

final _participantView = VinkDetailsView(
  vinkId: 'vink-1',
  purpose: 'Team Lunch',
  purchaseCategory: 'GROCERY',
  totalMinor: 9000,
  organizerDisplayName: 'Org',
  viewerRole: 'participant',
  vinkOutcome: 'completed',
  summary: VinkDetailsSummary(
    confirmedAmountMinor: 9000,
    confirmedParticipantCount: 3,
    totalParticipantCount: 3,
  ),
  timeline: [
    VinkDetailsTimelineEntry(eventType: 'VinkOpened', at: DateTime.utc(2026, 1, 1)),
    VinkDetailsTimelineEntry(eventType: 'VinkCompleted', at: DateTime.utc(2026, 1, 2)),
  ],
  merchantSettlementDetail: 'Corner Grocer — settled',
  viewerParticipant: VinkDetailsViewerParticipant(
    assignedShareMinor: 3000,
    confirmedAmountMinor: 3000,
    contributionOutcomeLabel: 'confirmed',
  ),
);

Widget _wrap(String vinkId, VinkDetailsView details) => ProviderScope(
  overrides: [
    analyticsProvider.overrideWithValue(DebugAnalytics()),
    vinkDetailsProvider(vinkId).overrideWith((ref) async => details),
  ],
  child: MaterialApp.router(
    routerConfig: GoRouter(
      initialLocation: '/activity/$vinkId',
      routes: [
        GoRoute(
          path: '/activity/:vinkId',
          builder: (context, state) =>
              VinkDetailsScreen(vinkId: state.pathParameters['vinkId']!),
        ),
      ],
    ),
  ),
);

void main() {
  group('D43: organizer view', () {
    testWidgets('shows only the customer-safe aggregate — never a participant name', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap('vink-1', _organizerView));
      await tester.pumpAndSettle();

      expect(find.textContaining('9000'), findsNothing); // sanity: rendered as money, not raw
      expect(find.text('You organized this Vink'), findsOneWidget);
      expect(find.textContaining('3 of 3 paid'), findsOneWidget);
      // No participant identity ever appears for the organizer's own aggregate-only view.
      expect(find.text('Org'), findsNothing);
    });

    testWidgets('shows the merchant settlement detail when present', (tester) async {
      await tester.pumpWidget(_wrap('vink-1', _organizerView));
      await tester.pumpAndSettle();

      expect(find.text('Corner Grocer — settled'), findsOneWidget);
    });
  });

  group('D43: participant view', () {
    testWidgets(
      "shows only the viewer's own share/outcome and the organizer's identity — never "
      "another participant's data (none exists on this screen to leak)",
      (tester) async {
        await tester.pumpWidget(_wrap('vink-1', _participantView));
        await tester.pumpAndSettle();

        expect(find.text('Organized by Org'), findsOneWidget);
        expect(find.text('Paid'), findsOneWidget); // the viewer's own outcome copy
        expect(find.text('You organized this Vink'), findsNothing);
      },
    );
  });

  testWidgets('D31 REGRESSION: never renders "receipt"/"Receipt" anywhere on this screen', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap('vink-1', _organizerView));
    await tester.pumpAndSettle();

    expect(find.textContaining('eceipt', findRichText: true), findsNothing);
  });

  testWidgets(
    'D31 REGRESSION holds even with an unclear/recovery-required outcome (support link path)',
    (tester) async {
      const unclear = VinkDetailsView(
        vinkId: 'vink-2',
        purpose: null,
        purchaseCategory: 'RETAIL',
        totalMinor: 5000,
        organizerDisplayName: 'Org',
        viewerRole: 'participant',
        vinkOutcome: 'recovery_required',
        summary: VinkDetailsSummary(
          confirmedAmountMinor: 5000,
          confirmedParticipantCount: 1,
          totalParticipantCount: 1,
        ),
        timeline: [],
        merchantSettlementDetail: null,
        viewerParticipant: VinkDetailsViewerParticipant(
          assignedShareMinor: 5000,
          confirmedAmountMinor: 5000,
          contributionOutcomeLabel: 'recovery_required',
        ),
      );
      await tester.pumpWidget(_wrap('vink-2', unclear));
      await tester.pumpAndSettle();

      expect(find.textContaining('eceipt', findRichText: true), findsNothing);
      expect(find.text('Resolving a shortfall'), findsOneWidget);
      // Category fallback since purpose is null.
      expect(find.text('Retail'), findsOneWidget);
    },
  );

  testWidgets('an error surfaces a retry affordance rather than a blank screen', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          analyticsProvider.overrideWithValue(DebugAnalytics()),
          vinkDetailsProvider('vink-err').overrideWith((ref) async => throw Exception('boom')),
        ],
        child: MaterialApp.router(
          routerConfig: GoRouter(
            initialLocation: '/activity/vink-err',
            routes: [
              GoRoute(
                path: '/activity/:vinkId',
                builder: (context, state) =>
                    VinkDetailsScreen(vinkId: state.pathParameters['vinkId']!),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Try again'), findsOneWidget);
  });
}
