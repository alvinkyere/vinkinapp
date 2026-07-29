import 'dart:math';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/realtime/realtime_client.dart';

/// A deterministic "random" that always returns the given value, so the ±20% jitter band's
/// exact edges are testable rather than only asserting a loose range.
class _FixedRandom implements Random {
  _FixedRandom(this.value);
  final double value;

  @override
  double nextDouble() => value;

  @override
  bool nextBool() => throw UnimplementedError();
  @override
  int nextInt(int max) => throw UnimplementedError();
}

void main() {
  group('ENG3: reconnectDelay — exponential backoff with jitter', () {
    test('attempt 0 is centered on the 1s base delay', () {
      final delay = reconnectDelay(0, random: _FixedRandom(0.5));
      // jitter factor at nextDouble()==0.5 is 0.8 + 0.5*0.4 == 1.0 exactly.
      expect(delay, const Duration(milliseconds: 1000));
    });

    test('delay grows monotonically with attempt, before hitting the cap', () {
      final d0 = reconnectDelay(0, random: _FixedRandom(0.5));
      final d1 = reconnectDelay(1, random: _FixedRandom(0.5));
      final d2 = reconnectDelay(2, random: _FixedRandom(0.5));
      expect(d1, greaterThan(d0));
      expect(d2, greaterThan(d1));
      expect(d1, const Duration(milliseconds: 2000));
      expect(d2, const Duration(milliseconds: 4000));
    });

    test(
      'delay never exceeds the 30s cap, however large the attempt number',
      () {
        final delay = reconnectDelay(20, random: _FixedRandom(0.5));
        expect(delay.inSeconds, lessThanOrEqualTo(30));
      },
    );

    test(
      'jitter stays within ±20% of the exponential value at both extremes',
      () {
        const attempt = 3; // exponential base: 8000ms
        final low = reconnectDelay(attempt, random: _FixedRandom(0.0));
        final high = reconnectDelay(attempt, random: _FixedRandom(1.0));
        expect(low, const Duration(milliseconds: 6400)); // 8000 * 0.8
        expect(high, const Duration(milliseconds: 9600)); // 8000 * 1.2
      },
    );

    test(
      'never produces a zero or negative delay even at attempt 0 with minimum jitter',
      () {
        final delay = reconnectDelay(0, random: _FixedRandom(0.0));
        expect(delay.inMilliseconds, greaterThan(0));
      },
    );
  });

  group('ENG3: shouldReconnectOnConnectivityChange', () {
    test('an offline→online transition reconnects', () {
      expect(
        shouldReconnectOnConnectivityChange(wasOnline: false, isOnline: true),
        isTrue,
      );
    });

    test(
      'an online→offline transition does not reconnect (nothing to reconnect to)',
      () {
        expect(
          shouldReconnectOnConnectivityChange(wasOnline: true, isOnline: false),
          isFalse,
        );
      },
    );

    test(
      'staying online (e.g. Wi-Fi→cellular, still connected) does not force a reconnect',
      () {
        expect(
          shouldReconnectOnConnectivityChange(wasOnline: true, isOnline: true),
          isFalse,
        );
      },
    );

    test('staying offline does not reconnect', () {
      expect(
        shouldReconnectOnConnectivityChange(wasOnline: false, isOnline: false),
        isFalse,
      );
    });

    test(
      'no prior reading yet (wasOnline == null) never counts as a transition',
      () {
        expect(
          shouldReconnectOnConnectivityChange(wasOnline: null, isOnline: true),
          isFalse,
        );
        expect(
          shouldReconnectOnConnectivityChange(wasOnline: null, isOnline: false),
          isFalse,
        );
      },
    );
  });

  group('ENG9 #6: AppLifecycleListener wiring (real backgrounding/resume, not just pure fns)', () {
    TestWidgetsFlutterBinding.ensureInitialized();

    // AppLifecycleListener enforces the REAL OS transition sequence via internal asserts
    // (flutter/lib/src/widgets/app_lifecycle_listener.dart): resumed -> inactive -> hidden ->
    // paused going to the background, and the reverse coming back. `onPause` specifically
    // only fires when the previous state was `hidden` (or null) — jumping straight from
    // `resumed` to `paused` is silently a no-op, not an error, which is what made the first
    // version of this test file fail confusingly. These helpers walk the full real sequence,
    // exactly like backgrounding/foregrounding a real device does.
    Future<void> goToBackground() async {
      for (final state in [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
      ]) {
        TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(state);
        await Future<void>.delayed(Duration.zero);
      }
    }

    Future<void> returnToForeground() async {
      for (final state in [
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(state);
        await Future<void>.delayed(Duration.zero);
      }
    }

    // The binding is a process-global singleton, not reset per-test. Every test both starts
    // and ends in `resumed` so each one gets a genuine, real transition boundary.
    setUp(returnToForeground);
    tearDown(returnToForeground);

    test('a real backgrounding sequence sets isPausedInBackground', () async {
      final client = RealtimeClient(
        vinkId: 'test-vink',
        accessToken: 'test-token',
        connectivityChanges: const Stream<bool>.empty(),
      );
      addTearDown(client.dispose);

      expect(client.isPausedInBackground, isFalse);
      await goToBackground();
      expect(client.isPausedInBackground, isTrue);
    });

    test(
      'a real return-to-foreground sequence (after backgrounding) clears isPausedInBackground',
      () async {
        final client = RealtimeClient(
          vinkId: 'test-vink',
          accessToken: 'test-token',
          connectivityChanges: const Stream<bool>.empty(),
        );
        addTearDown(client.dispose);

        await goToBackground();
        expect(client.isPausedInBackground, isTrue);

        await returnToForeground();
        expect(client.isPausedInBackground, isFalse);
      },
    );

    test(
      'connect() is a genuine no-op while backgrounded — no socket attempt, returns without hanging',
      () async {
        final client = RealtimeClient(
          vinkId: 'test-vink',
          accessToken: 'test-token',
          connectivityChanges: const Stream<bool>.empty(),
        );
        addTearDown(client.dispose);

        await goToBackground();
        expect(client.isPausedInBackground, isTrue);

        // connect() returns synchronously due to the _pausedInBackground guard — no real
        // WebSocket connection is ever attempted (which would otherwise hang for up to the
        // 8s connectTimeout against an unreachable/fake host).
        client.connect();
        var messageOrErrorFired = false;
        final sub = client.messages.listen(
          (_) => messageOrErrorFired = true,
          onError: (_) => messageOrErrorFired = true,
        );
        await Future<void>.delayed(const Duration(milliseconds: 100));
        await sub.cancel();
        expect(messageOrErrorFired, isFalse);
      },
    );
  });
}
