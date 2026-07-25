import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_typography.dart';

/// The exact bar from vinkin.org's own Vink-card mockup: `h-3` (12px) track in `ink/10`,
/// `bg-blue` fill, both fully rounded. Deliberately a plain bar, not a literal ink-fill
/// animation — the design doc is explicit that the site itself uses a plain bar for the
/// product UI and reserves the liquid/droplet idea for the logo and copy alone.
class VinkProgressIndicator extends StatelessWidget {
  const VinkProgressIndicator({
    super.key,
    required this.fundedAmountLabel,
    required this.requiredAmountLabel,
    required this.progress,
  });

  final String fundedAmountLabel;
  final String requiredAmountLabel;

  /// 0.0–1.0. Readable without animation (accessibility requirement) — the fill width is
  /// set directly from this value, no entrance animation gates the correct end state.
  final double progress;

  @override
  Widget build(BuildContext context) {
    final clamped = progress.clamp(0.0, 1.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          label: '$fundedAmountLabel of $requiredAmountLabel funded',
          value: '${(clamped * 100).round()}%',
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: SizedBox(
              height: 12,
              child: Stack(
                children: [
                  Container(color: VinkColors.ink.withValues(alpha: 0.1)),
                  FractionallySizedBox(
                    widthFactor: clamped,
                    child: Container(color: VinkColors.blue),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          '$fundedAmountLabel of $requiredAmountLabel funded',
          style: VinkTypography.bodySmallSecondary,
        ),
      ],
    );
  }
}
