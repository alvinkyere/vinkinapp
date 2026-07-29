import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/widgets.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../network/connectivity_service.dart';
import '../networking/api_config.dart';

const _reconnectBaseDelay = Duration(seconds: 1);
const _reconnectMaxDelay = Duration(seconds: 30);

/// ENG3: a flat retry delay produces a reconnect storm if the server (or a shared proxy) is
/// struggling — exponential backoff with jitter spreads reconnect attempts out instead of
/// every client retrying in lockstep. A pure, top-level function (not a method) so it's
/// unit-testable without any socket/timer involved — see `realtime_client_test.dart`.
Duration reconnectDelay(int attempt, {Random? random}) {
  final rand = random ?? Random();
  final exponentialMs =
      _reconnectBaseDelay.inMilliseconds * pow(2, attempt).clamp(1, 1 << 30);
  final cappedMs = min(
    exponentialMs.toDouble(),
    _reconnectMaxDelay.inMilliseconds.toDouble(),
  );
  final jitteredMs = cappedMs * (0.8 + rand.nextDouble() * 0.4); // ±20%
  return Duration(milliseconds: jitteredMs.round());
}

/// ENG3 ("network reachability handling"): a network change (Wi-Fi ↔ cellular, or genuinely
/// offline ↔ online) frequently kills the socket without ever firing a clean `close` event,
/// exactly like backgrounding does — waiting out the normal backoff once connectivity returns
/// would leave the lobby looking stale for up to the reconnect cap. Only the offline→online
/// *transition* should trigger an immediate reconnect; every other change (e.g. still-online
/// Wi-Fi→cellular, or [wasOnline] being `null` — no prior reading yet, so no transition has
/// actually happened) is left to the existing heartbeat/onDone path, since the socket may
/// still be perfectly healthy across it. A pure, top-level function for the same reason
/// [reconnectDelay] above is one — unit-testable without any socket/stream involved.
bool shouldReconnectOnConnectivityChange({
  required bool? wasOnline,
  required bool isOnline,
}) => isOnline && wasOnline == false;

/// One WebSocket connection per vink lobby screen (Plan §14 channel `vink:{vinkId}`,
/// PV8's `GET /api/v1/vinks/:vinkId/live`). The client's reconnection duty is small by
/// design: the server sends a fresh `snapshot` message on every connection, first or not
/// (apps/api/src/modules/realtime/routes.ts), so reconnecting and listening is sufficient —
/// there is no separate "catch up" logic to get wrong on the client either.
///
/// ENG3: reconnect uses exponential backoff+jitter (not a flat delay, see [reconnectDelay]),
/// an application-level ping/pong heartbeat detects a connection that looks open but has gone
/// silently dead (browsers/Dart's `IOWebSocketChannel` don't expose the WebSocket protocol's
/// own ping/pong control frames to application code), and an [AppLifecycleListener] stops
/// retrying while the app is backgrounded (no point spending battery/network reconnecting a
/// screen nobody can see) and reconnects immediately on resume — a backgrounded socket is
/// frequently killed by the OS without a clean `close` event ever firing, so waiting out a
/// normal backoff on return would leave a resumed screen looking stale for several seconds.
/// The same "reconnect immediately, don't wait out the backoff" treatment applies to a
/// device coming back online (Wi-Fi ↔ cellular, or genuinely offline ↔ online) — see
/// [connectivityChanges]/[_onConnectivityChanged].
class RealtimeClient {
  RealtimeClient({
    required this.vinkId,
    required this.accessToken,
    this.heartbeatInterval = const Duration(seconds: 20),
    this.heartbeatTimeout = const Duration(seconds: 10),
    Stream<bool>? connectivityChanges,
  }) {
    _lifecycleListener = AppLifecycleListener(
      onPause: _pauseForBackground,
      onResume: _resumeFromBackground,
    );
    _connectivitySubscription =
        (connectivityChanges ?? ConnectivityService().onlineChanges).listen(
          _onConnectivityChanged,
        );
  }

  final String vinkId;
  final String accessToken;
  final Duration heartbeatInterval;
  final Duration heartbeatTimeout;

  WebSocketChannel? _channel;
  final _controller = StreamController<Map<String, dynamic>>.broadcast();
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  Timer? _heartbeatTimeoutTimer;
  int _attempt = 0;
  bool _disposed = false;
  bool _pausedInBackground = false;
  late final AppLifecycleListener _lifecycleListener;
  late final StreamSubscription<bool> _connectivitySubscription;
  bool? _lastKnownOnline;

  /// ENG9 #6: the only way to observe the real [AppLifecycleListener] wiring (onPause/
  /// onResume) from a test without a full widget tree — `connect()`'s own guard already
  /// reads this field, so a test can simulate a real lifecycle transition via
  /// `TestWidgetsFlutterBinding.instance.handleAppLifecycleStateChanged(...)` and assert on
  /// this getter, proving the listener is genuinely wired, not just that the pure
  /// backoff/connectivity functions elsewhere in this file are correct.
  @visibleForTesting
  bool get isPausedInBackground => _pausedInBackground;

  Stream<Map<String, dynamic>> get messages => _controller.stream;

  void _onConnectivityChanged(bool online) {
    final shouldReconnect = shouldReconnectOnConnectivityChange(
      wasOnline: _lastKnownOnline,
      isOnline: online,
    );
    _lastKnownOnline = online;
    if (shouldReconnect && !_pausedInBackground && !_disposed) {
      _attempt = 0;
      _reconnectTimer?.cancel();
      connect();
    }
  }

  void connect() {
    if (_disposed || _pausedInBackground) return;
    final uri = Uri.parse(
      '${ApiConfig.wsBaseUrl}/api/v1/vinks/$vinkId/live?token=$accessToken',
    );
    // Bounded: without an explicit connectTimeout, WebSocketChannel.connect never times out
    // on its own — a stalled TCP handshake (unreachable host, dropped packets) falls through
    // to the OS's own connect timeout, which can take minutes. ENG1 #1 traced VinkIn's
    // reported indefinite "Connecting…" hang to exactly this.
    final channel = IOWebSocketChannel.connect(
      uri,
      connectTimeout: const Duration(seconds: 8),
    );
    _channel = channel;
    channel.ready
        .then((_) {
          if (_disposed) return;
          _attempt = 0; // a successful connection resets the backoff
          _startHeartbeat();
        })
        .catchError((_) {
          // connect() itself already handles the failure via the stream's onError below;
          // this only prevents an unhandled-future-rejection warning for `ready`.
        });
    channel.stream.listen(
      (raw) {
        final decoded = jsonDecode(raw as String) as Map<String, dynamic>;
        if (decoded['type'] == 'pong') {
          _heartbeatTimeoutTimer?.cancel();
          _heartbeatTimeoutTimer = null;
          return;
        }
        if (!_controller.isClosed) _controller.add(decoded);
      },
      onDone: _scheduleReconnect,
      onError: (error) {
        // Surface the failure to listeners (e.g. so the lobby screen can show a retry
        // affordance instead of silently retrying forever behind a "Connecting…" label)
        // before scheduling the next attempt.
        if (!_controller.isClosed) _controller.addError(error);
        _scheduleReconnect();
      },
      cancelOnError: true,
    );
  }

  void _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatTimer = Timer.periodic(heartbeatInterval, (_) {
      final channel = _channel;
      if (channel == null) return;
      channel.sink.add(jsonEncode({'type': 'ping'}));
      _heartbeatTimeoutTimer?.cancel();
      _heartbeatTimeoutTimer = Timer(heartbeatTimeout, () {
        // No pong within the timeout — the connection looks open but is not answering.
        // Force-close so `onDone` reconnects through the normal backoff path, rather than
        // silently sitting on a dead socket.
        channel.sink.close();
      });
    });
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _heartbeatTimeoutTimer?.cancel();
    _heartbeatTimeoutTimer = null;
  }

  void _scheduleReconnect() {
    _stopHeartbeat();
    if (_disposed || _pausedInBackground) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(reconnectDelay(_attempt), connect);
    _attempt += 1;
  }

  void _pauseForBackground() {
    _pausedInBackground = true;
    _reconnectTimer?.cancel();
    _stopHeartbeat();
    _channel?.sink.close();
  }

  void _resumeFromBackground() {
    _pausedInBackground = false;
    _attempt =
        0; // a resume is a fresh start, not a retry of whatever failed before
    connect();
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _stopHeartbeat();
    _lifecycleListener.dispose();
    unawaited(_connectivitySubscription.cancel());
    _channel?.sink.close();
    _controller.close();
  }
}
