import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../design_system/colors/vinkin_colors.dart';
import '../../design_system/components/vinkin_button.dart';
import '../../design_system/spacing/vinkin_spacing.dart';
import '../../design_system/typography/vinkin_typography.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VinkinSpacing.lg),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.groups_rounded, size: 72, color: VinkinColors.primary),
              const SizedBox(height: VinkinSpacing.lg),
              const Text('VinkIn', style: VinkinTypography.display, textAlign: TextAlign.center),
              const SizedBox(height: VinkinSpacing.sm),
              const Text(
                'A group pays together at the register — one card, one payment.',
                style: VinkinTypography.bodySecondary,
                textAlign: TextAlign.center,
              ),
              const Spacer(),
              VinkinButton(label: 'Create an account', onPressed: () => context.push('/register')),
              const SizedBox(height: VinkinSpacing.sm),
              VinkinButton(
                label: 'I already have an account',
                variant: VinkinButtonVariant.secondary,
                onPressed: () => context.push('/login'),
              ),
              const SizedBox(height: VinkinSpacing.md),
            ],
          ),
        ),
      ),
    );
  }
}
