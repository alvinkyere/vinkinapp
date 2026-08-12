import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

/// RM4C-G — distinct from [VinkSimulationNotice] (which covers the mock-money card/merchant
/// simulation): this specifically discloses that a REAL Stripe sandbox card flow is in use —
/// genuinely processed by Stripe, but in test mode, so no real money moves. Shown only in
/// stripe_sandbox mode.
class VinkSandboxModeBanner extends StatelessWidget {
  const VinkSandboxModeBanner({super.key});

  @override
  Widget build(BuildContext context) {
    const text = 'Test mode — no real money will be charged.';
    return Semantics(
      label: 'Sandbox mode notice: $text',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          vertical: VinkSpacing.sm + 2,
          horizontal: VinkSpacing.md,
        ),
        decoration: BoxDecoration(
          color: VinkColors.blue.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            const Icon(Icons.science_outlined, size: 16, color: VinkColors.blue),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: Text(
                text,
                style: VinkTypography.bodySmallSecondary.copyWith(
                  color: VinkColors.blue,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
