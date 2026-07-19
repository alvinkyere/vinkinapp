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
      state = AuthSignedIn(VinkinUser.fromJson(response['user'] as Map<String, dynamic>), token);
    } catch (_) {
      await _tokenStore.clear();
      state = const AuthSignedOut();
    }
  }

  Future<void> register({required String username, required String displayName, required String password}) async {
    final response = await _client.post(
      '/api/v1/auth/register',
      body: {'username': username, 'displayName': displayName, 'password': password},
    );
    await _onAuthenticated(response);
    _analytics.track('organizer_registered', {'username': username});
  }

  Future<void> login({required String username, required String password}) async {
    final response = await _client.post('/api/v1/auth/login', body: {'username': username, 'password': password});
    await _onAuthenticated(response);
    _analytics.track('organizer_logged_in', {'username': username});
  }

  Future<void> _onAuthenticated(Map<String, dynamic> response) async {
    await _tokenStore.save(
      accessToken: response['accessToken'] as String,
      refreshToken: response['refreshToken'] as String,
    );
    state = AuthSignedIn(VinkinUser.fromJson(response['user'] as Map<String, dynamic>), response['accessToken'] as String);
  }

  Future<void> logout() async {
    final refreshToken = await _tokenStore.readRefreshToken();
    await _tokenStore.clear();
    state = const AuthSignedOut();
    if (refreshToken != null) {
      // Best-effort; the app has already forgotten the session locally either way.
      await _client.post('/api/v1/auth/logout', body: {'refreshToken': refreshToken}).catchError((_) => <String, dynamic>{});
    }
    _analytics.track('organizer_logged_out');
  }
}

final tokenStoreProvider = Provider<SecureTokenStore>((ref) => SecureTokenStore());
final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(tokenStore: ref.read(tokenStoreProvider)));
final analyticsProvider = Provider<Analytics>((ref) => DebugAnalytics());
final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);
