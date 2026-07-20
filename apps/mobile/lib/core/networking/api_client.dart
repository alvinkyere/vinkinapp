import 'package:dio/dio.dart';
import '../errors/api_exception.dart';
import '../storage/secure_token_store.dart';
import 'api_config.dart';

/// One Dio instance for the app: attaches the bearer token, and on a 401 attempts exactly
/// one refresh + retry before giving up (Plan §4 rotating refresh tokens; access tokens are
/// 15 minutes server-side — apps/api/src/auth/tokens.ts). A second consecutive 401 after
/// refresh means the session is truly gone; callers see [ApiException.isAuthError] and the
/// app routes to login (core/auth/auth_controller.dart).
class ApiClient {
  ApiClient({required SecureTokenStore tokenStore})
    // ignore: prefer_initializing_formals — `_tokenStore` is deliberately private while the
    // constructor parameter stays public (`tokenStore`) for a readable call site elsewhere.
    : _tokenStore = tokenStore,
      _dio = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl, connectTimeout: const Duration(seconds: 10))) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _tokenStore.readAccessToken();
          if (token != null && !options.path.contains('/auth/')) {
            options.headers['Authorization'] = 'Bearer $token';
          }
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

  Future<Map<String, dynamic>> get(String path) => _unwrap(_dio.get(path));

  Future<Map<String, dynamic>> post(String path, {Map<String, dynamic>? body}) =>
      _unwrap(_dio.post(path, data: body ?? const {}));

  Future<Map<String, dynamic>> put(String path, {Map<String, dynamic>? body}) =>
      _unwrap(_dio.put(path, data: body ?? const {}));

  /// For the handful of endpoints (e.g. `GET .../activity`) whose handler sends the
  /// resource list directly as the response body instead of wrapping it in an object.
  Future<List<dynamic>> getList(String path) async {
    try {
      final response = await _dio.get(path);
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
