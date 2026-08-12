import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/commands/command_state.dart';
import '../../core/config/feature_flags.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/failure_classifier.dart';
import '../../core/models/vink.dart';
import '../../core/networking/api_config.dart';
import '../../core/realtime/realtime_client.dart';
import '../../core/repositories/vink_repository.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/vink_bottom_sheet.dart';
import '../../design_system/components/vink_deadline_countdown.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_participant_row.dart';
import '../../design_system/components/vink_payment_panel.dart';
import '../../design_system/components/vink_progress_indicator.dart';
import '../../design_system/components/vink_progress_vessel.dart';
import '../../design_system/components/vink_simulation_notice.dart';
import '../../design_system/components/vink_status_badge.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../create_vink/purchase_category.dart';
import '../home/home_providers.dart';
import 'participant_payment_state.dart';

const _simulationVisibleStates = {
  'FUNDED',
  'CARD_PROVISIONING',
  'CARD_READY',
  'PURCHASE_AUTHORIZED',
  'SETTLING',
  'COMPLETED',
};

/// The live Vink lobby — the design correction brief calls this "the strongest visual
/// expression of VinkIn's product identity." Preserves the PV8/PV8.5 realtime architecture
/// exactly: the server pushes a `snapshot` on connect and a lean payload per domain event
/// after, and this screen refetches the authoritative snapshot on every event rather than
/// rebuilding financial state from the lean payload itself.
class VinkLobbyScreen extends ConsumerStatefulWidget {
  const VinkLobbyScreen({
    super.key,
    required this.vinkId,
    this.role,
    this.inkProgressVessel = FeatureFlags.inkProgressVessel,
  });

  final String vinkId;

  /// Slice I2B: set only by Home's participant-role card tap (`?role=participant`) — every
  /// other caller (deep links, the post-create-vink redirect, existing organizer navigation)
  /// omits it, which this screen treats identically to `'organizer'` (today's only behavior).
  final String? role;

  /// I7 — gates the Ink Progress vessel replacing the linear `VinkProgressIndicator` on this
  /// screen. Defaults to the real, `--dart-define`-driven flag; overridable for tests, same
  /// convention as every other flagged screen in this app.
  final bool inkProgressVessel;

  bool get isParticipantView => role == 'participant';

  @override
  ConsumerState<VinkLobbyScreen> createState() => _VinkLobbyScreenState();
}

class _VinkLobbyScreenState extends ConsumerState<VinkLobbyScreen> {
  RealtimeClient? _realtime;
  VinkSnapshot? _snapshot;
  Object? _error;

  // ENG3 ("command state separate from view state"): each mutating action's own in-flight/
  // result state, replacing what used to be three separate ad hoc `bool _busy` + `String?
  // _error` pairs on this screen alone. `_setState` is shared by all three — a single
  // `(fn) { if (mounted) setState(fn); }` closure standing in for the `if (mounted)` guard
  // every one of the original handlers repeated individually.
  void _guardedSetState(void Function() fn) {
    if (mounted) setState(fn);
  }

  late final _cancelCommand = CommandRunner<void>(_guardedSetState, ref);
  late final _contributionCommand = CommandRunner<void>(_guardedSetState, ref);
  late final _participantContributionCommand = CommandRunner<void>(
    _guardedSetState,
    ref,
  );

  String? get _cancelError => switch (_cancelCommand.state) {
    CommandFailure(:final failure) => failure.message,
    _ => null,
  };
  bool get _contributing => _contributionCommand.state.isInProgress;
  String? get _contributionError => switch (_contributionCommand.state) {
    CommandFailure(:final failure) => failure.message,
    _ => null,
  };
  bool get _participantContributing =>
      _participantContributionCommand.state.isInProgress;
  String? get _participantContributionError =>
      switch (_participantContributionCommand.state) {
        CommandFailure(:final failure) => failure.message,
        _ => null,
      };

  // Slice I2B introduced this participant-view-only state as HTTP-only, flagging the missing
  // realtime channel as a known gap. Slice I2C closes it: the `/live` WS route now falls back
  // to the same customer-safe `ParticipantVinkView` read for a non-organizer JWT (flag-gated
  // on `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`, same as the REST route), so this state is now
  // kept current by both the initial HTTP fetch below AND the realtime channel — see
  // `_connect`/`_onMessage`.
  ParticipantVinkView? _participantView;
  Object? _participantError;

  // Multiple WS events can arrive in quick succession (e.g. the organizer, a member, and a
  // guest all contributing within milliseconds of each other), each firing its own
  // `_refreshSnapshot()`. Overlapping REST fetches can complete out of order, so a guard is
  // needed — otherwise a slower, older response can overwrite a faster, newer one and leave
  // the lobby stuck showing stale funded/participant data. Only the result of the most
  // recently *issued* fetch is ever applied.
  int _snapshotRequestId = 0;

  // ENG3 ("request cancellation"): every read this screen issues shares one token, cancelled
  // on dispose — a request that's still in flight when the organizer navigates away is
  // aborted outright rather than left to finish uselessly against a screen nobody can see.
  // `_snapshotRequestId` above already prevents an in-flight-but-superseded fetch from
  // corrupting state (defense that stays regardless), but doesn't stop the request itself
  // from completing on the wire — cancellation does.
  final _readCancelToken = CancelToken();

  @override
  void initState() {
    super.initState();
    // Slice I2C: both roles now open the realtime channel — `_connect()` accepts any signed-in
    // JWT (organizer or participant) with no role-specific logic of its own; the server decides
    // what snapshot shape to send back. The realtime channel remains an enhancement, not the
    // source of truth for first paint (ENG1 §3), for participant same as organizer: fetch the
    // authoritative snapshot over plain, boundedly-timed-out HTTP immediately too, rather than
    // leaving the screen on "Loading…" until a WebSocket `snapshot` frame happens to arrive.
    // Whichever of the two resolves first shows the lobby; the other keeps it current.
    _connect();
    if (widget.isParticipantView) {
      unawaited(_loadParticipantView());
    } else {
      unawaited(_loadInitialSnapshot());
    }
  }

  Future<void> _loadParticipantView() async {
    try {
      final view = await ref
          .read(vinkRepositoryProvider)
          .getParticipantView(widget.vinkId, cancelToken: _readCancelToken);
      if (!mounted) return;
      setState(() {
        _participantView = view;
        _participantError = null;
      });
    } on ApiException catch (error) {
      if (!mounted || error.isCancelled) return;
      setState(() => _participantError = error);
    }
  }

  /// The exact same contribution engine every other participant uses
  /// (`POST .../contributions/authorize`, resolved by the caller's own user id) — no new
  /// financial logic, mirrors `_payMyShare` above.
  Future<void> _payMyShareAsParticipant() async {
    await _participantContributionCommand.run(
      () =>
          ref.read(vinkRepositoryProvider).authorizeContribution(widget.vinkId),
      onSuccess: (_) => _loadParticipantView(),
    );
  }

  void _connect() {
    final authState = ref.read(authControllerProvider);
    if (authState is! AuthSignedIn) return;
    final client = RealtimeClient(
      vinkId: widget.vinkId,
      accessToken: authState.accessToken,
    );
    client.messages.listen(
      _onMessage,
      onError: (error) {
        // Only surface a realtime connection failure as a blocking error if the initial HTTP
        // load hasn't already produced a snapshot — once the lobby has data, a flaky socket is
        // just something `_scheduleReconnect` quietly retries in the background.
        if (_snapshot == null) setState(() => _error = error);
      },
    );
    client.connect();
    _realtime = client;
  }

  Future<void> _loadInitialSnapshot() async {
    final requestId = ++_snapshotRequestId;
    try {
      final snapshot = await ref
          .read(vinkRepositoryProvider)
          .getSnapshot(widget.vinkId, cancelToken: _readCancelToken);
      if (!mounted || requestId != _snapshotRequestId) return;
      // ENG1 #5 setup recovery: this screen is for OPEN-and-beyond live state, not setup —
      // a DRAFT vink (however this screen was reached: a stale link, a deep link, a card
      // that hasn't refreshed) belongs in the create flow's resume path instead. Decided
      // from the server's own current state, never from which button was tapped to get here.
      if (snapshot.vink.state == 'DRAFT') {
        context.pushReplacement('/create-vink/resume/${widget.vinkId}');
        return;
      }
      setState(() {
        _snapshot = snapshot;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted ||
          requestId != _snapshotRequestId ||
          _snapshot != null ||
          error.isCancelled) {
        return;
      }
      setState(() => _error = error);
    }
  }

  void _onMessage(Map<String, dynamic> message) {
    if (!mounted) return;
    // Slice I2C: a participant's own connection gets `ParticipantVinkView`-shaped snapshots,
    // never `VinkSnapshot` — the screen already knows this statically from `widget.role`, the
    // same way guest-web already knows its own connection is guest-scoped. Lean per-event
    // patches aren't hand-applied here the way the organizer path does below:
    // `ParticipantVinkSummary`'s `confirmedAmountMinor`/`confirmedParticipantCount` (from
    // `contributionProgress`) don't map 1:1 onto the lean payload's `fundedAmountMinor`, so a
    // full HTTP refetch is the correct, simplest fit — same "refetch on event" fallback this
    // screen already relies on for the organizer path's own card/participants/allowedActions.
    if (widget.isParticipantView) {
      if (message['type'] == 'snapshot') {
        setState(() {
          _participantView = ParticipantVinkView.fromJson(
            message['snapshot'] as Map<String, dynamic>,
          );
          _participantError = null;
        });
      } else {
        unawaited(_loadParticipantView());
      }
      return;
    }
    if (message['type'] == 'snapshot') {
      setState(() {
        _snapshot = VinkSnapshot.fromJson(
          message['snapshot'] as Map<String, dynamic>,
        );
        _error = null;
      });
      return;
    }
    // Every other message carries only the vink's current state/funded directly (a lean
    // payload by design — apps/api/src/realtime/outbox-publisher.ts) — patch those two
    // fields immediately for a snappy header update, then re-fetch the full snapshot so
    // participants/card/allowedActions/contributions catch up too.
    final current = _snapshot;
    if (current == null) return;
    final state = message['state'] as String?;
    final fundedAmountMinor = message['fundedAmountMinor'] as num?;
    if (state == null) return;
    setState(() {
      _snapshot = VinkSnapshot(
        vink: Vink(
          id: current.vink.id,
          publicCode: current.vink.publicCode,
          purchaseCategory: current.vink.purchaseCategory,
          state: state,
          requiredAmountMinor: current.vink.requiredAmountMinor,
          fundedAmountMinor:
              (fundedAmountMinor ?? current.vink.fundedAmountMinor).toInt(),
          version: current.vink.version,
          organizerUserId: current.vink.organizerUserId,
          submissionDeadline: current.vink.submissionDeadline,
        ),
        participants: current.participants,
        unallocatedAmountMinor: current.unallocatedAmountMinor,
        allowedActions: current.allowedActions,
        card: current.card,
        contributionStatusByParticipant:
            current.contributionStatusByParticipant,
        // Carried forward unchanged from the lean patch — the authoritative refetch just
        // below corrects it moments later, same as every other field this patch doesn't
        // itself carry a fresher value for.
        contributionProgress: current.contributionProgress,
      );
    });
    unawaited(_refreshSnapshot());
  }

  Future<void> _refreshSnapshot() async {
    final requestId = ++_snapshotRequestId;
    try {
      final snapshot = await ref
          .read(vinkRepositoryProvider)
          .getSnapshot(widget.vinkId, cancelToken: _readCancelToken);
      if (!mounted || requestId != _snapshotRequestId) return;
      setState(() => _snapshot = snapshot);
    } on ApiException {
      // The next WS message (or manual retry) will trigger another attempt; the lobby
      // already reflects the lightweight state/funded patch applied above.
    }
  }

  Future<void> _cancelVink() async {
    // ENG1 #4: cancel is a one-way transition (packages/domain/src/vink-state-machine.ts) —
    // a double tap hits ILLEGAL_TRANSITION, classified as conflict. Either way the
    // authoritative state is what matters now, so refresh and show it rather than a raw
    // error for something that may well have already succeeded (`onFailure` returning
    // `true` for a conflict suppresses it from ever reaching `_cancelError`).
    await _cancelCommand.run(
      () => ref.read(vinkRepositoryProvider).cancelVink(widget.vinkId),
      onSuccess: (_) async => ref.invalidate(myVinksProvider),
      onFailure: (failure) async {
        await _refreshSnapshot();
        return failure.category == FailureCategory.conflict;
      },
    );
  }

  /// The organizer's own "Pay my $X" — the exact same contribution engine every other
  /// participant uses (`POST .../contributions/authorize`, resolved by the caller's own
  /// user id), never a shortcut and never a hidden default.
  Future<void> _payMyShare() async {
    await _contributionCommand.run(
      () =>
          ref.read(vinkRepositoryProvider).authorizeContribution(widget.vinkId),
      onSuccess: (_) => _refreshSnapshot(),
    );
  }

  @override
  void dispose() {
    _readCancelToken.cancel();
    _realtime?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isParticipantView) return _buildParticipantScaffold(context);
    final snapshot = _snapshot;
    final canCancel = snapshot?.allowedActions.contains('CANCEL_VINK') ?? false;
    return Scaffold(
      backgroundColor: VinkColors.paper,
      appBar: AppBar(
        backgroundColor: VinkColors.paper,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: VinkColors.ink),
          onPressed: () => context.go('/home'),
        ),
        // Concept-image "..." overflow menu — Cancel Vink moves here from an always-visible
        // destructive button at the bottom of the screen, matching the concept's own minimal
        // top-level chrome. Same command, same confirmation-free single tap as before.
        actions: [
          if (canCancel)
            PopupMenuButton<void>(
              icon: const Icon(Icons.more_horiz_rounded, color: VinkColors.ink),
              itemBuilder: (context) => [
                PopupMenuItem<void>(
                  onTap: _cancelVink,
                  child: const Text(
                    'Cancel Vink',
                    style: TextStyle(color: VinkColors.danger),
                  ),
                ),
              ],
            ),
        ],
      ),
      body: SafeArea(
        child: snapshot == null && _error == null
            ? const VinkLoadingState(message: 'Connecting…')
            : (_error != null && snapshot == null)
            ? Padding(
                padding: const EdgeInsets.all(VinkSpacing.lg),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    VinkInlineError(
                      message:
                          "Couldn't connect. Check your connection and try again.",
                    ),
                    const SizedBox(height: VinkSpacing.md),
                    VinkSecondaryButton(
                      label: 'Retry',
                      onPressed: () {
                        setState(() => _error = null);
                        _realtime?.connect();
                        unawaited(_loadInitialSnapshot());
                      },
                    ),
                  ],
                ),
              )
            : _LobbyBody(
                vinkId: widget.vinkId,
                snapshot: snapshot!,
                cancelError: _cancelError,
                contributing: _contributing,
                contributionError: _contributionError,
                onPayShare: _payMyShare,
                onProcessing: () => unawaited(_loadInitialSnapshot()),
                inkProgressVessel: widget.inkProgressVessel,
              ),
      ),
    );
  }

  /// Slice I2B — the participant-role counterpart of the organizer body above. Same
  /// Scaffold/AppBar chrome and the same design-system components, deliberately a smaller
  /// composition: no participant roster (privacy — a fellow participant never sees another's
  /// identity or amount, matching `ParticipantVinkView`'s own server-side boundary), no
  /// cancel button, no invite section (organizer-only actions). Not a Vink Details redesign
  /// (I6's job) — this is the minimal reachable destination I2B requires.
  Widget _buildParticipantScaffold(BuildContext context) {
    final view = _participantView;
    return Scaffold(
      backgroundColor: VinkColors.paper,
      appBar: AppBar(
        backgroundColor: VinkColors.paper,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: VinkColors.ink),
          onPressed: () => context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: view == null && _participantError == null
            ? const VinkLoadingState(message: 'Loading…')
            : (_participantError != null && view == null)
            ? Padding(
                padding: const EdgeInsets.all(VinkSpacing.lg),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    VinkInlineError(
                      message:
                          "Couldn't load this Vink. Check your connection and try again.",
                    ),
                    const SizedBox(height: VinkSpacing.md),
                    VinkSecondaryButton(
                      label: 'Retry',
                      onPressed: () {
                        setState(() => _participantError = null);
                        _realtime?.connect();
                        unawaited(_loadParticipantView());
                      },
                    ),
                  ],
                ),
              )
            : _ParticipantLobbyBody(
                vinkId: widget.vinkId,
                view: view!,
                contributing: _participantContributing,
                contributionError: _participantContributionError,
                onPayShare: _payMyShareAsParticipant,
                onProcessing: () => unawaited(_loadParticipantView()),
                inkProgressVessel: widget.inkProgressVessel,
              ),
      ),
    );
  }
}

String _stateCopy(String state) => switch (state) {
  'DRAFT' => 'Finish setting this Vink up to start collecting.',
  'OPEN' => 'Waiting for everyone to pay their share.',
  'SUBMISSIONS_CLOSED' => 'Wrapping up — no more changes can be made now.',
  'PROCESSING_GRACE' => 'Confirming the last few payments.',
  'FUNDED' => "Everyone's in — getting ready to pay the merchant.",
  'CARD_PROVISIONING' => 'Getting your card ready.',
  'CARD_READY' => 'Your card is ready to use at checkout.',
  'FUNDING_REVERSAL' =>
    "A payment didn't come through in time, so this Vink is unwinding calmly. Anything charged is being refunded.",
  'PURCHASE_AUTHORIZED' => 'Paying the merchant now.',
  'SETTLING' => 'Finishing up the payment.',
  'COMPLETED' => 'This Vink is complete. Thanks for organizing.',
  'RECOVERY_REQUIRED' || 'RECOVERY_PENDING' =>
    'The final charge came in a little higher than expected — resolving the difference now.',
  'CANCELLED' => 'This Vink was cancelled. No one was charged.',
  'RESTRICTED' =>
    'This Vink needs your attention to finish resolving a payment.',
  'EXPIRED' =>
    "This Vink expired before everyone joined in. Any payments made are being refunded automatically.",
  _ => '',
};

/// D24/D25's eight-value guest-safe `contributionStatus`, reused as-is for a signed-in
/// participant (Slice I2B) — deliberately terse, not the organizer body's longer
/// `_stateCopy` sentences (some of which, e.g. "Thanks for organizing", are organizer-
/// specific copy that would be wrong to show a fellow participant; inventing new copy for
/// this slice is out of scope — Phase 6 owns copy).
String _participantStatusCopy(String contributionStatus) =>
    switch (contributionStatus) {
      'confirmed' || 'recovery_required' => 'Paid',
      'processing' => 'Processing…',
      'declined_final' => 'Payment declined',
      'return_pending' => 'Refund in progress',
      'returned' => 'Refunded',
      _ => '',
    };

class _ParticipantLobbyBody extends StatelessWidget {
  const _ParticipantLobbyBody({
    required this.vinkId,
    required this.view,
    required this.contributing,
    required this.contributionError,
    required this.onPayShare,
    required this.onProcessing,
    required this.inkProgressVessel,
  });

  final String vinkId;
  final ParticipantVinkView view;
  final bool contributing;
  final String? contributionError;
  final Future<void> Function() onPayShare;
  final VoidCallback onProcessing;
  final bool inkProgressVessel;

  @override
  Widget build(BuildContext context) {
    final vink = view.vink;
    final participant = view.participant;
    final progress = vink.requiredAmountMinor == 0
        ? 0.0
        : vink.confirmedAmountMinor / vink.requiredAmountMinor;
    final canPay =
        vink.state == 'OPEN' &&
        participant.allocatedAmountMinor > 0 &&
        (participant.contributionStatus == 'not_started' ||
            participant.contributionStatus == 'declined_retryable');
    final justFunded = inkProgressVessel && vink.state == 'FUNDED';

    return ListView(
      padding: const EdgeInsets.all(VinkSpacing.lg),
      children: [
        VinkSurfaceCard(
          elevated: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      justFunded
                          ? "Everyone's in!"
                          : purchaseCategoryLabel(vink.purchaseCategory),
                      style: VinkTypography.cardTitle,
                    ),
                  ),
                  VinkStatusBadge(state: vink.state),
                ],
              ),
              const SizedBox(height: VinkSpacing.md),
              MoneyText(
                vink.requiredAmountMinor,
                style: VinkTypography.amountLarge,
              ),
              const SizedBox(height: VinkSpacing.md),
              // I7 (Phase 8 §15) — D24/D25's privacy boundary means this view never has other
              // participants' names, so its waiting clause is the count-only, disclosed
              // adaptation (`participantSafeWaitingClause`), never the name-based one.
              if (inkProgressVessel)
                VinkVesselAmbientDots(
                  child: VinkProgressVessel(
                    confirmedAmountMinor: vink.confirmedAmountMinor,
                    totalAmountMinor: vink.requiredAmountMinor,
                    waitingClause: participantSafeWaitingClause(
                      confirmedAmountMinor: vink.confirmedAmountMinor,
                      totalAmountMinor: vink.requiredAmountMinor,
                      confirmedParticipantCount: vink.confirmedParticipantCount,
                      totalParticipantCount: vink.totalParticipantCount,
                    ),
                  ),
                )
              else
                VinkProgressIndicator(
                  fundedAmountLabel: MoneyText.format(
                    vink.confirmedAmountMinor,
                  ),
                  requiredAmountLabel: MoneyText.format(
                    vink.requiredAmountMinor,
                  ),
                  progress: progress,
                ),
              const SizedBox(height: VinkSpacing.sm),
              Text(
                '${vink.confirmedParticipantCount} of ${vink.totalParticipantCount} paid',
                style: VinkTypography.bodySmallSecondary,
              ),
            ],
          ),
        ),
        const SizedBox(height: VinkSpacing.lg),
        VinkSurfaceCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Your share', style: VinkTypography.bodySecondary),
              const SizedBox(height: 2),
              MoneyText(
                participant.allocatedAmountMinor,
                style: VinkTypography.amountMedium,
              ),
              const SizedBox(height: VinkSpacing.md),
              if (canPay)
                VinkPaymentPanel(
                  vinkId: vinkId,
                  onProcessing: onProcessing,
                  legacyButton: VinkPrimaryButton(
                    label:
                        'Pay ${MoneyText.format(participant.allocatedAmountMinor)}',
                    glow: true,
                    loading: contributing,
                    onPressed: () => onPayShare(),
                  ),
                )
              else
                Text(
                  _participantStatusCopy(participant.contributionStatus),
                  style: VinkTypography.bodySecondary,
                ),
            ],
          ),
        ),
        if (contributionError != null) ...[
          const SizedBox(height: VinkSpacing.sm),
          VinkInlineError(message: contributionError!),
        ],
      ],
    );
  }
}

class _LobbyBody extends StatelessWidget {
  const _LobbyBody({
    required this.vinkId,
    required this.snapshot,
    required this.cancelError,
    required this.contributing,
    required this.contributionError,
    required this.onPayShare,
    required this.onProcessing,
    required this.inkProgressVessel,
  });

  final String vinkId;
  final VinkSnapshot snapshot;
  final String? cancelError;
  final bool contributing;
  final String? contributionError;
  final Future<void> Function() onPayShare;
  final VoidCallback onProcessing;
  final bool inkProgressVessel;

  @override
  Widget build(BuildContext context) {
    final vink = snapshot.vink;
    final progress = vink.requiredAmountMinor == 0
        ? 0.0
        : vink.fundedAmountMinor / vink.requiredAmountMinor;
    final showsSimulationNotice =
        snapshot.card != null || _simulationVisibleStates.contains(vink.state);
    VinkParticipant? organizer;
    for (final participant in snapshot.participants) {
      if (participant.isOrganizer) {
        organizer = participant;
        break;
      }
    }
    final organizerStatus = organizer == null
        ? null
        : snapshot.contributionStatusByParticipant[organizer.id];
    final organizerCanPay =
        organizer != null &&
        vink.state == 'OPEN' &&
        organizer.allocatedAmountMinor > 0 &&
        paymentStateFor(organizerStatus) != VinkParticipantPaymentState.paid;
    final joinUrl = '${ApiConfig.guestWebBaseUrl}/join/${vink.publicCode}';
    // I7 (Phase 6 §12) — real names, already-visible data on the organizer's own Lobby
    // (D24/D25's organizer-sees-all boundary); the organizer's own unpaid share appears by
    // name too, no special exemption, per Phase 6 §12's own explicit rule.
    final unconfirmedNames = [
      for (final participant in snapshot.participants)
        if (participant.allocatedAmountMinor > 0 &&
            paymentStateFor(
                  snapshot.contributionStatusByParticipant[participant.id],
                ) !=
                VinkParticipantPaymentState.paid)
          participant.displayName,
    ];

    // Concept-image "Everyone's in!" — the one-time celebratory moment right as funding
    // completes (FUNDED specifically, not every later state too: card provisioning/purchase/
    // settlement have their own real status, and permanently overwriting the Vink's own title
    // with a stale "Everyone's in!" would be a real usability regression, not a match to the
    // concept). No "Pay now" button here — confirmed with the owner (ENG1 §7) that the
    // organizer never triggers merchant payment in-app; a real terminal tap does. Adding one
    // would misrepresent a capability that doesn't exist.
    final justFunded = inkProgressVessel && vink.state == 'FUNDED';

    // Concept-image Live Vink: the vessel is the hero, sitting directly on the page
    // background with its own generous whitespace — not boxed in a white card the way every
    // other section on this screen is. Title/badge stays a plain heading row above it.
    return ListView(
      padding: const EdgeInsets.all(VinkSpacing.lg),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                justFunded
                    ? "Everyone's in!"
                    : purchaseCategoryLabel(vink.purchaseCategory),
                style: VinkTypography.cardTitle,
              ),
            ),
            VinkStatusBadge(state: vink.state),
          ],
        ),
        const SizedBox(height: VinkSpacing.xxl),
        // I7 — driven by `contributionProgress` (D20/D24), never `fundedAmountMinor` (which
        // only moves atomically at full resolution, D5) — the exact regression this slice
        // exists to fix (P0-3: a bar that jumps 0→100% instead of rising per-contribution).
        if (inkProgressVessel)
          VinkVesselAmbientDots(
            child: VinkProgressVessel(
              confirmedAmountMinor:
                  snapshot.contributionProgress.confirmedAmountMinor,
              totalAmountMinor: snapshot.contributionProgress.totalAmountMinor,
              waitingClause: organizerWaitingClause(
                confirmedAmountMinor:
                    snapshot.contributionProgress.confirmedAmountMinor,
                totalAmountMinor:
                    snapshot.contributionProgress.totalAmountMinor,
                unconfirmedNames: unconfirmedNames,
              ),
            ),
          )
        else ...[
          MoneyText(
            vink.requiredAmountMinor,
            style: VinkTypography.amountLarge,
          ),
          const SizedBox(height: VinkSpacing.md),
          VinkProgressIndicator(
            fundedAmountLabel: MoneyText.format(vink.fundedAmountMinor),
            requiredAmountLabel: MoneyText.format(vink.requiredAmountMinor),
            progress: progress,
          ),
        ],
        // Caught via self-screenshot: for OPEN, the vessel's own waiting clause ("Waiting for
        // demouser1") already says this — `_stateCopy`'s "Waiting for everyone to pay their
        // share" right underneath it was a visible, redundant duplicate. Every other state
        // still shows it, since the vessel has no per-state messaging for those.
        if (!(inkProgressVessel && vink.state == 'OPEN')) ...[
          const SizedBox(height: VinkSpacing.lg),
          Text(
            _stateCopy(vink.state),
            style: VinkTypography.bodySecondary,
            textAlign: TextAlign.center,
          ),
        ],
        if (showsSimulationNotice) ...[
          const SizedBox(height: VinkSpacing.md),
          const VinkSimulationNotice(),
        ],
        if (snapshot.card != null) ...[
          const SizedBox(height: VinkSpacing.md),
          _CardCard(card: snapshot.card!),
        ],
        if (organizerCanPay) ...[
          const SizedBox(height: VinkSpacing.lg),
          VinkSurfaceCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Your share', style: VinkTypography.bodySecondary),
                const SizedBox(height: 2),
                MoneyText(
                  organizer.allocatedAmountMinor,
                  style: VinkTypography.amountMedium,
                ),
                const SizedBox(height: VinkSpacing.md),
                VinkPaymentPanel(
                  vinkId: vinkId,
                  onProcessing: onProcessing,
                  legacyButton: VinkPrimaryButton(
                    label:
                        'Pay my ${MoneyText.format(organizer.allocatedAmountMinor)}',
                    glow: true,
                    loading: contributing,
                    onPressed: () => onPayShare(),
                  ),
                ),
              ],
            ),
          ),
          if (contributionError != null) ...[
            const SizedBox(height: VinkSpacing.sm),
            VinkInlineError(message: contributionError!),
          ],
        ],
        const SizedBox(height: VinkSpacing.xxl),
        Text('Participants', style: VinkTypography.cardTitle),
        const SizedBox(height: VinkSpacing.sm),
        VinkSurfaceCard(
          padding: const EdgeInsets.symmetric(
            horizontal: VinkSpacing.md,
            vertical: VinkSpacing.xs,
          ),
          child: Column(
            children: [
              // I7 (Phase 8 §13/§27) — participant-row consolidation: the organizer's own row
              // is skipped here when the standalone "Your share" card above is already
              // showing it (with the actionable Pay button) — the same status/amount was
              // being rendered twice. Still shown here once that card is gone (already paid,
              // or the vink isn't OPEN), since it's then the only place that information lives.
              for (final participant in snapshot.participants)
                if (!(organizerCanPay && participant.isOrganizer))
                  VinkParticipantRow(
                    name: participant.displayName,
                    amountMinor: participant.allocatedAmountMinor,
                    paymentState: paymentStateFor(
                      snapshot.contributionStatusByParticipant[participant.id],
                    ),
                    isSelf: participant.isOrganizer,
                    roleLabel: participant.isOrganizer
                        ? 'Organizer'
                        : (participant.isGuest ? 'Guest' : null),
                    // Concept-image People list: a status word + plain circle, no per-row
                    // amount (the organizer already sees the total via the vessel above).
                    showAmount: false,
                    outlineIndicator: true,
                    statusWord: switch (paymentStateFor(
                      snapshot.contributionStatusByParticipant[participant.id],
                    )) {
                      VinkParticipantPaymentState.paid => 'In',
                      VinkParticipantPaymentState.processing => 'Confirming…',
                      VinkParticipantPaymentState.waiting => 'Waiting',
                    },
                  ),
            ],
          ),
        ),
        if (vink.state == 'OPEN')
          VinkDeadlineCountdown(
            deadline: vink.submissionDeadline,
            builder: (context, remaining) {
              // `formatTimeRemaining` reads "21h left" — prefixing "Closes in" produced a
              // real, visible "Closes in 21h left" redundancy, caught via self-screenshot.
              // `pastLabel: null` hides this row entirely once the deadline passes, same as
              // the pre-RM4B behavior.
              final label = formatTimeRemaining(remaining, pastLabel: null);
              if (label == null) return const SizedBox.shrink();
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(height: VinkSpacing.lg),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.schedule_rounded, size: 16, color: VinkColors.smoke),
                      const SizedBox(width: 4),
                      Text(label, style: VinkTypography.bodySmallSecondary),
                    ],
                  ),
                ],
              );
            },
          ),
        const SizedBox(height: VinkSpacing.lg),
        // Concept-image: one outlined "Share Invite" action, not three separate buttons —
        // Copy link/Share/Show QR are all still reachable, now offered from one sheet
        // (no capability removed, just consolidated per the concept's own minimal chrome).
        VinkSecondaryButton(
          label: 'Share Invite',
          leadingIcon: Icons.link_rounded,
          onPressed: () => showVinkBottomSheet<void>(
            context: context,
            builder: (sheetContext) => _ShareInviteSheet(joinUrl: joinUrl),
          ),
        ),
        if (cancelError != null) ...[
          const SizedBox(height: VinkSpacing.sm),
          VinkInlineError(message: cancelError!),
        ],
      ],
    );
  }
}

/// Concept-image "Share Invite" consolidates what used to be three always-visible buttons
/// (Copy link / Share / Show QR) into one sheet — same three capabilities, reached from a
/// single outlined action per the concept's own minimal-chrome Live Vink composition.
class _ShareInviteSheet extends StatelessWidget {
  const _ShareInviteSheet({required this.joinUrl});

  final String joinUrl;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Share Invite', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.lg),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.copy_rounded, color: VinkColors.blue),
          title: const Text('Copy link'),
          onTap: () async {
            await Clipboard.setData(ClipboardData(text: joinUrl));
            if (context.mounted) {
              Navigator.of(context).pop();
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('Link copied.')));
            }
          },
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.ios_share_rounded, color: VinkColors.blue),
          title: const Text('Share'),
          onTap: () {
            Navigator.of(context).pop();
            Share.share(joinUrl);
          },
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.qr_code_rounded, color: VinkColors.blue),
          title: const Text('Show QR code'),
          onTap: () {
            Navigator.of(context).pop();
            showVinkBottomSheet<void>(
              context: context,
              builder: (_) => _JoinQrSheet(joinUrl: joinUrl),
            );
          },
        ),
      ],
    );
  }
}

class _JoinQrSheet extends StatelessWidget {
  const _JoinQrSheet({required this.joinUrl});

  final String joinUrl;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('Scan to join', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.lg),
        DecoratedBox(
          decoration: BoxDecoration(
            color: VinkColors.white,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Padding(
            padding: const EdgeInsets.all(VinkSpacing.md),
            child: QrImageView(
              data: joinUrl,
              size: 220,
              backgroundColor: VinkColors.white,
            ),
          ),
        ),
        const SizedBox(height: VinkSpacing.lg),
        VinkSecondaryButton(
          label: 'Done',
          onPressed: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }
}

class _CardCard extends StatelessWidget {
  const _CardCard({required this.card});

  final VinkCard card;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(VinkSpacing.lg),
      decoration: BoxDecoration(
        color: VinkColors.ink,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'PILOT SIMULATION',
            style: VinkTypography.label.copyWith(
              color: VinkColors.paper.withValues(alpha: 0.6),
              letterSpacing: 1.5,
            ),
          ),
          const SizedBox(height: VinkSpacing.md),
          Text(
            '•••• •••• •••• ${card.displayLastFour}',
            style: VinkTypography.amountMedium.copyWith(
              color: VinkColors.paper,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: VinkSpacing.md),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              MoneyText(
                card.spendingLimitMinor,
                style: VinkTypography.amountMedium.copyWith(
                  color: VinkColors.paper,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              Text(
                card.merchantLocked ? 'Locked to merchant' : 'Not yet locked',
                style: VinkTypography.bodySmall.copyWith(
                  color: VinkColors.paper.withValues(alpha: 0.6),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
