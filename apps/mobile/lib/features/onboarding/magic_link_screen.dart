import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/commands/command_state.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_step_header.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/components/vink_text_field.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';

/// ENG5 Slice 3 — two independent actions on one screen: request a link by email, or paste a
/// link/token already received (from this device or another) to finish signing in. The two
/// have separate [CommandRunner]s since they're unrelated actions with unrelated lifecycles —
/// completing via paste doesn't depend on having just requested one in this same app session
/// (the email might have been opened somewhere else entirely).
class MagicLinkScreen extends ConsumerStatefulWidget {
  const MagicLinkScreen({super.key});

  @override
  ConsumerState<MagicLinkScreen> createState() => _MagicLinkScreenState();
}

class _MagicLinkScreenState extends ConsumerState<MagicLinkScreen> {
  final _emailController = TextEditingController();
  final _pasteController = TextEditingController();

  void _guardedSetState(void Function() fn) {
    if (mounted) setState(fn);
  }

  late final _requestCommand = CommandRunner<void>(_guardedSetState, ref);
  late final _confirmCommand = CommandRunner<void>(_guardedSetState, ref);

  Future<void> _submitRequest() async {
    await _requestCommand.run(
      () => ref
          .read(authControllerProvider.notifier)
          .requestMagicLink(_emailController.text.trim()),
    );
  }

  Future<void> _submitConfirm() async {
    // Navigation to /home happens via the router's redirect on AuthSignedIn, same as
    // login/register — no onSuccess needed here.
    await _confirmCommand.run(
      () => ref
          .read(authControllerProvider.notifier)
          .confirmMagicLink(_pasteController.text),
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
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(VinkSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const VinkStepHeader(title: 'Log in with a link'),
              const SizedBox(height: VinkSpacing.lg),
              VinkSurfaceCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Email me a link', style: VinkTypography.cardTitle),
                    const SizedBox(height: VinkSpacing.sm),
                    switch (_requestCommand.state) {
                      CommandSuccess() => Text(
                        "If an account with that email exists, we've sent a "
                        'login link. Check your inbox.',
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
                            onSubmitted: (_) => _submitRequest(),
                          ),
                          if (_requestCommand.state case CommandFailure(
                            :final failure,
                          )) ...[
                            const SizedBox(height: VinkSpacing.sm),
                            VinkInlineError(message: failure.message),
                          ],
                          const SizedBox(height: VinkSpacing.sm),
                          VinkSecondaryButton(
                            label: 'Send login link',
                            loading: _requestCommand.state.isInProgress,
                            onPressed: _submitRequest,
                          ),
                        ],
                      ),
                    },
                  ],
                ),
              ),
              const SizedBox(height: VinkSpacing.md),
              VinkSurfaceCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Have a link already?',
                      style: VinkTypography.cardTitle,
                    ),
                    const SizedBox(height: VinkSpacing.sm),
                    Text(
                      'Paste the link or code from your email below.',
                      style: VinkTypography.bodySecondary,
                    ),
                    const SizedBox(height: VinkSpacing.sm),
                    VinkTextField(
                      label: 'Link or code',
                      controller: _pasteController,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _submitConfirm(),
                    ),
                    if (_confirmCommand.state case CommandFailure(
                      :final failure,
                    )) ...[
                      const SizedBox(height: VinkSpacing.sm),
                      VinkInlineError(message: failure.message),
                    ],
                    const SizedBox(height: VinkSpacing.sm),
                    VinkPrimaryButton(
                      label: 'Log in',
                      glow: true,
                      loading: _confirmCommand.state.isInProgress,
                      onPressed: _submitConfirm,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
