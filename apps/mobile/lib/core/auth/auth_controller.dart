import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../analytics/analytics.dart';
import '../models/user.dart';
import '../networking/api_client.dart';
import '../storage/secure_token_store.dart';
import 'auth_state.dart';

export 'auth_state.dart';

/// Session state for the whole app — the router (app/router.dart) redirects on this, and
/// every authenticated screen reads the current user/token from it rather than re-deriving
/// auth state locally.
class AuthController extends Notifier<AuthState> {
  late final ApiClient _client;
  late final SecureTokenStore _tokenStore;
  late final Analytics _analytics;

  @override
  AuthState build() {
    _client = ref.read(apiClientProvider);
    _tokenStore = ref.read(tokenStoreProvider);
    _analytics = ref.read(analyticsProvider);
    _restoreSession();
    return const AuthUnknown();
  }

  Future<void> _restoreSession() async {
    final token = await _tokenStore.readAccessToken();
    if (token == null) {
      state = const AuthSignedOut();
      return;
    }
    try {
      final response = await _client.get('/api/v1/me');
      state = AuthSignedIn(
        VinkinUser.fromJson(response['user'] as Map<String, dynamic>),
        token,
      );
    } catch (_) {
      await _tokenStore.clear();
      state = const AuthSignedOut();
    }
  }

  /// Slice I4 (D19/D27): [email]/[phone] are optional — the contact destination automatic
  /// invitation delivery would use, captured once here (Profile is the only other place it
  /// can ever be revisited, `PATCH /api/v1/me`, not yet wired into a screen this pass).
  Future<void> register({
    required String username,
    required String displayName,
    required String password,
    String? email,
    String? phone,
  }) async {
    final response = await _client.post(
      '/api/v1/auth/register',
      body: {
        'username': username,
        'displayName': displayName,
        'password': password,
        if (email != null && email.isNotEmpty) 'email': email,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
      },
    );
    await _onAuthenticated(response);
    _analytics.track('organizer_registered', {'username': username});
  }

  Future<void> login({
    required String username,
    required String password,
  }) async {
    final response = await _client.post(
      '/api/v1/auth/login',
      body: {'username': username, 'password': password},
    );
    await _onAuthenticated(response);
    _analytics.track('organizer_logged_in', {'username': username});
  }

  Future<void> _onAuthenticated(Map<String, dynamic> response) async {
    await _tokenStore.save(
      accessToken: response['accessToken'] as String,
      refreshToken: response['refreshToken'] as String,
    );
    state = AuthSignedIn(
      VinkinUser.fromJson(response['user'] as Map<String, dynamic>),
      response['accessToken'] as String,
    );
  }

  /// ENG1 #3: called when a request's own retry-once-after-refresh already failed
  /// (`ApiClient`'s interceptor) — the session is provably dead server-side, distinct from
  /// `logout()` (a deliberate user action that also tells the server). No network call here;
  /// the server already doesn't recognize this session. Router redirects to `/welcome`
  /// reactively off this state change, same as any other sign-out.
  Future<void> expireSession() async {
    await _tokenStore.clear();
    state = const AuthSignedOut();
  }

  /// ENG5 Slice 1 — triggers a resend of the verification email to the account's own current
  /// address (`POST /api/v1/auth/email/verify/request`). Deliberately does not update [state]
  /// on success: verification status only changes once the emailed link is clicked, which
  /// happens outside this app entirely — the caller re-checks via `/api/v1/me` on next launch
  /// or a manual refresh, not via any signal this call itself could produce.
  Future<void> resendEmailVerification() =>
      _client.post('/api/v1/auth/email/verify/request');

  /// ENG5 Slice 2 — unauthenticated by necessity (forgot-password means not signed in). The
  /// server's own response is identical whether or not [email] has an account (account-
  /// enumeration defense, `requestPasswordReset` in `apps/api/src/modules/auth/service.ts`) —
  /// this call always resolves successfully from the caller's point of view; there is no
  /// "wrong email" failure mode to distinguish here, by design.
  Future<void> requestPasswordReset(String email) => _client.post(
    '/api/v1/auth/password-reset/request',
    body: {'email': email},
  );

  /// ENG5 Slice 3 — same unauthenticated, always-succeeds-from-the-caller's-view shape as
  /// [requestPasswordReset], for the identical account-enumeration reason.
  Future<void> requestMagicLink(String email) =>
      _client.post('/api/v1/auth/magic-link/request', body: {'email': email});

  /// ENG5 Slice 3 — completes a magic-link login. [linkOrToken] accepts either the bare
  /// `mlt_...` token or the full emailed URL (`.../magic-link/confirm?token=mlt_...`), since
  /// the expected input is literally pasted out of an email app by a person — extracting the
  /// token from a pasted link is this method's job, not something to ask the user to do by
  /// hand. Unlike [requestPasswordReset]/[requestMagicLink] above, this genuinely can fail
  /// (an invalid/expired/reused token) and genuinely succeeds into a real signed-in [state],
  /// same as [login]/[register].
  Future<void> confirmMagicLink(String linkOrToken) async {
    final token = _extractMagicLinkToken(linkOrToken);
    final response = await _client.post(
      '/api/v1/auth/magic-link/confirm',
      body: {'token': token},
    );
    await _onAuthenticated(response);
  }

  String _extractMagicLinkToken(String linkOrToken) {
    final trimmed = linkOrToken.trim();
    final uri = Uri.tryParse(trimmed);
    final fromQuery = uri?.queryParameters['token'];
    return (fromQuery != null && fromQuery.isNotEmpty) ? fromQuery : trimmed;
  }

  Future<void> logout() async {
    final refreshToken = await _tokenStore.readRefreshToken();
    await _tokenStore.clear();
    state = const AuthSignedOut();
    if (refreshToken != null) {
      // Best-effort; the app has already forgotten the session locally either way.
      await _client
          .post('/api/v1/auth/logout', body: {'refreshToken': refreshToken})
          .catchError((_) => <String, dynamic>{});
    }
    _analytics.track('organizer_logged_out');
  }
}

final tokenStoreProvider = Provider<SecureTokenStore>(
  (ref) => SecureTokenStore(),
);
final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(tokenStore: ref.read(tokenStoreProvider)),
);
final analyticsProvider = Provider<Analytics>((ref) => HttpAnalytics());
final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
