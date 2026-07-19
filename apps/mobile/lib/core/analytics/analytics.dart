import 'dart:convert';
import 'dart:developer' as developer;

/// Plan PV9 "Analytics" deliverable, scoped for the validation build: one structured event
/// sink (matches the backend's "structured logs only, never console.log" rule) with no real
/// vendor wired in — a real analytics SDK is out of scope until a provider is chosen, same
/// spirit as the payment provider boundary (D10).
abstract class Analytics {
  void track(String event, [Map<String, Object?> properties = const {}]);
}

class DebugAnalytics implements Analytics {
  @override
  void track(String event, [Map<String, Object?> properties = const {}]) {
    developer.log(jsonEncode({'event': event, ...properties}), name: 'vinkin.analytics');
  }
}
