import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth/auth_controller.dart';
import 'failure_classifier.dart';

/// Applies the one cross-cutting side effect every screen needs identically — ending a
/// session a request has already proven dead — and returns the classification for the
/// caller to drive its own message/retry/refresh behavior from. Screens never call
/// `AuthController.expireSession()` directly; this is the one place that decision is made,
/// so it can never drift between screens.
ClassifiedFailure presentFailure(WidgetRef ref, Object error) {
  final failure = classifyFailure(error);
  if (failure.requiresSignIn) {
    unawaited(ref.read(authControllerProvider.notifier).expireSession());
  }
  return failure;
}
