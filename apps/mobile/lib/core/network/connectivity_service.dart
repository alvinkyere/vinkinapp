import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// ENG3 ("network reachability handling"): the audit found offline was only ever discovered
/// reactively, from a failed request's own error — no proactive "you're offline" signal
/// existed anywhere. `isOnline` is the one place that judgment is made, so every consumer
/// (this service, tests, `RealtimeClient`) reads the same rule: online means at least one
/// active connection that isn't [ConnectivityResult.none], never a specific transport type.
bool isOnline(List<ConnectivityResult> results) =>
    results.any((result) => result != ConnectivityResult.none);

/// Wraps `connectivity_plus`'s [Connectivity] behind two injectable functions rather than the
/// plugin class itself — a test supplies plain fakes (`() async => [...]`, a `StreamController`)
/// with no platform-channel/plugin-mocking involved, the same testability pattern
/// `RealtimeClient`'s `reconnectDelay(attempt, {Random? random})` already uses for its own
/// otherwise-hard-to-test real-world dependency.
class ConnectivityService {
  ConnectivityService({
    Future<List<ConnectivityResult>> Function()? checkConnectivity,
    Stream<List<ConnectivityResult>> Function()? connectivityChanges,
  }) : _check = checkConnectivity ?? Connectivity().checkConnectivity,
       _changes =
           connectivityChanges ?? (() => Connectivity().onConnectivityChanged);

  final Future<List<ConnectivityResult>> Function() _check;
  final Stream<List<ConnectivityResult>> Function() _changes;

  Future<bool> checkIsOnline() async => isOnline(await _check());

  /// Live changes only — `connectivity_plus`'s own stream never replays the current state to
  /// a new subscriber, which is exactly why [isOnlineProvider] below combines this with
  /// [checkIsOnline] for its own first value rather than trusting this stream alone.
  Stream<bool> get onlineChanges => _changes().map(isOnline);
}

final connectivityServiceProvider = Provider<ConnectivityService>(
  (ref) => ConnectivityService(),
);

/// The current online/offline signal, correct from its very first emitted value (an explicit
/// [ConnectivityService.checkIsOnline] call) and live thereafter (`onlineChanges`) — never a
/// window where a consumer reads a stale "loading" state because the underlying stream hadn't
/// emitted yet. Deliberately not wired into any screen's visual "you're offline" presentation
/// in this slice (ENG3 is scoped to not make visual/UX decisions) — this provider is the
/// capability a future UX-directed slice attaches specific screen behavior to.
final isOnlineProvider = StreamProvider<bool>((ref) async* {
  final service = ref.read(connectivityServiceProvider);
  yield await service.checkIsOnline();
  yield* service.onlineChanges;
});
