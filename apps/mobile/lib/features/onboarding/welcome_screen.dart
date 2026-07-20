import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_logo.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VinkColors.paper,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VinkSpacing.lg),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const VinkWordmark(fontSize: 32),
              const SizedBox(height: VinkSpacing.lg),
              Text('Everyone In. One Purchase.', style: VinkTypography.heroDisplay, textAlign: TextAlign.center),
              const SizedBox(height: VinkSpacing.sm),
              Text('Pay together before anyone pays.', style: VinkTypography.bodySecondary, textAlign: TextAlign.center),
              const Spacer(),
              VinkPrimaryButton(label: 'Create an account', glow: true, onPressed: () => context.push('/register')),
              const SizedBox(height: VinkSpacing.sm),
              VinkSecondaryButton(label: 'I already have an account', onPressed: () => context.push('/login')),
              const SizedBox(height: VinkSpacing.md),
            ],
          ),
        ),
      ),
    );
  }
}
