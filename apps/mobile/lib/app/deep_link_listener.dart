import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:go_router/go_router.dart';
import 'deep_links.dart';

/// ENG3 Slice 4: subscribes to every `vinkin://` link the OS delivers — both a cold-start
/// link (the app wasn't running yet) and a live one (the app was already open) — and
/// navigates the given [GoRouter] there via [deepLinkRouteFor]'s decision.
///
/// `getInitialLink`/`uriLinkStream` are injected as plain functions rather than an `AppLinks`
/// instance (mirrors `ConnectivityService`'s `checkConnectivity`/`connectivityChanges`
/// pattern, `core/network/connectivity_service.dart`) — a test supplies bare fakes with no
/// platform-channel/plugin mocking involved at all.
class DeepLinkListener {
  DeepLinkListener(
    this._router, {
    Future<Uri?> Function()? getInitialLink,
    Stream<Uri> Function()? uriLinkStream,
  }) : _getInitialLink = getInitialLink ?? AppLinks().getInitialLink,
       _uriLinkStream = uriLinkStream ?? (() => AppLinks().uriLinkStream) {
    unawaited(_handleInitialLink());
    _subscription = _uriLinkStream().listen(_handleLink);
  }

  final GoRouter _router;
  final Future<Uri?> Function() _getInitialLink;
  final Stream<Uri> Function() _uriLinkStream;
  late final StreamSubscription<Uri> _subscription;

  Future<void> _handleInitialLink() async {
    final uri = await _getInitialLink();
    if (uri != null) _handleLink(uri);
  }

  void _handleLink(Uri uri) {
    final route = deepLinkRouteFor(uri);
    if (route != null) _router.go(route);
  }

  void dispose() {
    unawaited(_subscription.cancel());
  }
}
