import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/network/connectivity_service.dart';

void main() {
  group('ENG3: isOnline', () {
    test('an empty result list is offline', () {
      expect(isOnline(const []), isFalse);
    });

    test('[none] alone is offline', () {
      expect(isOnline(const [ConnectivityResult.none]), isFalse);
    });

    test('wifi is online', () {
      expect(isOnline(const [ConnectivityResult.wifi]), isTrue);
    });

    test('mobile is online', () {
      expect(isOnline(const [ConnectivityResult.mobile]), isTrue);
    });

    test(
      '[none, wifi] (a device reporting both) is online — any real connection counts',
      () {
        expect(
          isOnline(const [ConnectivityResult.none, ConnectivityResult.wifi]),
          isTrue,
        );
      },
    );
  });

  group('ENG3: ConnectivityService', () {
    test('checkIsOnline reflects the injected check function', () async {
      final service = ConnectivityService(
        checkConnectivity: () async => const [ConnectivityResult.wifi],
        connectivityChanges: () => const Stream.empty(),
      );
      expect(await service.checkIsOnline(), isTrue);
    });

    test('checkIsOnline reflects offline too', () async {
      final service = ConnectivityService(
        checkConnectivity: () async => const [ConnectivityResult.none],
        connectivityChanges: () => const Stream.empty(),
      );
      expect(await service.checkIsOnline(), isFalse);
    });

    test(
      'onlineChanges maps the raw connectivity stream through isOnline',
      () async {
        final service = ConnectivityService(
          checkConnectivity: () async => const [ConnectivityResult.wifi],
          connectivityChanges: () => Stream.fromIterable([
            const [ConnectivityResult.wifi],
            const [ConnectivityResult.none],
            const [ConnectivityResult.mobile],
          ]),
        );
        expect(await service.onlineChanges.toList(), [true, false, true]);
      },
    );
  });

  group('ENG3: isOnlineProvider', () {
    test("emits the initial check's value first, then live changes", () async {
      final container = ProviderContainer(
        overrides: [
          connectivityServiceProvider.overrideWithValue(
            ConnectivityService(
              checkConnectivity: () async => const [ConnectivityResult.none],
              connectivityChanges: () => Stream.fromIterable([
                const [ConnectivityResult.wifi],
              ]),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      final values = <bool>[];
      final sub = container.listen(isOnlineProvider, (previous, next) {
        next.whenData(values.add);
      });
      addTearDown(sub.close);

      // Prime the provider and let both the initial check and the one stream event land.
      await container.read(isOnlineProvider.future);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(values, [false, true]);
    });
  });
}
