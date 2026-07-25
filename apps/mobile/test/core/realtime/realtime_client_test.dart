import 'dart:math';
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
}
