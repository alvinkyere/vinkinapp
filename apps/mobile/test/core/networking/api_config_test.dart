import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/networking/api_config.dart';

void main() {
  test('API and Guest Web URLs are absolute HTTP(S) origins', () {
    final api = Uri.parse(ApiConfig.baseUrl);
    final guest = Uri.parse(ApiConfig.guestWebBaseUrl);

    expect(api.hasScheme, isTrue);
    expect(api.host, isNotEmpty);
    expect(api.path, isEmpty);
    expect(api.scheme, anyOf('http', 'https'));

    expect(guest.hasScheme, isTrue);
    expect(guest.host, isNotEmpty);
    expect(guest.path, isEmpty);
    expect(guest.scheme, anyOf('http', 'https'));
  });

  test('WebSocket URL follows the configured API origin', () {
    final api = Uri.parse(ApiConfig.baseUrl);
    final websocket = Uri.parse(ApiConfig.wsBaseUrl);

    expect(websocket.host, api.host);
    expect(websocket.hasPort, api.hasPort);
    if (api.hasPort) expect(websocket.port, api.port);
    expect(websocket.scheme, api.scheme == 'https' ? 'wss' : 'ws');
  });
}
