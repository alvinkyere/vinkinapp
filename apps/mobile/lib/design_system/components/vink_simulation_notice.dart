import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

/// "Never visually misrepresent mock financial functionality as a live issued card"
/// (design correction brief) — the one place that disclosure lives, shown on every screen
/// that renders mock money/card state. Deliberately neutral (`smoke`/`ink`, no invented
/// alert color) — this is informational, not a warning.
class VinkSimulationNotice extends StatelessWidget {
  const VinkSimulationNotice({super.key, this.text = 'Pilot simulation — no real card has been issued, no real money moves.'});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Simulation notice: $text',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: VinkSpacing.sm + 2, horizontal: VinkSpacing.md),
        decoration: BoxDecoration(
          color: VinkColors.ink.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(Icons.info_outline_rounded, size: 16, color: VinkColors.smoke),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(child: Text(text, style: VinkTypography.bodySmallSecondary)),
          ],
        ),
      ),
    );
  }
}
