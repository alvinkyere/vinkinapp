import 'package:dio/dio.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../errors/api_exception.dart';
import '../storage/secure_token_store.dart';
import 'api_config.dart';

/// One Dio instance for the app: attaches the bearer token, and on a 401 attempts exactly
/// one refresh + retry before giving up (Plan §4 rotating refresh tokens; access tokens are
/// 15 minutes server-side — apps/api/src/auth/tokens.ts). A second consecutive 401 after
/// refresh means the session is truly gone; callers see [ApiException.isAuthError] and the
/// app routes to login (core/auth/auth_controller.dart).
class ApiClient {
  // ENG3: `dio` is injectable (mirrors `HttpAnalytics({Dio? dio})`,
  // `core/analytics/analytics.dart`) so a test can supply a mock adapter — e.g. to prove
  // request cancellation maps to `ApiException.isCancelled` without a real network call.
  // Every real caller omits it and gets the exact same production `Dio` as before. `appVersion`
  // is the same pattern for "app-version enforcement" — a test supplies a fixed value instead
  // of the real `PackageInfo.fromPlatform()` platform-channel call.
  ApiClient({required SecureTokenStore tokenStore, Dio? dio, Future<String>? appVersion})
    // ignore: prefer_initializing_formals — `_tokenStore` is deliberately private while the
    // constructor parameter stays public (`tokenStore`) for a readable call site elsewhere.
    : _tokenStore = tokenStore,
      _appVersion = appVersion ?? PackageInfo.fromPlatform().then((info) => info.version),
      _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: ApiConfig.baseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 15),
            ),
          ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _tokenStore.readAccessToken();
          if (token != null && !options.path.contains('/auth/')) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          // ENG3 ("app-version enforcement"): read once, reused for every request — the
          // running app's own version never changes mid-session. `app.ts`'s `onRequest` hook
          // only ever enforces this when the server has VINKIN_MINIMUM_APP_VERSION
          // configured; sending it unconditionally costs nothing when that's unset (today).
          options.headers['x-app-version'] = await _appVersion;
          handler.next(options);
        },
        onError: (error, handler) async {
          final isAuthFailure = error.response?.statusCode == 401;
          final alreadyRetried = error.requestOptions.extra['retried'] == true;
          if (isAuthFailure && !alreadyRetried && await _tryRefresh()) {
            final retried = await _dio.fetch(error.requestOptions..extra['retried'] = true);
            return handler.resolve(retried);
          }
          handler.next(error);
        },
      ),
    );
  }

  final Dio _dio;
  final SecureTokenStore _tokenStore;
  final Future<String> _appVersion;

  Future<bool> _tryRefresh() async {
    final refreshToken = await _tokenStore.readRefreshToken();
    if (refreshToken == null) return false;
    try {
      final response = await _dio.post('/api/v1/auth/refresh', data: {'refreshToken': refreshToken});
      await _tokenStore.save(
        accessToken: response.data['accessToken'] as String,
        refreshToken: response.data['refreshToken'] as String,
      );
      return true;
    } on DioException {
      await _tokenStore.clear();
      return false;
    }
  }

  // ENG3 ("request cancellation"): every method accepts an optional [CancelToken] — a caller
  // (typically a screen's own `dispose()`, or a newer request superseding an older one) can
  // abort the underlying HTTP request rather than just ignoring its eventual result. Optional
  // and additive: every existing call site that omits it behaves exactly as before.
  Future<Map<String, dynamic>> get(String path, {CancelToken? cancelToken}) =>
      _unwrap(_dio.get(path, cancelToken: cancelToken));

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    CancelToken? cancelToken,
  }) => _unwrap(_dio.post(path, data: body ?? const {}, cancelToken: cancelToken));

  Future<Map<String, dynamic>> put(
    String path, {
    Map<String, dynamic>? body,
    CancelToken? cancelToken,
  }) => _unwrap(_dio.put(path, data: body ?? const {}, cancelToken: cancelToken));

  /// Slice I5B (D40) — draft-only guest correction is this app's first PATCH endpoint.
  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic>? body,
    CancelToken? cancelToken,
  }) => _unwrap(_dio.patch(path, data: body ?? const {}, cancelToken: cancelToken));

  Future<void> delete(String path, {CancelToken? cancelToken}) =>
      _unwrap(_dio.delete(path, cancelToken: cancelToken)).then((_) {});

  /// For the handful of endpoints (e.g. `GET .../activity`) whose handler sends the
  /// resource list directly as the response body instead of wrapping it in an object.
  Future<List<dynamic>> getList(String path, {CancelToken? cancelToken}) async {
    try {
      final response = await _dio.get(path, cancelToken: cancelToken);
      return response.data as List<dynamic>;
    } on DioException catch (error) {
      throw _toApiException(error);
    }
  }

  Future<Map<String, dynamic>> _unwrap(Future<Response<dynamic>> request) async {
    try {
      final response = await request;
      return response.data as Map<String, dynamic>;
    } on DioException catch (error) {
      throw _toApiException(error);
    }
  }

  ApiException _toApiException(DioException error) {
    if (error.type == DioExceptionType.cancel) {
      // Not a server/network failure — the app cancelled its own request (screen disposed, a
      // newer request superseded it). `ApiException.isCancelled` lets a caller that still has
      // a reference to the exception skip any error-state handling for it entirely.
      return const ApiException(statusCode: 0, code: 'REQUEST_CANCELLED');
    }
    final data = error.response?.data;
    if (data is Map<String, dynamic>) {
      return ApiException(
        statusCode: error.response?.statusCode ?? 0,
        code: data['error'] as String? ?? 'UNKNOWN_ERROR',
        message: data['message'] as String?,
      );
    }
    return ApiException(statusCode: error.response?.statusCode ?? 0, code: 'NETWORK_ERROR', message: error.message);
  }
}
