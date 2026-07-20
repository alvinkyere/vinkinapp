import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

/// Errors render near the action that caused them, not only as a snackbar (design
/// correction requirement, especially for financial/split validation). Human copy is the
/// CALLER's job (see lib/core/errors/human_errors.dart) — this widget just presents it.
class VinkInlineError extends StatelessWidget {
  const VinkInlineError({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.md, vertical: VinkSpacing.sm + 2),
        decoration: BoxDecoration(
          color: VinkColors.danger.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: VinkColors.danger.withValues(alpha: 0.2)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('!', style: TextStyle(color: VinkColors.danger, fontWeight: FontWeight.w800)),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: Text(message, style: VinkTypography.bodySmall.copyWith(color: VinkColors.danger)),
            ),
          ],
        ),
      ),
    );
  }
}
