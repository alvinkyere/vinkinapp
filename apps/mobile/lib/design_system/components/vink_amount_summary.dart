import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';
import 'money_text.dart';

/// The "Assigned / Remaining" readout the custom-split step lives or dies on
/// (docs/design/vinkin-design-system.md's exit-gate scenarios): always visible, never
/// hidden behind submission, color-coded so under/over-assignment is obvious at a glance.
class VinkAmountSummary extends StatelessWidget {
  const VinkAmountSummary({
    super.key,
    required this.totalMinor,
    required this.assignedMinor,
  });

  final int totalMinor;
  final int assignedMinor;

  int get _remainingMinor => totalMinor - assignedMinor;

  @override
  Widget build(BuildContext context) {
    final remaining = _remainingMinor;
    // Over-assignment used danger text here; at this widget's bodySmall (14px) size that
    // fails WCAG AA (D36). Per the approved interim rule
    // (docs/design/phase-8-visual-system-refinement.md §24), danger-colored text isn't
    // substituted with a new accent color — it falls back to ink. No information is lost:
    // the supporting sentence below already states in words whether the remainder is
    // under- or over-assigned, so color here was reinforcement, not the sole signal.
    final Color remainingColor = remaining == 0
        ? VinkColors.ink
        : (remaining > 0 ? VinkColors.smoke : VinkColors.ink);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Assigned', style: VinkTypography.bodySmallSecondary),
            MoneyText(
              assignedMinor,
              style: VinkTypography.bodySmall.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        const SizedBox(height: VinkSpacing.xs),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Remaining', style: VinkTypography.bodySmallSecondary),
            MoneyText(
              remaining.abs(),
              style: VinkTypography.bodySmall.copyWith(
                fontWeight: FontWeight.w700,
                color: remainingColor,
              ),
            ),
          ],
        ),
        if (remaining != 0) ...[
          const SizedBox(height: VinkSpacing.sm),
          // ink, not danger: explanatory copy uses primary text (D36) — the wording itself
          // ("still needs to be assigned" vs. "more than the total") already distinguishes
          // under- from over-assignment.
          Text(
            remaining > 0
                ? '${MoneyText.format(remaining)} still needs to be assigned'
                : 'You assigned ${MoneyText.format(remaining.abs())} more than the total',
            style: VinkTypography.bodySmall.copyWith(color: VinkColors.ink),
          ),
        ],
      ],
    );
  }
}
