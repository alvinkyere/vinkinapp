import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
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
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .register(
            username: _usernameController.text.trim(),
            displayName: _displayNameController.text.trim(),
            password: _passwordController.text,
            email: _emailController.text.trim(),
            phone: _phoneController.text.trim(),
          );
    } on ApiException catch (error) {
      setState(
        () => _error = error.code == 'USERNAME_TAKEN'
            ? 'That username is already taken.'
            : error.code == 'VALIDATION_FAILED'
            ? 'Username needs 3+ letters/numbers, password needs 10+ characters.'
            : 'Something went wrong. Try again.',
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
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
