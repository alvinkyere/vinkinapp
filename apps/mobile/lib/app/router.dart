import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/auth/auth_controller.dart';
import '../core/config/feature_flags.dart';
import '../features/activity/activity_screen.dart';
import '../features/create_vink/canonical/canonical_create_vink_screen.dart';
import '../features/create_vink/create_vink_screen.dart';
import '../features/home/home_screen.dart';
import '../features/invites/invites_screen.dart';
import '../features/onboarding/login_screen.dart';
import '../features/onboarding/register_screen.dart';
import '../features/onboarding/welcome_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/vink_details/vink_details_screen.dart';
import '../features/vink_lobby/vink_lobby_screen.dart';
import 'nav_shell.dart';

/// The Flutter client never re-derives backend state-machine logic (Plan §19) — it also
/// never re-derives AUTH logic: this redirect is the one place session state decides what
/// screen is reachable.
///
/// Slice I5 (D30): [canonicalCreateFlow] defaults to `FeatureFlags.canonicalCreateFlow`
/// (the real, `--dart-define`-driven flag) but stays an overridable parameter so tests can
/// exercise both the flag-on and flag-off route builders without recompiling. Both
/// `/create-vink` and `/create-vink/resume/:vinkId` gate their builder on this single flag —
/// "the entire screen sequence as one unit," never a half-migrated hybrid — so neither Home
/// nor `VinkLobbyScreen`'s own DRAFT redirect (both untouched, still literal `/create-vink`
/// path strings) needs to know which flow is active.
/// Slice I6 adds [homeActivityV2] as the same kind of overridable parameter, for the same
/// reason: Home's two-section redesign, Activity's outcome-summary list, and the new Vink
/// Details screen gate on it as one unit (Phase 10 §11's own flag table).
/// Invites feature (D44) adds [invitesEnabled] the same way — it changes the STATEFUL SHELL'S
/// OWN BRANCH COUNT (a 4th `/invites` branch), not just a visual toggle, so `VinkNavShell`
/// must be told the exact same resolved value this function used.
GoRouter buildRouter(
  Ref ref, {
  bool? canonicalCreateFlow,
  bool? homeActivityV2,
  bool? invitesEnabled,
}) {
  final useCanonicalCreateFlow =
      canonicalCreateFlow ?? FeatureFlags.canonicalCreateFlow;
  final useHomeActivityV2 = homeActivityV2 ?? FeatureFlags.homeActivityV2;
  final useInvitesEnabled = invitesEnabled ?? FeatureFlags.invitesEnabled;
  return GoRouter(
    initialLocation: '/welcome',
    refreshListenable: _AuthListenable(ref),
    redirect: (context, state) {
      final authState = ref.read(authControllerProvider);
      final onboardingRoute = {
        '/welcome',
        '/login',
        '/register',
      }.contains(state.matchedLocation);
      if (authState is AuthUnknown) {
        return null; // still restoring the session — hold position
      }
      if (authState is AuthSignedOut && !onboardingRoute) return '/welcome';
      if (authState is AuthSignedIn && onboardingRoute) return '/home';
      return null;
    },
    routes: [
      GoRoute(
        path: '/welcome',
        builder: (context, state) => const WelcomeScreen(),
      ),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      // Pushed full-screen, above the tab bar — not part of any branch's own stack, since
      // creating/viewing a Vink is a focused task, not a persistent tab destination.
      GoRoute(
        path: '/create-vink',
        builder: (context, state) => useCanonicalCreateFlow
            ? const CanonicalCreateVinkScreen()
            : const CreateVinkScreen(),
      ),
      // ENG1 #5 setup recovery: resumes a server-persisted DRAFT Vink at its exact valid
      // step, rather than starting a new one. Reached from Home's Active Vinks card and from
      // VinkLobbyScreen's own DRAFT redirect — never from a "Draft" label alone deciding.
      GoRoute(
        path: '/create-vink/resume/:vinkId',
        builder: (context, state) => useCanonicalCreateFlow
            ? CanonicalCreateVinkScreen(
                resumeVinkId: state.pathParameters['vinkId']!,
              )
            : CreateVinkScreen(resumeVinkId: state.pathParameters['vinkId']!),
      ),
      // Slice I2B: `?role=participant` (set only by Home's participant-role card tap) tells
      // the lobby to use the customer-safe participant-view route instead of the
      // organizer-only snapshot route. Absent for every other caller (deep links, the
      // post-create redirect, existing organizer navigation) — defaults to today's exact
      // organizer behavior inside VinkLobbyScreen itself.
      GoRoute(
        path: '/vinks/:vinkId',
        builder: (context, state) => VinkLobbyScreen(
          vinkId: state.pathParameters['vinkId']!,
          role: state.uri.queryParameters['role'],
        ),
      ),
      // Slice I6 (Phase 4 §11's own named route) — pushed full-screen, no tab bar, matching
      // Phase 8 §22's exact "Vink Details" composition. Only reachable when the flag is on;
      // Activity's own row-tap navigation is the sole caller.
      GoRoute(
        path: '/activity/:vinkId',
        builder: (context, state) =>
            VinkDetailsScreen(vinkId: state.pathParameters['vinkId']!),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => VinkNavShell(
          navigationShell: navigationShell,
          invitesEnabled: useInvitesEnabled,
        ),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (context, state) =>
                    HomeScreen(homeActivityV2: useHomeActivityV2),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/activity',
                builder: (context, state) =>
                    ActivityScreen(homeActivityV2: useHomeActivityV2),
              ),
            ],
          ),
          // Invites feature (D44) — inserted before Profile so the branch INDEX order matches
          // VinkNavShell's own tab order (Home, Activity, Invites, Profile) exactly; omitted
          // entirely when the flag is off, so Profile stays branch index 2, unchanged.
          if (useInvitesEnabled)
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/invites',
                  builder: (context, state) => const InvitesScreen(),
                ),
              ],
            ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (context, state) => const ProfileScreen(),
              ),
            ],
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
    _subscription = _ref.listen(
      authControllerProvider,
      (_, _) => notifyListeners(),
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}
