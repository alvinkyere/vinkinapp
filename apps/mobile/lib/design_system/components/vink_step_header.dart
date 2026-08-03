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

/// Concept-image step progress: connected circle nodes, not a dot row — "step 2 of 5"
/// without technical labels. A node is solid blue once reached (current or done), a hollow
/// gray ring while still ahead; the connecting line between two reached nodes is blue, gray
/// otherwise.
class VinkStepDots extends StatelessWidget {
  const VinkStepDots({
    super.key,
    required this.stepIndex,
    required this.stepCount,
  });

  final int stepIndex;
  final int stepCount;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Step ${stepIndex + 1} of $stepCount',
      child: Row(
        children: [
          for (var index = 0; index < stepCount; index++) ...[
            if (index > 0)
              Expanded(
                child: Container(
                  height: 2,
                  color: index <= stepIndex
                      ? VinkColors.blue
                      : VinkColors.ink.withValues(alpha: 0.12),
                ),
              ),
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: index <= stepIndex
                    ? VinkColors.blue
                    : Colors.transparent,
                border: index <= stepIndex
                    ? null
                    : Border.all(
                        color: VinkColors.ink.withValues(alpha: 0.2),
                        width: 1.5,
                      ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
