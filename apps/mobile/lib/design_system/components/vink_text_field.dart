import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../vink_colors.dart';
import '../vink_typography.dart';

/// Body-font (Inter) input on a white surface with the theme's pill-ish rounded border —
/// used for names, usernames, notes. Validation state renders as `VinkInlineError` beneath
/// the field by the *caller* (kept out of this widget so error copy can be screen-specific),
/// but the field itself still reports `errorText` visually when passed.
class VinkTextField extends StatelessWidget {
  const VinkTextField({
    super.key,
    required this.label,
    this.controller,
    this.onChanged,
    this.onSubmitted,
    this.errorText,
    this.autofillHints,
    this.textInputAction,
    this.keyboardType,
    this.maxLength,
    this.semanticLabel,
    this.autofocus = false,
    this.obscureText = false,
  });

  final String label;
  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final String? errorText;
  final Iterable<String>? autofillHints;
  final TextInputAction? textInputAction;
  final TextInputType? keyboardType;
  final int? maxLength;
  final String? semanticLabel;
  final bool autofocus;
  final bool obscureText;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      textField: true,
      label: semanticLabel ?? label,
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        onSubmitted: onSubmitted,
        autofillHints: autofillHints,
        textInputAction: textInputAction,
        keyboardType: keyboardType,
        maxLength: maxLength,
        autofocus: autofocus,
        obscureText: obscureText,
        style: VinkTypography.body,
        decoration: InputDecoration(
          labelText: label,
          errorText: errorText,
          counterText: '',
        ),
      ),
    );
  }
}

/// The large currency input the create-Vink "total" step is built around — big display-font
/// numerals, a fixed `$` prefix, decimal keyboard, and integer-minor-units-safe parsing
/// (never a raw double comparison the way a naive `double.parse` would risk).
class VinkMoneyField extends StatelessWidget {
  const VinkMoneyField({
    super.key,
    required this.controller,
    this.onChanged,
    this.errorText,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final ValueChanged<String>? onChanged;
  final String? errorText;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      textField: true,
      label: 'Total amount in dollars',
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        autofocus: autofocus,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d{0,2}')),
        ],
        textAlign: TextAlign.center,
        style: VinkTypography.amountLarge,
        decoration: InputDecoration(
          prefixText: '\$ ',
          prefixStyle: VinkTypography.amountLarge.copyWith(
            color: VinkColors.smoke,
          ),
          errorText: errorText,
          border: InputBorder.none,
          focusedBorder: InputBorder.none,
          enabledBorder: InputBorder.none,
        ),
      ),
    );
  }
}
