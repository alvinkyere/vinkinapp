import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/commands/command_state.dart';
import '../../design_system/components/vink_app_bar.dart';
import '../../design_system/components/vink_avatar.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  late final CommandRunner<void> _resendCommand = CommandRunner<void>(
    setState,
    ref,
  );

  @override
  Widget build(BuildContext context) {
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
              // ENG5 Slice 1 — verification status only ever shown when there's an email on
              // file at all; no card for an account with none (nothing to verify).
              if (user?.email != null) ...[
                const SizedBox(height: VinkSpacing.md),
                _EmailVerificationCard(
                  email: user!.email!,
                  verified: user.emailVerified,
                  command: _resendCommand,
                  onResend: () => _resendCommand.run(
                    () => ref
                        .read(authControllerProvider.notifier)
                        .resendEmailVerification(),
                  ),
                ),
              ],
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

class _EmailVerificationCard extends StatelessWidget {
  const _EmailVerificationCard({
    required this.email,
    required this.verified,
    required this.command,
    required this.onResend,
  });

  final String email;
  final bool verified;
  final CommandRunner<void> command;
  final VoidCallback onResend;

  @override
  Widget build(BuildContext context) {
    return VinkSurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                verified
                    ? Icons.check_circle_rounded
                    : Icons.info_outline_rounded,
                // No success/green in this design system (docs/design/vinkin-design-system.md
                // — vinkin.org's own "paid" checkmark is blue, not green); matches that.
                color: verified ? VinkColors.blue : VinkColors.ink,
                size: 20,
              ),
              const SizedBox(width: VinkSpacing.sm),
              Expanded(
                child: Text(
                  email,
                  style: VinkTypography.bodySmall,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            verified ? 'Verified' : 'Not verified yet',
            style: VinkTypography.bodySmallSecondary,
          ),
          if (!verified) ...[
            const SizedBox(height: VinkSpacing.sm),
            switch (command.state) {
              CommandSuccess() => Text(
                'Verification email sent — check your inbox.',
                style: VinkTypography.bodySmallSecondary,
              ),
              CommandFailure(:final failure) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  VinkInlineError(message: failure.message),
                  const SizedBox(height: VinkSpacing.sm),
                  VinkSecondaryButton(
                    label: 'Resend verification email',
                    onPressed: onResend,
                  ),
                ],
              ),
              CommandInProgress() => VinkSecondaryButton(
                label: 'Resend verification email',
                loading: true,
                onPressed: onResend,
              ),
              CommandIdle() => VinkSecondaryButton(
                label: 'Resend verification email',
                onPressed: onResend,
              ),
            },
          ],
        ],
      ),
    );
  }
}
