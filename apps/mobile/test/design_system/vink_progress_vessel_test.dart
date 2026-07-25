// I7 (Phase 8 §15, Phase 6 §12) — the Ink Progress vessel: every documented fill state, the
// compact/primary variant split, and the two waiting-clause helpers (organizer real-names vs.
// participant/guest count-only, D24/D25's privacy boundary).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/components/vink_progress_vessel.dart';

Widget _wrap(Widget child, {bool reduceMotion = false}) => MediaQuery(
  data: MediaQueryData(disableAnimations: reduceMotion),
  child: MaterialApp(home: Scaffold(body: child)),
);

void main() {
  group('VinkProgressVessel — primary variant', () {
    testWidgets(r'empty ($0 confirmed): accessible value is 0%, headline reads $0 of $Y ready', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          const VinkProgressVessel(
            confirmedAmountMinor: 0,
            totalAmountMinor: 8000,
            waitingClause: 'Waiting for everyone',
          ),
        ),
      );

      expect(find.text(r'$0.00 of $80.00 ready'), findsOneWidget);
      expect(find.text('Waiting for everyone'), findsOneWidget);
      final semantics = tester.getSemantics(find.byWidgetPredicate((w) => w is Semantics && (w.properties.value ?? '').contains('%')));
      expect(semantics.value, '0%');
    });

    testWidgets('partial: accessible value reflects the real fraction', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const VinkProgressVessel(
            confirmedAmountMinor: 4000,
            totalAmountMinor: 8000,
            waitingClause: 'Waiting for Maya',
          ),
        ),
      );

      expect(find.text(r'$40.00 of $80.00 ready'), findsOneWidget);
      final semantics = tester.getSemantics(find.byWidgetPredicate((w) => w is Semantics && (w.properties.value ?? '').contains('%')));
      expect(semantics.value, '50%');
    });

    testWidgets('complete: 100%, waiting clause reads "Everyone\'s ready"', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const VinkProgressVessel(
            confirmedAmountMinor: 8000,
            totalAmountMinor: 8000,
            waitingClause: "Everyone's ready",
          ),
        ),
      );

      final semantics = tester.getSemantics(find.byWidgetPredicate((w) => w is Semantics && (w.properties.value ?? '').contains('%')));
      expect(semantics.value, '100%');
      expect(find.text("Everyone's ready"), findsOneWidget);
    });

    testWidgets('renders under reduced motion with no exception (instant level change)', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          const VinkProgressVessel(
            confirmedAmountMinor: 4000,
            totalAmountMinor: 8000,
            waitingClause: 'Waiting for Maya',
          ),
          reduceMotion: true,
        ),
      );
      await tester.pump();

      expect(tester.takeException(), isNull);
    });
  });

  group('VinkProgressVessel — compact variant (Home)', () {
    testWidgets('renders no headline or waiting-clause text — Phase 8 §15\'s own table', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          const VinkProgressVessel(confirmedAmountMinor: 4000, totalAmountMinor: 8000, compact: true),
        ),
      );

      expect(find.text(r'$40.00 of $80.00 ready'), findsNothing);
      expect(find.textContaining('Waiting'), findsNothing);
    });
  });

  group('organizerWaitingClause (Phase 6 §12, real names)', () {
    test(r'$0 confirmed with nobody yet: "Waiting for everyone"', () {
      expect(
        organizerWaitingClause(confirmedAmountMinor: 0, totalAmountMinor: 8000, unconfirmedNames: const []),
        'Waiting for everyone',
      );
    });

    test('one unconfirmed name', () {
      expect(
        organizerWaitingClause(
          confirmedAmountMinor: 4000,
          totalAmountMinor: 8000,
          unconfirmedNames: const ['Maya'],
        ),
        'Waiting for Maya',
      );
    });

    test('two unconfirmed names — both named', () {
      expect(
        organizerWaitingClause(
          confirmedAmountMinor: 4000,
          totalAmountMinor: 12000,
          unconfirmedNames: const ['Maya', 'Jordan'],
        ),
        'Waiting for Maya and Jordan',
      );
    });

    test('three or more — count only, not a name list', () {
      expect(
        organizerWaitingClause(
          confirmedAmountMinor: 4000,
          totalAmountMinor: 20000,
          unconfirmedNames: const ['Maya', 'Jordan', 'Alex'],
        ),
        'Waiting for 3 people',
      );
    });

    test('fully confirmed: "Everyone\'s ready"', () {
      expect(
        organizerWaitingClause(confirmedAmountMinor: 8000, totalAmountMinor: 8000, unconfirmedNames: const []),
        "Everyone's ready",
      );
    });
  });

  group('participantSafeWaitingClause (D24/D25 — count-only, never a name)', () {
    test('nobody confirmed yet: "Waiting for everyone"', () {
      expect(
        participantSafeWaitingClause(
          confirmedAmountMinor: 0,
          totalAmountMinor: 8000,
          confirmedParticipantCount: 0,
          totalParticipantCount: 3,
        ),
        'Waiting for everyone',
      );
    });

    test('one remaining', () {
      expect(
        participantSafeWaitingClause(
          confirmedAmountMinor: 4000,
          totalAmountMinor: 8000,
          confirmedParticipantCount: 2,
          totalParticipantCount: 3,
        ),
        'Waiting for 1 more person',
      );
    });

    test('several remaining', () {
      expect(
        participantSafeWaitingClause(
          confirmedAmountMinor: 4000,
          totalAmountMinor: 20000,
          confirmedParticipantCount: 1,
          totalParticipantCount: 4,
        ),
        'Waiting for 3 people',
      );
    });

    test('everyone confirmed', () {
      expect(
        participantSafeWaitingClause(
          confirmedAmountMinor: 8000,
          totalAmountMinor: 8000,
          confirmedParticipantCount: 3,
          totalParticipantCount: 3,
        ),
        "Everyone's ready",
      );
    });
  });
}
