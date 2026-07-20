import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/design_system/components/vink_progress_indicator.dart';
import 'package:vinkin_mobile/design_system/components/vink_status_badge.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: Material(child: child)));

void main() {
  testWidgets('VinkPrimaryButton reports enabled/disabled to the accessibility tree', (tester) async {
    await tester.pumpWidget(_wrap(VinkPrimaryButton(label: 'Continue', onPressed: () {})));
    final enabledNode = tester.getSemantics(find.byType(VinkPrimaryButton));
    // ignore: deprecated_member_use — flagsCollection's replacement API returns a Tristate
    // type not worth chasing for a test assertion; hasFlag remains fully functional.
    expect(enabledNode.hasFlag(SemanticsFlag.isButton), isTrue);
    expect(enabledNode.hasFlag(SemanticsFlag.isEnabled), isTrue);

    await tester.pumpWidget(_wrap(const VinkPrimaryButton(label: 'Continue', onPressed: null)));
    final disabledNode = tester.getSemantics(find.byType(VinkPrimaryButton));
    expect(disabledNode.hasFlag(SemanticsFlag.isEnabled), isFalse);
  });

  testWidgets('VinkStatusBadge exposes its human label to screen readers, not the raw state', (tester) async {
    await tester.pumpWidget(_wrap(const VinkStatusBadge(state: 'CARD_READY')));
    final node = tester.getSemantics(find.byType(VinkStatusBadge));
    expect(node.label, contains('Ready to pay'));
    expect(node.label, isNot(contains('CARD_READY')));
  });

  testWidgets('VinkProgressIndicator exposes funded/required amounts and a percentage value', (tester) async {
    await tester.pumpWidget(
      _wrap(const VinkProgressIndicator(fundedAmountLabel: r'$30.00', requiredAmountLabel: r'$60.00', progress: 0.5)),
    );
    final progressSemantics = find.byWidgetPredicate(
      (widget) => widget is Semantics && widget.properties.value == '50%',
    );
    expect(progressSemantics, findsOneWidget);
    final node = tester.getSemantics(progressSemantics);
    expect(node.label, contains(r'$30.00'));
    expect(node.label, contains(r'$60.00'));
  });
}
