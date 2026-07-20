import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/auth/auth_controller.dart';
import '../features/activity/activity_screen.dart';
import '../features/create_vink/create_vink_screen.dart';
import '../features/home/home_screen.dart';
import '../features/onboarding/login_screen.dart';
import '../features/onboarding/register_screen.dart';
import '../features/onboarding/welcome_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/vink_lobby/vink_lobby_screen.dart';
import 'nav_shell.dart';

/// The Flutter client never re-derives backend state-machine logic (Plan §19) — it also
/// never re-derives AUTH logic: this redirect is the one place session state decides what
/// screen is reachable.
GoRouter buildRouter(Ref ref) {
  return GoRouter(
    initialLocation: '/welcome',
    refreshListenable: _AuthListenable(ref),
    redirect: (context, state) {
      final authState = ref.read(authControllerProvider);
      final onboardingRoute = {'/welcome', '/login', '/register'}.contains(state.matchedLocation);
      if (authState is AuthUnknown) return null; // still restoring the session — hold position
      if (authState is AuthSignedOut && !onboardingRoute) return '/welcome';
      if (authState is AuthSignedIn && onboardingRoute) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/welcome', builder: (context, state) => const WelcomeScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/register', builder: (context, state) => const RegisterScreen()),
      // Pushed full-screen, above the tab bar — not part of any branch's own stack, since
      // creating/viewing a Vink is a focused task, not a persistent tab destination.
      GoRoute(path: '/create-vink', builder: (context, state) => const CreateVinkScreen()),
      GoRoute(
        path: '/vinks/:vinkId',
        builder: (context, state) => VinkLobbyScreen(vinkId: state.pathParameters['vinkId']!),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => VinkNavShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (context, state) => const HomeScreen())]),
          StatefulShellBranch(
            routes: [GoRoute(path: '/activity', builder: (context, state) => const ActivityScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen())],
          ),
        ],
      ),
    ],
  );
}

/// Bridges Riverpod's provider stream to GoRouter's `Listenable` refresh hook, so a login/
/// logout immediately re-evaluates `redirect` without the user navigating manually.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(this._ref) {
    _subscription = _ref.listen(authControllerProvider, (_, _) => notifyListeners());
  }

  final Ref _ref;
  late final ProviderSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}
