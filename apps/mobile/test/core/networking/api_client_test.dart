import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/core/networking/api_client.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';

/// A [HttpClientAdapter] whose `fetch()` never resolves on its own — real network I/O is
/// never involved, only Dio's own cancellation handling (racing the adapter's future against
/// the [CancelToken]). Enough to prove `ApiClient` maps a cancelled request to
/// `ApiException.isCancelled`, without a real server.
class _NeverRespondingAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) => Completer<ResponseBody>().future;

  @override
  void close({bool force = false}) {}
}

/// Captures the [RequestOptions] Dio actually sent and immediately resolves with an empty
/// JSON body — used to inspect headers `ApiClient`'s interceptors attach, without a real
/// network call.
class _CapturingAdapter implements HttpClientAdapter {
  RequestOptions? lastOptions;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    lastOptions = options;
    return ResponseBody.fromString(
      '{}',
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  // Both real platform-channel-backed dependencies `ApiClient` now touches by default need
  // Flutter's test binding initialized — `PackageInfo.fromPlatform()` (the default
  // `appVersion`, when a test doesn't override it) throws "Binding has not yet been
  // initialized" without this, exactly like `FlutterSecureStorage` below needs its own mock.
  TestWidgetsFlutterBinding.ensureInitialized();
  // `SecureTokenStore`'s real `FlutterSecureStorage` needs a mock platform to work at all in
  // a bare (non-widget) test — without this, `readAccessToken()` fails before the request
  // pipeline ever reaches the adapter (see the "omitting cancelToken" test's own comment
  // below for how that failure surfaces). A one-time, process-wide swap, the package's own
  // documented testing seam (`@visibleForTesting`).
  FlutterSecureStorage.setMockInitialValues(const {});
  // Same reasoning for `package_info_plus`'s own real platform channel, used whenever a test
  // doesn't override `appVersion` explicitly.
  PackageInfo.setMockInitialValues(
    appName: 'vinkin_mobile',
    packageName: 'org.vinkin.mobile',
    version: '0.0.0-test',
    buildNumber: '0',
    buildSignature: '',
  );

  test(
    'ENG3: every request carries the running app version in x-app-version',
    () async {
      final adapter = _CapturingAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'http://localhost'))
        ..httpClientAdapter = adapter;
      final client = ApiClient(
        tokenStore: SecureTokenStore(),
        dio: dio,
        appVersion: Future.value('1.4.2'),
      );

      await client.get('/api/v1/vinks');

      expect(adapter.lastOptions?.headers['x-app-version'], '1.4.2');
    },
  );

  test(
    'ENG3: a cancelled request maps to ApiException.isCancelled — never a raw DioException',
    () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://localhost'))
        ..httpClientAdapter = _NeverRespondingAdapter();
      final client = ApiClient(tokenStore: SecureTokenStore(), dio: dio);
      final cancelToken = CancelToken();

      final future = client.get('/api/v1/vinks', cancelToken: cancelToken);
      cancelToken.cancel();

      await expectLater(
        future,
        throwsA(
          isA<ApiException>()
              .having((error) => error.isCancelled, 'isCancelled', isTrue)
              .having((error) => error.isAuthError, 'isAuthError', isFalse),
        ),
      );
    },
  );

  test(
    'ENG3: cancellation is threaded through post/put/patch/delete/getList too',
    () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://localhost'))
        ..httpClientAdapter = _NeverRespondingAdapter();
      final client = ApiClient(tokenStore: SecureTokenStore(), dio: dio);

      Future<void> expectCancelled(
        Future<Object?> Function(CancelToken token) start,
      ) async {
        final token = CancelToken();
        final future = start(token);
        token.cancel();
        await expectLater(
          future,
          throwsA(
            isA<ApiException>().having(
              (e) => e.isCancelled,
              'isCancelled',
              isTrue,
            ),
          ),
        );
      }

      await expectCancelled(
        (token) => client.post('/api/v1/vinks', cancelToken: token),
      );
      await expectCancelled(
        (token) => client.put('/api/v1/vinks/x', cancelToken: token),
      );
      await expectCancelled(
        (token) => client.patch('/api/v1/vinks/x', cancelToken: token),
      );
      await expectCancelled(
        (token) => client.delete('/api/v1/vinks/x', cancelToken: token),
      );
      await expectCancelled(
        (token) =>
            client.getList('/api/v1/vinks/x/activity', cancelToken: token),
      );
    },
  );

  test(
    'ENG3: omitting cancelToken never spuriously classifies a failure as cancelled',
    () async {
      // Whatever this request actually fails with in a bare (non-widget) test environment —
      // `flutter_secure_storage`'s platform channel has no test binding here, so the token-read
      // interceptor itself is the realistic failure source, not the adapter this test doesn't
      // even reach — the one thing that must never be true is `isCancelled`, since nothing
      // cancelled anything.
      final dio = Dio(BaseOptions(baseUrl: 'http://localhost'))
        ..httpClientAdapter = _NeverRespondingAdapter();
      final client = ApiClient(tokenStore: SecureTokenStore(), dio: dio);

      try {
        await client
            .get('/api/v1/vinks')
            .timeout(const Duration(milliseconds: 200));
      } on ApiException catch (error) {
        expect(error.isCancelled, isFalse);
      } on TimeoutException {
        // Reached the never-responding adapter and is still genuinely pending — also fine,
        // also proves no spurious cancellation occurred.
      }
    },
  );
}
