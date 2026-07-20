/// Local-dev backend location. The iOS Simulator shares the host Mac's network stack, so
/// `localhost` reaches the API server running on the same machine directly (no special
/// loopback alias the way the Android emulator needs `10.0.2.2`) — Android is out of PV9's
/// scope (iOS first, Plan §4).
class ApiConfig {
  const ApiConfig._();

  static const String baseUrl = String.fromEnvironment(
    'VINKIN_API_BASE_URL',
    defaultValue: 'http://127.0.0.1:3000',
  );

  static String get wsBaseUrl => baseUrl.replaceFirst('http', 'ws');

  /// apps/guest-web's own address — mirrors the API's `VINKIN_PUBLIC_BASE_URL` default
  /// (apps/api/src/config/env.ts) so a locally-run stack's share links resolve without
  /// extra config. Used to build the general `/join/:publicCode` link (live lobby sharing);
  /// the per-guest `/g/:token` link is returned ready-made by the invite-guest endpoint.
  static const String guestWebBaseUrl = String.fromEnvironment(
    'VINKIN_GUEST_WEB_BASE_URL',
    defaultValue: 'http://127.0.0.1:3100',
  );
}
