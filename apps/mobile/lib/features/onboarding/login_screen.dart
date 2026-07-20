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

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
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
          .login(username: _usernameController.text.trim(), password: _passwordController.text);
      // Navigation to /home happens via the router's redirect on AuthSignedIn.
    } on ApiException catch (error) {
      setState(() => _error = error.code == 'INVALID_CREDENTIALS' ? 'Incorrect username or password.' : 'Something went wrong. Try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VinkColors.paper,
      appBar: AppBar(backgroundColor: VinkColors.paper, surfaceTintColor: Colors.transparent, elevation: 0),
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
              if (_error != null) ...[const SizedBox(height: VinkSpacing.sm), VinkInlineError(message: _error!)],
              const SizedBox(height: VinkSpacing.lg),
              VinkPrimaryButton(label: 'Log in', glow: true, loading: _submitting, onPressed: _submit),
            ],
          ),
        ),
      ),
    );
  }
}
