import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

/// Concept-image in-app numeric keypad for the Total step — a visual, tappable alternative
/// to the OS keyboard `VinkMoneyField` already supports (that field stays focusable and
/// keyboard-driven too; this is additive, not a replacement, so physical-keyboard and
/// accessibility input paths are unaffected). Mutates the same [controller] `VinkMoneyField`
/// reads from, through the same 2-decimal-place rule (`^\d*\.?\d{0,2}`) that field's own
/// `inputFormatters` already enforce, so behavior never diverges between the two input paths.
class VinkNumericKeypad extends StatelessWidget {
  const VinkNumericKeypad({
    super.key,
    required this.controller,
    this.onChanged,
  });

  final TextEditingController controller;
  final ValueChanged<String>? onChanged;

  static const _keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['.', '0', '⌫'],
  ];

  void _tap(String key) {
    final current = controller.text;
    final next = key == '⌫'
        ? (current.isEmpty ? current : current.substring(0, current.length - 1))
        : current + key;
    if (key != '⌫') {
      // Same shape as `VinkMoneyField`'s own `inputFormatters` — reject a keystroke that
      // would violate the 2-decimal-place / single-decimal-point rule rather than diverging.
      if (!RegExp(r'^\d*\.?\d{0,2}$').hasMatch(next)) return;
    }
    controller
      ..text = next
      ..selection = TextSelection.collapsed(offset: next.length);
    onChanged?.call(next);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final row in _keys) ...[
          Row(
            children: [
              for (final key in row)
                Expanded(
                  child: Semantics(
                    button: true,
                    label: key == '⌫'
                        ? 'Delete'
                        : key == '.'
                        ? 'Decimal point'
                        : key,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: () => _tap(key),
                      child: Container(
                        height: 56,
                        alignment: Alignment.center,
                        child: key == '⌫'
                            ? const Icon(
                                Icons.backspace_outlined,
                                color: VinkColors.ink,
                                size: 22,
                              )
                            : Text(key, style: VinkTypography.title),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          if (row != _keys.last) const SizedBox(height: VinkSpacing.xs),
        ],
      ],
    );
  }
}
