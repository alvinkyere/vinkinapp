import 'package:dio/dio.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/core/networking/api_client.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';

/// Slice I5 — a network-free `ApiClient` test double. `ApiClient`'s `get`/`post`/`put`/
/// `getList` are plain (non-`final`) instance methods, so overriding them here bypasses the
/// real `Dio` instance entirely — no HTTP mocking package, no production-code change. The
/// constructor's `SecureTokenStore` is never actually used (the real methods it would back
/// are never called), so a bare unconfigured instance is harmless.
///
/// Callers supply a single [handler] that inspects `(method, path, body)` and returns the
/// canned response, or throws an [ApiException] to simulate a server error — the same shape
/// every screen's `on ApiException catch` blocks already handle.
class FakeApiClient extends ApiClient {
  FakeApiClient(this.handler) : super(tokenStore: SecureTokenStore());

  final Future<Map<String, dynamic>> Function(String method, String path, Map<String, dynamic>? body) handler;

  final List<({String method, String path, Map<String, dynamic>? body})> calls = [];

  // ENG3: `cancelToken` is accepted (matching `ApiClient`'s real signature, required for a
  // valid override) but never consulted — this fake bypasses `Dio` entirely, so there is no
  // real request for a token to cancel. A test that specifically exercises cancellation
  // behavior does so against a real `ApiClient` + fake `Dio` adapter instead (see
  // `test/core/networking/api_client_test.dart`), not through this double.
  @override
  Future<Map<String, dynamic>> get(String path, {CancelToken? cancelToken}) =>
      _dispatch('GET', path, null);

  @override
  Future<Map<String, dynamic>> post(String path, {Map<String, dynamic>? body, CancelToken? cancelToken}) =>
      _dispatch('POST', path, body);

  @override
  Future<Map<String, dynamic>> put(String path, {Map<String, dynamic>? body, CancelToken? cancelToken}) =>
      _dispatch('PUT', path, body);

  @override
  Future<Map<String, dynamic>> patch(String path, {Map<String, dynamic>? body, CancelToken? cancelToken}) =>
      _dispatch('PATCH', path, body);

  @override
  Future<void> delete(String path, {CancelToken? cancelToken}) => _dispatch('DELETE', path, null).then((_) {});

  @override
  Future<List<dynamic>> getList(String path, {CancelToken? cancelToken}) async => const [];

  Future<Map<String, dynamic>> _dispatch(String method, String path, Map<String, dynamic>? body) async {
    calls.add((method: method, path: path, body: body));
    return handler(method, path, body);
  }
}
