import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

/// Every empty state must offer a next action (design correction requirement) — this
/// widget makes that structurally impossible to skip by requiring [action].
class VinkEmptyState extends StatelessWidget {
  const VinkEmptyState({
    super.key,
    required this.title,
    required this.message,
    required this.action,
  });

  final String title;
  final String message;
  final Widget action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: VinkSpacing.xl,
        vertical: VinkSpacing.xxl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            title,
            style: VinkTypography.cardTitle,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: VinkSpacing.sm),
          Text(
            message,
            style: VinkTypography.bodySecondary,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: VinkSpacing.lg),
          action,
        ],
      ),
    );
  }
}

/// A deliberate, branded loading state — never a bare `CircularProgressIndicator` floating
/// on blank white (explicitly forbidden by the design correction brief).
class VinkLoadingState extends StatelessWidget {
  const VinkLoadingState({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 2.5,
              color: VinkColors.blue,
            ),
          ),
          if (message != null) ...[
            const SizedBox(height: VinkSpacing.md),
            Text(
              message!,
              style: VinkTypography.bodySecondary,
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}
