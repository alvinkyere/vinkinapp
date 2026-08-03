import 'package:flutter/material.dart';
import '../vink_typography.dart';

/// Renders integer minor units (Plan §15 — never floating point) as a dollar string. The
/// ONLY place cents-to-dollars formatting happens, so every screen agrees.
class MoneyText extends StatelessWidget {
  const MoneyText(this.amountMinor, {super.key, this.style});

  final int amountMinor;
  final TextStyle? style;

  static String format(int amountMinor) {
    final bool negative = amountMinor < 0;
    final int abs = amountMinor.abs();
    final String dollars = (abs ~/ 100).toString();
    final String cents = (abs % 100).toString().padLeft(2, '0');
    return '${negative ? '-' : ''}\$$dollars.$cents';
  }

  @override
  Widget build(BuildContext context) {
    final String formatted = format(amountMinor);
    return Semantics(
      label: '${formatted.replaceFirst('\$', '')} dollars',
      child: Text(formatted, style: style ?? VinkTypography.amountMedium),
    );
  }
}
