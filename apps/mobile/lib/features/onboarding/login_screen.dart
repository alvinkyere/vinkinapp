import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../design_system/components/vinkin_button.dart';
import '../../design_system/spacing/vinkin_spacing.dart';
import '../../design_system/typography/vinkin_typography.dart';

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
      setState(() => _error = error.code == 'INVALID_CREDENTIALS' ? 'Incorrect username or password.' : error.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Log in')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VinkinSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _usernameController,
                decoration: const InputDecoration(labelText: 'Username'),
                autocorrect: false,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: VinkinSpacing.md),
              TextField(
                controller: _passwordController,
                decoration: const InputDecoration(labelText: 'Password'),
                obscureText: true,
                onSubmitted: (_) => _submit(),
              ),
              if (_error != null) ...[
                const SizedBox(height: VinkinSpacing.sm),
                Text(_error!, style: VinkinTypography.bodySecondary.copyWith(color: Colors.red)),
              ],
              const SizedBox(height: VinkinSpacing.lg),
              VinkinButton(label: 'Log in', loading: _submitting, onPressed: _submit),
            ],
          ),
        ),
      ),
    );
  }
}
