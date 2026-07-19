import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../design_system/components/vinkin_button.dart';
import '../../design_system/spacing/vinkin_spacing.dart';
import '../../design_system/typography/vinkin_typography.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);
    final user = authState is AuthSignedIn ? authState.user : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VinkinSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(user?.displayName ?? '', style: VinkinTypography.title),
              const SizedBox(height: VinkinSpacing.xs),
              Text('@${user?.username ?? ''}', style: VinkinTypography.bodySecondary),
              const Spacer(),
              VinkinButton(
                label: 'Log out',
                variant: VinkinButtonVariant.destructive,
                onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
