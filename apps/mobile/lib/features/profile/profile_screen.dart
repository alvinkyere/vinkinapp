import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../design_system/components/vink_app_bar.dart';
import '../../design_system/components/vink_avatar.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);
    final user = authState is AuthSignedIn ? authState.user : null;

    return Scaffold(
      backgroundColor: VinkColors.paper,
      appBar: const VinkAppBar(title: 'Profile'),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VinkSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              VinkSurfaceCard(
                child: Row(
                  children: [
                    VinkAvatar(
                      name: user?.displayName ?? '?',
                      size: 56,
                      isSelf: true,
                    ),
                    const SizedBox(width: VinkSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            user?.displayName ?? '',
                            style: VinkTypography.cardTitle,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '@${user?.username ?? ''}',
                            style: VinkTypography.bodySecondary,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: VinkSpacing.xxl),
              VinkDestructiveButton(
                label: 'Sign out',
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).logout(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
