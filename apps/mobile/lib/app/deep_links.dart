/// ENG3 Slice 4 ("deterministic deep-link routing"): the pure decision this app makes for
/// every incoming `vinkin://` link — a top-level function (not a method) so it's unit-
/// testable without any `AppLinks`/platform-channel involvement, the same pattern this
/// codebase already uses for `reconnectDelay`/`shouldReconnectOnConnectivityChange`
/// (`core/realtime/realtime_client.dart`).
///
/// Only `vinkin://vinks/:vinkId` is handled, opening directly to that Vink's existing
/// `/vinks/:vinkId` route (`app/router.dart`) — no new screen, no new product behavior, just
/// an OS-level entry point into a route this app already has.
///
/// `vinkin://g/:token` is deliberately **not** handled here, and never will be by this
/// function: that path is `apps/guest-web`'s own route (Phase 4 §13's "Guest token-redeem
/// page"), never the organizer app's — guests don't use this app at all (Phase 0 §1). The
/// original ENG3 audit that flagged "no `/g/:token` route exists" was imprecise about the
/// target; this is the corrected, actually-meaningful scope, not a silent narrowing (see
/// `milestone-reports/ENG3-SLICE-4-DEEP-LINK-ROUTING.md`).
///
/// Any other scheme, host, or shape (missing/extra path segments, an empty id) returns
/// `null` and is silently ignored — an unrecognized link must never crash or navigate
/// somewhere wrong.
String? deepLinkRouteFor(Uri uri) {
  if (uri.scheme != 'vinkin') return null;
  if (uri.host != 'vinks') return null;
  if (uri.pathSegments.length != 1) return null;
  final vinkId = uri.pathSegments.first;
  if (vinkId.isEmpty) return null;
  return '/vinks/$vinkId';
}
