import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../design_system/components/vinkin_button.dart';
import '../../design_system/spacing/vinkin_spacing.dart';
import '../../design_system/typography/vinkin_typography.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _usernameController = TextEditingController();
  final _displayNameController = TextEditingController();
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
          .register(
            username: _usernameController.text.trim(),
            displayName: _displayNameController.text.trim(),
            password: _passwordController.text,
          );
    } on ApiException catch (error) {
      setState(
        () => _error = error.code == 'USERNAME_TAKEN'
            ? 'That username is already taken.'
            : error.code == 'VALIDATION_FAILED'
            ? 'Username needs 3+ letters/numbers, password needs 10+ characters.'
            : error.toString(),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create an account')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VinkinSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _displayNameController,
                decoration: const InputDecoration(labelText: 'Your name'),
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: VinkinSpacing.md),
              TextField(
                controller: _usernameController,
                decoration: const InputDecoration(labelText: 'Username'),
                autocorrect: false,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: VinkinSpacing.md),
              TextField(
                controller: _passwordController,
                decoration: const InputDecoration(labelText: 'Password (10+ characters)'),
                obscureText: true,
                onSubmitted: (_) => _submit(),
              ),
              if (_error != null) ...[
                const SizedBox(height: VinkinSpacing.sm),
                Text(_error!, style: VinkinTypography.bodySecondary.copyWith(color: Colors.red)),
              ],
              const SizedBox(height: VinkinSpacing.lg),
              VinkinButton(label: 'Create account', loading: _submitting, onPressed: _submit),
            ],
          ),
        ),
      ),
    );
  }
}
