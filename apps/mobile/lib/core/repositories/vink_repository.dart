import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth/auth_controller.dart';
import '../models/activity_entry.dart';
import '../models/vink.dart';
import '../networking/api_client.dart';

/// ENG3 ("typed repository layer"): the one place `Home`/`Activity`/the Lobby screen reach
/// the Vink domain's read/mutation endpoints — typed methods returning the app's own model
/// classes, instead of each screen calling `ApiClient.get/post` directly and hand-parsing the
/// raw JSON inline (which is what every one of those call sites did before this). `ApiClient`
/// itself stays the one place HTTP/auth/retry concerns live; this layer adds no networking
/// logic of its own, only typed shape.
///
/// Scoped to exactly the endpoints Home, Activity, and the Lobby screen actually call today —
/// not a speculative full REST client. The Create Vink screens (legacy and canonical) have
/// their own, larger set of vink-domain calls (participants, split, open) that this repository
/// does not yet cover; migrating those screens is a separate, not-yet-started slice (see
/// `milestone-reports/ENG3-SLICE-2-TYPED-REPOSITORY.md`), and adding untested methods here for
/// endpoints nothing calls yet would be exactly the kind of speculative surface this codebase's
/// own conventions avoid.
class VinkRepository {
  VinkRepository(this._client);

  final ApiClient _client;

  /// `GET /api/v1/vinks` — Home's own list, organizer-owned or organizer∪participant
  /// depending on the server-side `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL` flag (Slice I2B);
  /// entirely server-driven, no client-side branching on the flag.
  Future<List<Vink>> listMyVinks({CancelToken? cancelToken}) async {
    final response = await _client.get('/api/v1/vinks', cancelToken: cancelToken);
    return (response['vinks'] as List<dynamic>)
        .map((entry) => Vink.fromJson(entry as Map<String, dynamic>))
        .toList();
  }

  /// `GET /api/v1/vinks/:vinkId` — the organizer-only full snapshot (participants, card,
  /// allowed actions, per-participant contribution status). 403s for a non-organizer.
  ///
  /// [cancelToken], if provided (ENG3 "request cancellation"), lets a caller abort this
  /// specific fetch — e.g. the Lobby screen cancels every in-flight read on `dispose()`
  /// rather than letting a superseded request finish uselessly against a gone screen.
  Future<VinkSnapshot> getSnapshot(String vinkId, {CancelToken? cancelToken}) async {
    final response = await _client.get('/api/v1/vinks/$vinkId', cancelToken: cancelToken);
    return VinkSnapshot.fromJson(response);
  }

  /// `GET /api/v1/vinks/:vinkId/participant-view` — the customer-safe counterpart for a
  /// signed-in member who isn't the organizer (Slice I2B); never another participant's
  /// identity or status.
  Future<ParticipantVinkView> getParticipantView(String vinkId, {CancelToken? cancelToken}) async {
    final response = await _client.get(
      '/api/v1/vinks/$vinkId/participant-view',
      cancelToken: cancelToken,
    );
    return ParticipantVinkView.fromJson(response);
  }

  /// `GET /api/v1/vinks/:vinkId/activity` — this Vink's own transition/event history.
  Future<List<ActivityEntry>> getActivity(String vinkId, {CancelToken? cancelToken}) async {
    final list = await _client.getList('/api/v1/vinks/$vinkId/activity', cancelToken: cancelToken);
    return list.map((raw) => ActivityEntry.fromJson(raw as Map<String, dynamic>)).toList();
  }

  /// `POST /api/v1/vinks/:vinkId/cancel` — organizer-only, `OPEN` only. Idempotent: cancelling
  /// an already-cancelled Vink is a no-op success server-side (ENG1 #4), so this never needs
  /// its own idempotency handling on the client. Deliberately no [CancelToken] parameter — a
  /// mutating financial command should complete server-side once sent, regardless of whether
  /// the screen that triggered it is still around to see the result (cancellation is for
  /// reads that become moot when superseded or the screen disposes, not for commands).
  Future<void> cancelVink(String vinkId) => _client.post('/api/v1/vinks/$vinkId/cancel');

  /// `POST /api/v1/vinks/:vinkId/contributions/authorize` — the exact same contribution
  /// engine every participant uses, organizer included (Phase 0 §3's no-role-shortcut rule);
  /// resolved server-side by the caller's own identity, never a parameter here. No
  /// [CancelToken] parameter, for the same reason as [cancelVink] above.
  Future<void> authorizeContribution(String vinkId) =>
      _client.post('/api/v1/vinks/$vinkId/contributions/authorize');
}

final vinkRepositoryProvider = Provider<VinkRepository>(
  (ref) => VinkRepository(ref.read(apiClientProvider)),
);
