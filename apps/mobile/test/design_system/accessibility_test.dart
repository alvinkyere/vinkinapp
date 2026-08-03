import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/design_system/components/vink_progress_indicator.dart';
import 'package:vinkin_mobile/design_system/components/vink_status_badge.dart';
import 'package:vinkin_mobile/design_system/vink_colors.dart';

Widget _wrap(Widget child) => MaterialApp(
  home: Scaffold(body: Material(child: child)),
);

/// Finds the rendered [Text] whose data matches [label] (case-insensitive, since buttons
/// render their label uppercased) and returns its resolved foreground color.
Color _renderedTextColor(WidgetTester tester, String label) {
  final textWidget = tester.widget<Text>(
    find.byWidgetPredicate(
      (w) => w is Text && (w.data ?? '').toUpperCase() == label.toUpperCase(),
    ),
  );
  return textWidget.style!.color!;
}

void main() {
  testWidgets(
    'VinkPrimaryButton reports enabled/disabled to the accessibility tree',
    (tester) async {
      await tester.pumpWidget(
        _wrap(VinkPrimaryButton(label: 'Continue', onPressed: () {})),
      );
      final enabledNode = tester.getSemantics(find.byType(VinkPrimaryButton));
      // ignore: deprecated_member_use — flagsCollection's replacement API returns a Tristate
      // type not worth chasing for a test assertion; hasFlag remains fully functional.
      expect(enabledNode.hasFlag(SemanticsFlag.isButton), isTrue);
      expect(enabledNode.hasFlag(SemanticsFlag.isEnabled), isTrue);

      await tester.pumpWidget(
        _wrap(const VinkPrimaryButton(label: 'Continue', onPressed: null)),
      );
      final disabledNode = tester.getSemantics(find.byType(VinkPrimaryButton));
      expect(disabledNode.hasFlag(SemanticsFlag.isEnabled), isFalse);
    },
  );

  testWidgets(
    'VinkStatusBadge exposes its human label to screen readers, not the raw state',
    (tester) async {
      await tester.pumpWidget(
        _wrap(const VinkStatusBadge(state: 'CARD_READY')),
      );
      final node = tester.getSemantics(find.byType(VinkStatusBadge));
      expect(node.label, contains('Ready to pay'));
      expect(node.label, isNot(contains('CARD_READY')));
    },
  );

  testWidgets(
    'VinkProgressIndicator exposes funded/required amounts and a percentage value',
    (tester) async {
      await tester.pumpWidget(
        _wrap(
          const VinkProgressIndicator(
            fundedAmountLabel: r'$30.00',
            requiredAmountLabel: r'$60.00',
            progress: 0.5,
          ),
        ),
      );
      final progressSemantics = find.byWidgetPredicate(
        (widget) => widget is Semantics && widget.properties.value == '50%',
      );
      expect(progressSemantics, findsOneWidget);
      final node = tester.getSemantics(progressSemantics);
      expect(node.label, contains(r'$30.00'));
      expect(node.label, contains(r'$60.00'));
    },
  );

  group(
    'Button loading state never changes the button\'s width (I0 / P1-1 regression)',
    () {
      // A single pump(), never pumpAndSettle(): CircularProgressIndicator's indeterminate
      // spin animation never settles, so pumpAndSettle() would hang whenever loading: true.
      Future<Size> sizeOf(WidgetTester tester, Finder finder) async {
        await tester.pump();
        return tester.getSize(finder);
      }

      testWidgets('VinkPrimaryButton', (tester) async {
        await tester.pumpWidget(
          _wrap(VinkPrimaryButton(label: 'Open Vink', onPressed: () {})),
        );
        final restingSize = await sizeOf(
          tester,
          find.byType(VinkPrimaryButton),
        );

        await tester.pumpWidget(
          _wrap(
            const VinkPrimaryButton(
              label: 'Open Vink',
              onPressed: null,
              loading: true,
            ),
          ),
        );
        final loadingSize = await sizeOf(
          tester,
          find.byType(VinkPrimaryButton),
        );

        expect(loadingSize.width, restingSize.width);
        expect(loadingSize.height, restingSize.height);
      });

      testWidgets('VinkSecondaryButton', (tester) async {
        await tester.pumpWidget(
          _wrap(VinkSecondaryButton(label: 'Share manually', onPressed: () {})),
        );
        final restingSize = await sizeOf(
          tester,
          find.byType(VinkSecondaryButton),
        );

        await tester.pumpWidget(
          _wrap(
            const VinkSecondaryButton(
              label: 'Share manually',
              onPressed: null,
              loading: true,
            ),
          ),
        );
        final loadingSize = await sizeOf(
          tester,
          find.byType(VinkSecondaryButton),
        );

        expect(loadingSize.width, restingSize.width);
        expect(loadingSize.height, restingSize.height);
      });

      testWidgets('VinkDestructiveButton', (tester) async {
        await tester.pumpWidget(
          _wrap(VinkDestructiveButton(label: 'Cancel Vink', onPressed: () {})),
        );
        final restingSize = await sizeOf(
          tester,
          find.byType(VinkDestructiveButton),
        );

        await tester.pumpWidget(
          _wrap(
            const VinkDestructiveButton(
              label: 'Cancel Vink',
              onPressed: null,
              loading: true,
            ),
          ),
        );
        final loadingSize = await sizeOf(
          tester,
          find.byType(VinkDestructiveButton),
        );

        expect(loadingSize.width, restingSize.width);
        expect(loadingSize.height, restingSize.height);
      });
    },
  );

  testWidgets(
    'VinkDestructiveButton renders its label in ink, never danger (D36 — danger text fails '
    'WCAG AA at this button\'s size)',
    (tester) async {
      await tester.pumpWidget(
        _wrap(VinkDestructiveButton(label: 'Cancel Vink', onPressed: () {})),
      );
      expect(_renderedTextColor(tester, 'Cancel Vink'), VinkColors.ink);
    },
  );

  testWidgets(
    'VinkStatusBadge attention tone renders its label in ink, never danger (D36)',
    (tester) async {
      await tester.pumpWidget(
        _wrap(const VinkStatusBadge(state: 'RESTRICTED')),
      );
      final node = tester.getSemantics(find.byType(VinkStatusBadge));
      expect(node.label, contains('Restricted'));
      final textWidget = tester.widget<Text>(find.text('Restricted'));
      expect(textWidget.style!.color, VinkColors.ink);
    },
  );
}
