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

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();

  // ENG3 Slice 6 ("typed error mapping completion"): replaces the ad hoc `bool _submitting` +
  // `String? _error` pair (whose catch block also never checked `mounted`, unlike this
  // screen's own `finally` block one line below it — a real, if minor, latent gap fixed for
  // free by `CommandRunner`'s own `_guardedSetState`-shaped closure) and the hand-rolled
  // `error.code == 'INVALID_CREDENTIALS' ? ... : ...` check with the same typed
  // `CommandRunner`/`classifyFailure` pipeline every other mutating screen already uses
  // (`vink_lobby_screen.dart`, Slice 2).
  void _guardedSetState(void Function() fn) {
    if (mounted) setState(fn);
  }

  late final _loginCommand = CommandRunner<void>(_guardedSetState, ref);

  bool get _submitting => _loginCommand.state.isInProgress;
  String? get _error => switch (_loginCommand.state) {
    CommandFailure(:final failure) => failure.message,
    _ => null,
  };

  Future<void> _submit() async {
    // Navigation to /home happens via the router's redirect on AuthSignedIn — no onSuccess
    // needed here.
    await _loginCommand.run(
      () => ref
          .read(authControllerProvider.notifier)
          .login(
            username: _usernameController.text.trim(),
            password: _passwordController.text,
          ),
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
              const VinkStepHeader(title: 'Log in'),
              const SizedBox(height: VinkSpacing.lg),
              VinkTextField(
                label: 'Username',
                controller: _usernameController,
                autofillHints: const [AutofillHints.username],
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: VinkSpacing.md),
              VinkTextField(
                label: 'Password',
                controller: _passwordController,
                autofillHints: const [AutofillHints.password],
                obscureText: true,
                onSubmitted: (_) => _submit(),
              ),
              if (_error != null) ...[
                const SizedBox(height: VinkSpacing.sm),
                VinkInlineError(message: _error!),
              ],
              const SizedBox(height: VinkSpacing.lg),
              VinkPrimaryButton(
                label: 'Log in',
                glow: true,
                loading: _submitting,
                onPressed: _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
