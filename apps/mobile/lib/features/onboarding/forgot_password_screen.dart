import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/commands/command_state.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_step_header.dart';
import '../../design_system/components/vink_text_field.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';

/// ENG5 Slice 2 — the mobile app's role is entirely "collect an email and ask the server to
/// send a reset link." Completing a reset (typing the new password) happens outside the app,
/// on the plain HTML page the emailed link opens (`apps/api/src/modules/auth/routes.ts`'s
/// `passwordResetConfirmPage`) — the same split email verification already uses. No in-app
/// "enter new password" screen exists this slice; nothing here needs one.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _emailController = TextEditingController();

  void _guardedSetState(void Function() fn) {
    if (mounted) setState(fn);
  }

  late final _requestCommand = CommandRunner<void>(_guardedSetState, ref);

  Future<void> _submit() async {
    await _requestCommand.run(
      () => ref
          .read(authControllerProvider.notifier)
          .requestPasswordReset(_emailController.text.trim()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VinkColors.paper,
      appBar: AppBar(
        backgroundColor: VinkColors.paper,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VinkSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const VinkStepHeader(title: 'Reset your password'),
              const SizedBox(height: VinkSpacing.sm),
              Text(
                "Enter the email on your account and we'll send a link to reset "
                'your password.',
                style: VinkTypography.bodySecondary,
              ),
              const SizedBox(height: VinkSpacing.lg),
              switch (_requestCommand.state) {
                CommandSuccess() => Text(
                  "If an account with that email exists, we've sent a reset "
                  'link. Check your inbox.',
                  style: VinkTypography.bodySecondary,
                ),
                _ => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    VinkTextField(
                      label: 'Email',
                      controller: _emailController,
                      autofillHints: const [AutofillHints.email],
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _submit(),
                    ),
                    if (_requestCommand.state case CommandFailure(
                      :final failure,
                    )) ...[
                      const SizedBox(height: VinkSpacing.sm),
                      VinkInlineError(message: failure.message),
                    ],
                    const SizedBox(height: VinkSpacing.lg),
                    VinkPrimaryButton(
                      label: 'Send reset link',
                      glow: true,
                      loading: _requestCommand.state.isInProgress,
                      onPressed: _submit,
                    ),
                  ],
                ),
              },
            ],
          ),
        ),
      ),
    );
  }
}
