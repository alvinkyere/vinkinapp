import 'package:flutter/material.dart';
import '../colors/vinkin_colors.dart';
import '../spacing/vinkin_spacing.dart';
import '../typography/vinkin_typography.dart';

enum VinkinButtonVariant { primary, secondary, destructive }

/// One button component for the whole app — screens never build their own ElevatedButton
/// styling. `semanticLabel` defaults to the visible text but can be overridden for a
/// clearer accessibility label (Plan PV9 "Accessibility").
class VinkinButton extends StatelessWidget {
  const VinkinButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = VinkinButtonVariant.primary,
    this.loading = false,
    this.semanticLabel,
  });

  final String label;
  final VoidCallback? onPressed;
  final VinkinButtonVariant variant;
  final bool loading;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final Color background = switch (variant) {
      VinkinButtonVariant.primary => VinkinColors.primary,
      VinkinButtonVariant.secondary => VinkinColors.surfaceMuted,
      VinkinButtonVariant.destructive => VinkinColors.danger,
    };
    final Color foreground = variant == VinkinButtonVariant.secondary
        ? VinkinColors.textPrimary
        : VinkinColors.textOnPrimary;

    return Semantics(
      button: true,
      enabled: onPressed != null && !loading,
      label: semanticLabel ?? label,
      child: SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton(
          onPressed: loading ? null : onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: background,
            foregroundColor: foreground,
            disabledBackgroundColor: background.withValues(alpha: 0.4),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(VinkinSpacing.sm),
            ),
          ),
          child: loading
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                )
              : Text(label, style: VinkinTypography.body.copyWith(color: foreground, fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }
}
