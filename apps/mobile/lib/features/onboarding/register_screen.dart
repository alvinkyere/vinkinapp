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

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _usernameController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _passwordController = TextEditingController();
  // Slice I4 (D19/D27) — optional; the contact destination automatic invitation delivery
  // would use. Neither field is required — a VinkIn account never needs one to function.
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();

  // ENG3 Slice 6 ("typed error mapping completion"): replaces the ad hoc `bool _submitting` +
  // `String? _error` pair and the hand-rolled `error.code == '...' ? ... : ...` chain with the
  // same typed `CommandRunner`/`classifyFailure` pipeline every other mutating screen already
  // uses. One deliberate, disclosed simplification: `VALIDATION_FAILED` now shows the shared
  // generic message ("Please check the details and try again.", `human_errors.dart`) instead
  // of this screen's previous, more specific "Username needs 3+ letters/numbers, password
  // needs 10+ characters." — `ClassifiedFailure` doesn't carry the original error code, so a
  // per-code override here would mean either widening the shared classifier's return type for
  // one screen's copy preference, or hand-parsing the raw exception again defeating the point
  // of this migration. `VALIDATION_FAILED` is shared by many other call sites with the generic
  // message already; this makes register consistent with all of them rather than a one-off
  // exception, at the cost of a small, real specificity loss — flagged here, not hidden.
  void _guardedSetState(void Function() fn) {
    if (mounted) setState(fn);
  }

  late final _registerCommand = CommandRunner<void>(_guardedSetState, ref);

  bool get _submitting => _registerCommand.state.isInProgress;
  String? get _error => switch (_registerCommand.state) {
    CommandFailure(:final failure) => failure.message,
    _ => null,
  };

  Future<void> _submit() async {
    await _registerCommand.run(
      () => ref
          .read(authControllerProvider.notifier)
          .register(
            username: _usernameController.text.trim(),
            displayName: _displayNameController.text.trim(),
            password: _passwordController.text,
            email: _emailController.text.trim(),
            phone: _phoneController.text.trim(),
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
      // ENG3 Slice 6: a real, previously-undiscovered overflow bug caught while adding a
      // widget test for this screen — Phase 4 §3 (Register) explicitly specifies "Scroll
      // behavior: content scrolls above the keyboard on small devices... same as Login, more
      // fields so more likely to need it," but this screen had no scroll wrapper at all,
      // overflowing on a phone-sized viewport once the D19/D27 contact-info fields brought
      // the total to five. This wraps the existing content in the scroll container the
      // screen contract already called for — no new layout/UX decision, an already-approved
      // requirement that was missed when those two fields were added.
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(VinkSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const VinkStepHeader(title: 'Create an account'),
              const SizedBox(height: VinkSpacing.lg),
              VinkTextField(
                label: 'Your name',
                controller: _displayNameController,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: VinkSpacing.md),
              VinkTextField(
                label: 'Username',
                controller: _usernameController,
                autofillHints: const [AutofillHints.newUsername],
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: VinkSpacing.md),
              VinkTextField(
                label: 'Email (optional)',
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: VinkSpacing.md),
              VinkTextField(
                label: 'Phone (optional)',
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: VinkSpacing.md),
              VinkTextField(
                label: 'Password (10+ characters)',
                controller: _passwordController,
                autofillHints: const [AutofillHints.newPassword],
                obscureText: true,
                onSubmitted: (_) => _submit(),
              ),
              if (_error != null) ...[
                const SizedBox(height: VinkSpacing.sm),
                VinkInlineError(message: _error!),
              ],
              const SizedBox(height: VinkSpacing.lg),
              VinkPrimaryButton(
                label: 'Create account',
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
