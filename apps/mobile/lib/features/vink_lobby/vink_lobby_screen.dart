import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/failure_classifier.dart';
import '../../core/errors/failure_handling.dart';
import '../../core/models/vink.dart';
import '../../core/networking/api_config.dart';
import '../../core/realtime/realtime_client.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/vink_bottom_sheet.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_participant_row.dart';
import '../../design_system/components/vink_progress_indicator.dart';
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
  const VinkLobbyScreen({super.key, required this.vinkId, this.role});

  final String vinkId;

  /// Slice I2B: set only by Home's participant-role card tap (`?role=participant`) — every
  /// other caller (deep links, the post-create-vink redirect, existing organizer navigation)
  /// omits it, which this screen treats identically to `'organizer'` (today's only behavior).
  final String? role;

  bool get isParticipantView => role == 'participant';

  @override
  ConsumerState<VinkLobbyScreen> createState() => _VinkLobbyScreenState();
}

class _VinkLobbyScreenState extends ConsumerState<VinkLobbyScreen> {
  RealtimeClient? _realtime;
  VinkSnapshot? _snapshot;
  Object? _error;
  bool _cancelling = false;
  String? _cancelError;
  bool _contributing = false;
  String? _contributionError;

  // Slice I2B — participant-view-only state. Deliberately HTTP-only, no realtime channel:
  // the `/live` WS route resolves non-guest tokens via the same organizer-only
  // `getVinkSnapshot` this screen's organizer path uses (apps/api/src/modules/realtime/
  // routes.ts), so it would 403 for a participant exactly like the REST snapshot route does
  // — wiring participant realtime is out of this slice's scope and is flagged as a known gap
  // in the I2B completion report, not silently assumed to work.
  ParticipantVinkView? _participantView;
  Object? _participantError;
  bool _participantContributing = false;
  String? _participantContributionError;

  // Multiple WS events can arrive in quick succession (e.g. the organizer, a member, and a
  // guest all contributing within milliseconds of each other), each firing its own
  // `_refreshSnapshot()`. Overlapping REST fetches can complete out of order, so a guard is
  // needed — otherwise a slower, older response can overwrite a faster, newer one and leave
  // the lobby stuck showing stale funded/participant data. Only the result of the most
  // recently *issued* fetch is ever applied.
  int _snapshotRequestId = 0;

  @override
  void initState() {
    super.initState();
    if (widget.isParticipantView) {
      unawaited(_loadParticipantView());
      return;
    }
    _connect();
    // The realtime channel is an enhancement, not the source of truth for first paint (ENG1
    // §3): fetch the authoritative snapshot over plain, boundedly-timed-out HTTP immediately,
    // rather than leaving the screen on "Connecting…" until a WebSocket `snapshot` frame
    // happens to arrive. Whichever of the two resolves first shows the lobby; the other keeps
    // it current.
    unawaited(_loadInitialSnapshot());
  }

  Future<void> _loadParticipantView() async {
    try {
      final response = await ref
          .read(apiClientProvider)
          .get('/api/v1/vinks/${widget.vinkId}/participant-view');
      if (!mounted) return;
      setState(() {
        _participantView = ParticipantVinkView.fromJson(response);
        _participantError = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _participantError = error);
    }
  }

  /// The exact same contribution engine every other participant uses
  /// (`POST .../contributions/authorize`, resolved by the caller's own user id) — no new
  /// financial logic, mirrors `_payMyShare` above.
  Future<void> _payMyShareAsParticipant() async {
    setState(() {
      _participantContributing = true;
      _participantContributionError = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .post('/api/v1/vinks/${widget.vinkId}/contributions/authorize');
      await _loadParticipantView();
    } on ApiException catch (error) {
      setState(
        () =>
            _participantContributionError = presentFailure(ref, error).message,
      );
    } finally {
      if (mounted) setState(() => _participantContributing = false);
    }
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
      final response = await ref
          .read(apiClientProvider)
          .get('/api/v1/vinks/${widget.vinkId}');
      if (!mounted || requestId != _snapshotRequestId) return;
      final snapshot = VinkSnapshot.fromJson(response);
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
      if (!mounted || requestId != _snapshotRequestId || _snapshot != null) {
        return;
      }
      setState(() => _error = error);
    }
  }

  void _onMessage(Map<String, dynamic> message) {
    if (!mounted) return;
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
      );
    });
    unawaited(_refreshSnapshot());
  }

  Future<void> _refreshSnapshot() async {
    final requestId = ++_snapshotRequestId;
    try {
      final response = await ref
          .read(apiClientProvider)
          .get('/api/v1/vinks/${widget.vinkId}');
      if (!mounted || requestId != _snapshotRequestId) return;
      setState(() => _snapshot = VinkSnapshot.fromJson(response));
    } on ApiException {
      // The next WS message (or manual retry) will trigger another attempt; the lobby
      // already reflects the lightweight state/funded patch applied above.
    }
  }

  Future<void> _cancelVink() async {
    setState(() {
      _cancelling = true;
      _cancelError = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .post('/api/v1/vinks/${widget.vinkId}/cancel');
      ref.invalidate(myVinksProvider);
    } on ApiException catch (error) {
      // ENG1 #4: cancel is a one-way transition (packages/domain/src/vink-state-machine.ts)
      // — a double tap hits ILLEGAL_TRANSITION, classified as conflict. Either way the
      // authoritative state is what matters now, so refresh and show it rather than a raw
      // error for something that may well have already succeeded.
      final failure = presentFailure(ref, error);
      await _refreshSnapshot();
      if (!mounted) return;
      if (failure.category != FailureCategory.conflict) {
        setState(() => _cancelError = failure.message);
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  /// The organizer's own "Pay my $X" — the exact same contribution engine every other
  /// participant uses (`POST .../contributions/authorize`, resolved by the caller's own
  /// user id), never a shortcut and never a hidden default.
  Future<void> _payMyShare() async {
    setState(() {
      _contributing = true;
      _contributionError = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .post('/api/v1/vinks/${widget.vinkId}/contributions/authorize');
      await _refreshSnapshot();
    } on ApiException catch (error) {
      setState(() => _contributionError = presentFailure(ref, error).message);
    } finally {
      if (mounted) setState(() => _contributing = false);
    }
  }

  @override
  void dispose() {
    _realtime?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isParticipantView) return _buildParticipantScaffold(context);
    final snapshot = _snapshot;
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
                snapshot: snapshot!,
                cancelling: _cancelling,
                cancelError: _cancelError,
                contributing: _contributing,
                contributionError: _contributionError,
                onCancel: snapshot.allowedActions.contains('CANCEL_VINK')
                    ? _cancelVink
                    : null,
                onPayShare: _payMyShare,
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
                        unawaited(_loadParticipantView());
                      },
                    ),
                  ],
                ),
              )
            : _ParticipantLobbyBody(
                view: view!,
                contributing: _participantContributing,
                contributionError: _participantContributionError,
                onPayShare: _payMyShareAsParticipant,
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

/// Only meaningful while OPEN (submissions still being collected) — same phrasing as the
/// Home screen's Active Vink card (`features/home/home_screen.dart`), shown here too so the
/// live lobby carries the same "time pressure" signal, not just a static progress bar.
String? _timeRemainingLabel(DateTime? deadline) {
  if (deadline == null) return null;
  final diff = deadline.difference(DateTime.now());
  if (diff.isNegative) return null;
  if (diff.inMinutes < 60) return '${diff.inMinutes}m left';
  if (diff.inHours < 24) return '${diff.inHours}h left';
  return '${diff.inDays}d left';
}

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
    required this.view,
    required this.contributing,
    required this.contributionError,
    required this.onPayShare,
  });

  final ParticipantVinkView view;
  final bool contributing;
  final String? contributionError;
  final Future<void> Function() onPayShare;

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
                      purchaseCategoryLabel(vink.purchaseCategory),
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
              VinkProgressIndicator(
                fundedAmountLabel: MoneyText.format(vink.confirmedAmountMinor),
                requiredAmountLabel: MoneyText.format(vink.requiredAmountMinor),
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
                VinkPrimaryButton(
                  label:
                      'Pay ${MoneyText.format(participant.allocatedAmountMinor)}',
                  glow: true,
                  loading: contributing,
                  onPressed: () => onPayShare(),
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
    required this.snapshot,
    required this.cancelling,
    required this.cancelError,
    required this.contributing,
    required this.contributionError,
    required this.onCancel,
    required this.onPayShare,
  });

  final VinkSnapshot snapshot;
  final bool cancelling;
  final String? cancelError;
  final bool contributing;
  final String? contributionError;
  final VoidCallback? onCancel;
  final Future<void> Function() onPayShare;

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
                      purchaseCategoryLabel(vink.purchaseCategory),
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
              VinkProgressIndicator(
                fundedAmountLabel: MoneyText.format(vink.fundedAmountMinor),
                requiredAmountLabel: MoneyText.format(vink.requiredAmountMinor),
                progress: progress,
              ),
              const SizedBox(height: VinkSpacing.md),
              Text(_stateCopy(vink.state), style: VinkTypography.bodySecondary),
              if (vink.state == 'OPEN' &&
                  _timeRemainingLabel(vink.submissionDeadline) != null) ...[
                const SizedBox(height: VinkSpacing.sm),
                Row(
                  children: [
                    Icon(
                      Icons.schedule_rounded,
                      size: 16,
                      color: VinkColors.smoke,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      _timeRemainingLabel(vink.submissionDeadline)!,
                      style: VinkTypography.bodySmallSecondary,
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
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
                VinkPrimaryButton(
                  label:
                      'Pay my ${MoneyText.format(organizer.allocatedAmountMinor)}',
                  glow: true,
                  loading: contributing,
                  onPressed: () => onPayShare(),
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
              for (final participant in snapshot.participants)
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
                ),
            ],
          ),
        ),
        const SizedBox(height: VinkSpacing.xxl),
        Text('Invite people', style: VinkTypography.cardTitle),
        const SizedBox(height: VinkSpacing.sm),
        VinkSurfaceCard(
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: VinkSecondaryButton(
                      label: 'Copy link',
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: joinUrl));
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Link copied.')),
                          );
                        }
                      },
                    ),
                  ),
                  const SizedBox(width: VinkSpacing.sm),
                  Expanded(
                    child: VinkSecondaryButton(
                      label: 'Share',
                      onPressed: () => Share.share(joinUrl),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: VinkSpacing.sm),
              VinkTextButton(
                label: 'Show QR code',
                onPressed: () => showVinkBottomSheet<void>(
                  context: context,
                  builder: (_) => _JoinQrSheet(joinUrl: joinUrl),
                ),
              ),
            ],
          ),
        ),
        if (onCancel != null) ...[
          const SizedBox(height: VinkSpacing.xxl),
          VinkDestructiveButton(
            label: 'Cancel Vink',
            loading: cancelling,
            onPressed: onCancel,
          ),
          if (cancelError != null) ...[
            const SizedBox(height: VinkSpacing.sm),
            VinkInlineError(message: cancelError!),
          ],
        ],
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
