import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:math';

import 'package:dio/dio.dart';
import '../networking/api_config.dart';

/// Plan PV9 "Analytics" deliverable, scoped for the validation build: one structured event
/// sink (matches the backend's "structured logs only, never console.log" rule) with no real
/// vendor wired in — a real analytics SDK is out of scope until a provider is chosen, same
/// spirit as the payment provider boundary (D10). PV12 prep: `track` now also reports to
/// the backend's funnel-event endpoint (apps/api/src/modules/analytics), the same one
/// apps/guest-web's `lib/analytics.ts` posts to — one funnel, two clients.
abstract class Analytics {
  void track(
    String event, [
    Map<String, Object?> properties = const {},
    String? vinkId,
  ]);
}

class DebugAnalytics implements Analytics {
  @override
  void track(
    String event, [
    Map<String, Object?> properties = const {},
    String? vinkId,
  ]) {
    developer.log(
      jsonEncode({'event': event, 'vinkId': vinkId, ...properties}),
      name: 'vinkin.analytics',
    );
  }
}

String _randomClientId() {
  final random = Random.secure();
  return List.generate(
    16,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
}

/// Posts every event to the backend, fire-and-forget — a network failure here must never
/// surface to the user or block the flow that triggered it. Also logs locally (via
/// [DebugAnalytics]'s formatting) so `flutter run`'s console still shows events during
/// development without needing the backend up.
class HttpAnalytics implements Analytics {
  HttpAnalytics({Dio? dio})
    : _dio = dio ?? Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

  final Dio _dio;
  final String _clientId = _randomClientId();
  final _debug = DebugAnalytics();

  @override
  void track(
    String event, [
    Map<String, Object?> properties = const {},
    String? vinkId,
  ]) {
    _debug.track(event, properties, vinkId);
    unawaited(_post(event, properties, vinkId));
  }

  Future<void> _post(
    String event,
    Map<String, Object?> properties,
    String? vinkId,
  ) async {
    try {
      await _dio.post(
        '/api/v1/analytics/events',
        data: {
          'clientId': _clientId,
          'app': 'organizer_mobile',
          'events': [
            {
              'eventName': event,
              'vinkId': ?vinkId,
              'properties': properties,
              'occurredAt': DateTime.now().toUtc().toIso8601String(),
            },
          ],
        },
      );
    } catch (_) {
      // Best-effort only — see class doc above.
    }
  }
}
