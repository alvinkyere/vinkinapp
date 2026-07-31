import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/components/vink_deadline_countdown.dart';

void main() {
  group('formatTimeRemaining (RM4B, D47)', () {
    test('null deadline/remaining renders nothing', () {
      expect(formatTimeRemaining(null), isNull);
    });

    test('past deadline uses the given pastLabel', () {
      expect(
        formatTimeRemaining(const Duration(seconds: -5), pastLabel: 'Past deadline'),
        'Past deadline',
      );
    });

    test('past deadline with pastLabel: null hides the row entirely', () {
      expect(formatTimeRemaining(const Duration(seconds: -5), pastLabel: null), isNull);
    });

    test('RM4B: below one minute shows real seconds, not a frozen minute label', () {
      expect(formatTimeRemaining(const Duration(seconds: 45)), '45s left');
      expect(formatTimeRemaining(const Duration(seconds: 1)), '1s left');
    });

    test('1-59 minutes shows minutes', () {
      expect(formatTimeRemaining(const Duration(minutes: 6, seconds: 59)), '6m left');
    });

    test('1-23 hours shows hours', () {
      expect(formatTimeRemaining(const Duration(hours: 5, minutes: 30)), '5h left');
    });

    test('24+ hours shows days', () {
      expect(formatTimeRemaining(const Duration(days: 2, hours: 3)), '2d left');
    });
  });

  group('VinkDeadlineCountdown (RM4B, D47)', () {
    testWidgets('a null deadline never schedules a timer and renders once', (tester) async {
      var buildCount = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: VinkDeadlineCountdown(
            deadline: null,
            builder: (context, remaining) {
              buildCount += 1;
              return Text(remaining?.toString() ?? 'none');
            },
          ),
        ),
      );
      expect(find.text('none'), findsOneWidget);
      expect(buildCount, 1);

      // No pending timer means this must not throw/hang, and the label must not change.
      await tester.pump(const Duration(seconds: 5));
      expect(buildCount, 1);
    });

    testWidgets(
      'ticks every second and the rendered label genuinely changes as the injected clock advances — '
      'proving this is a live countdown, not a render-time-only snapshot (the exact defect RM4B fixes)',
      (tester) async {
        var fakeNow = DateTime(2026, 1, 1, 12, 0, 0);
        final deadline = fakeNow.add(const Duration(seconds: 90));

        await tester.pumpWidget(
          MaterialApp(
            home: VinkDeadlineCountdown(
              deadline: deadline,
              now: () => fakeNow,
              builder: (context, remaining) => Text(formatTimeRemaining(remaining) ?? 'none'),
            ),
          ),
        );
        expect(find.text('1m left'), findsOneWidget);

        // Advance the injected clock into the sub-minute range, then let the widget's own
        // Timer.periodic tick (fake under flutter_test) to pick it up — no rebuild is
        // triggered any other way, so this proves the tick itself drives the update.
        fakeNow = fakeNow.add(const Duration(seconds: 35));
        await tester.pump(const Duration(seconds: 1));
        expect(find.text('55s left'), findsOneWidget);

        fakeNow = fakeNow.add(const Duration(seconds: 40));
        await tester.pump(const Duration(seconds: 1));
        expect(find.text('15s left'), findsOneWidget);

        fakeNow = fakeNow.add(const Duration(seconds: 20));
        await tester.pump(const Duration(seconds: 1));
        expect(find.text('Past deadline'), findsOneWidget);
      },
    );

    testWidgets('changing the deadline prop reschedules ticking against the new deadline', (
      tester,
    ) async {
      var fakeNow = DateTime(2026, 1, 1, 12, 0, 0);
      var deadline = fakeNow.add(const Duration(seconds: 30));

      Widget build() => MaterialApp(
        home: VinkDeadlineCountdown(
          deadline: deadline,
          now: () => fakeNow,
          builder: (context, remaining) => Text(formatTimeRemaining(remaining) ?? 'none'),
        ),
      );

      await tester.pumpWidget(build());
      expect(find.text('30s left'), findsOneWidget);

      deadline = fakeNow.add(const Duration(minutes: 5));
      await tester.pumpWidget(build());
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('5m left'), findsOneWidget);
    });

    testWidgets('disposing the widget cancels the timer (no pending-timer test failure)', (
      tester,
    ) async {
      final fakeNow = DateTime(2026, 1, 1, 12, 0, 0);
      await tester.pumpWidget(
        MaterialApp(
          home: VinkDeadlineCountdown(
            deadline: fakeNow.add(const Duration(minutes: 1)),
            now: () => fakeNow,
            builder: (context, remaining) => Text(formatTimeRemaining(remaining) ?? 'none'),
          ),
        ),
      );
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      // flutter_test itself fails the test if a Timer is still pending after the test body
      // completes — reaching this point at all is the proof.
    });
  });
}
