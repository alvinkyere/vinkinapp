import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

/// The heading + supporting copy pattern every create-Vink step uses ("What are you paying
/// for?" / "What is the total?" / "Who's in?" / "How should everyone pay?" / "Review your
/// Vink") — display font heading, body-secondary supporting line underneath.
class VinkStepHeader extends StatelessWidget {
  const VinkStepHeader({super.key, required this.title, this.supportingText});

  final String title;
  final String? supportingText;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: VinkTypography.title),
        if (supportingText != null) ...[
          const SizedBox(height: VinkSpacing.xs),
          Text(supportingText!, style: VinkTypography.bodySecondary),
        ],
      ],
    );
  }
}

/// A lightweight step progress dots row — "step 2 of 5" without technical labels.
class VinkStepDots extends StatelessWidget {
  const VinkStepDots({super.key, required this.stepIndex, required this.stepCount});

  final int stepIndex;
  final int stepCount;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Step ${stepIndex + 1} of $stepCount',
      child: Row(
        children: List.generate(stepCount, (index) {
          final active = index == stepIndex;
          return Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Container(
              width: active ? 20 : 6,
              height: 6,
              decoration: BoxDecoration(
                color: active ? VinkColors.blue : VinkColors.ink.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          );
        }),
      ),
    );
  }
}
