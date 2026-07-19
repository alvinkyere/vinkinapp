import 'package:flutter/material.dart';
import '../colors/vinkin_colors.dart';
import '../spacing/vinkin_spacing.dart';
import '../typography/vinkin_typography.dart';

/// Plan PV9 is explicit: "Mock card display clearly labeled as simulation." This banner is
/// the ONE place that label lives — every screen showing mock money/card state renders it,
/// so there is no path to a screen that looks real by omission.
class SimulationBanner extends StatelessWidget {
  const SimulationBanner({super.key, this.text = 'Simulation — no real money moves'});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Simulation notice: $text',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: VinkinSpacing.sm, horizontal: VinkinSpacing.md),
        decoration: BoxDecoration(
          color: VinkinColors.simulation.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(VinkinSpacing.sm),
          border: Border.all(color: VinkinColors.simulation.withValues(alpha: 0.4)),
        ),
        child: Row(
          children: [
            const Icon(Icons.science_outlined, size: 18, color: VinkinColors.simulation),
            const SizedBox(width: VinkinSpacing.sm),
            Expanded(
              child: Text(
                text,
                style: VinkinTypography.label.copyWith(color: VinkinColors.simulation),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
