import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../networking/api_config.dart';

/// One WebSocket connection per vink lobby screen (Plan §14 channel `vink:{vinkId}`,
/// PV8's `GET /api/v1/vinks/:vinkId/live`). The client's reconnection duty is small by
/// design: the server sends a fresh `snapshot` message on every connection, first or not
/// (apps/api/src/modules/realtime/routes.ts), so reconnecting and listening is sufficient —
/// there is no separate "catch up" logic to get wrong on the client either.
class RealtimeClient {
  RealtimeClient({required this.vinkId, required this.accessToken});

  final String vinkId;
  final String accessToken;

  WebSocketChannel? _channel;
  final _controller = StreamController<Map<String, dynamic>>.broadcast();
  Timer? _reconnectTimer;
  bool _disposed = false;

  Stream<Map<String, dynamic>> get messages => _controller.stream;

  void connect() {
    if (_disposed) return;
    final uri = Uri.parse('${ApiConfig.wsBaseUrl}/api/v1/vinks/$vinkId/live?token=$accessToken');
    // Bounded: without an explicit connectTimeout, WebSocketChannel.connect never times out
    // on its own — a stalled TCP handshake (unreachable host, dropped packets) falls through
    // to the OS's own connect timeout, which can take minutes. ENG1 #1 traced VinkIn's
    // reported indefinite "Connecting…" hang to exactly this.
    final channel = IOWebSocketChannel.connect(uri, connectTimeout: const Duration(seconds: 8));
    _channel = channel;
    channel.stream.listen(
      (raw) {
        final decoded = jsonDecode(raw as String) as Map<String, dynamic>;
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

  void _scheduleReconnect() {
    if (_disposed) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 2), connect);
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _controller.close();
  }
}
