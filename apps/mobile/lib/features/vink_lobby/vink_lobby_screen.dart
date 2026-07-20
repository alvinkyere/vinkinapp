import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/human_errors.dart';
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
  const VinkLobbyScreen({super.key, required this.vinkId});

  final String vinkId;

  @override
  ConsumerState<VinkLobbyScreen> createState() => _VinkLobbyScreenState();
}

class _VinkLobbyScreenState extends ConsumerState<VinkLobbyScreen> {
  RealtimeClient? _realtime;
  VinkSnapshot? _snapshot;
  Object? _error;
  bool _cancelling = false;
  bool _contributing = false;
  String? _contributionError;

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
    _connect();
  }

  void _connect() {
    final authState = ref.read(authControllerProvider);
    if (authState is! AuthSignedIn) return;
    final client = RealtimeClient(vinkId: widget.vinkId, accessToken: authState.accessToken);
    client.messages.listen(_onMessage, onError: (error) => setState(() => _error = error));
    client.connect();
    _realtime = client;
  }

  void _onMessage(Map<String, dynamic> message) {
    if (!mounted) return;
    if (message['type'] == 'snapshot') {
      setState(() {
        _snapshot = VinkSnapshot.fromJson(message['snapshot'] as Map<String, dynamic>);
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
          fundedAmountMinor: (fundedAmountMinor ?? current.vink.fundedAmountMinor).toInt(),
          version: current.vink.version,
          organizerUserId: current.vink.organizerUserId,
          submissionDeadline: current.vink.submissionDeadline,
        ),
        participants: current.participants,
        unallocatedAmountMinor: current.unallocatedAmountMinor,
        allowedActions: current.allowedActions,
        card: current.card,
        contributionStatusByParticipant: current.contributionStatusByParticipant,
      );
    });
    unawaited(_refreshSnapshot());
  }

  Future<void> _refreshSnapshot() async {
    final requestId = ++_snapshotRequestId;
    try {
      final response = await ref.read(apiClientProvider).get('/api/v1/vinks/${widget.vinkId}');
      if (!mounted || requestId != _snapshotRequestId) return;
      setState(() => _snapshot = VinkSnapshot.fromJson(response));
    } on ApiException {
      // The next WS message (or manual retry) will trigger another attempt; the lobby
      // already reflects the lightweight state/funded patch applied above.
    }
  }

  Future<void> _cancelVink() async {
    setState(() => _cancelling = true);
    try {
      await ref.read(apiClientProvider).post('/api/v1/vinks/${widget.vinkId}/cancel');
      ref.invalidate(myVinksProvider);
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
      await ref.read(apiClientProvider).post('/api/v1/vinks/${widget.vinkId}/contributions/authorize');
      await _refreshSnapshot();
    } on ApiException catch (error) {
      setState(() => _contributionError = humanErrorMessage(error));
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
                          VinkInlineError(message: "Couldn't connect. Check your connection and try again."),
                          const SizedBox(height: VinkSpacing.md),
                          VinkSecondaryButton(
                            label: 'Retry',
                            onPressed: () {
                              setState(() => _error = null);
                              _realtime?.connect();
                            },
                          ),
                        ],
                      ),
                    )
                  : _LobbyBody(
                      snapshot: snapshot!,
                      cancelling: _cancelling,
                      contributing: _contributing,
                      contributionError: _contributionError,
                      onCancel: snapshot.allowedActions.contains('CANCEL_VINK') ? _cancelVink : null,
                      onPayShare: _payMyShare,
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
  'FUNDING_REVERSAL' => "A payment didn't come through in time, so this Vink is unwinding calmly. Anything charged is being refunded.",
  'PURCHASE_AUTHORIZED' => 'Paying the merchant now.',
  'SETTLING' => 'Finishing up the payment.',
  'COMPLETED' => 'This Vink is complete. Thanks for organizing.',
  'RECOVERY_REQUIRED' || 'RECOVERY_PENDING' => 'The final charge came in a little higher than expected — resolving the difference now.',
  'CANCELLED' => 'This Vink was cancelled. No one was charged.',
  'RESTRICTED' => 'This Vink needs your attention to finish resolving a payment.',
  'EXPIRED' => "This Vink expired before everyone joined in. Any payments made are being refunded automatically.",
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

class _LobbyBody extends StatelessWidget {
  const _LobbyBody({
    required this.snapshot,
    required this.cancelling,
    required this.contributing,
    required this.contributionError,
    required this.onCancel,
    required this.onPayShare,
  });

  final VinkSnapshot snapshot;
  final bool cancelling;
  final bool contributing;
  final String? contributionError;
  final VoidCallback? onCancel;
  final Future<void> Function() onPayShare;

  @override
  Widget build(BuildContext context) {
    final vink = snapshot.vink;
    final progress = vink.requiredAmountMinor == 0 ? 0.0 : vink.fundedAmountMinor / vink.requiredAmountMinor;
    final showsSimulationNotice = snapshot.card != null || _simulationVisibleStates.contains(vink.state);
    VinkParticipant? organizer;
    for (final participant in snapshot.participants) {
      if (participant.isOrganizer) {
        organizer = participant;
        break;
      }
    }
    final organizerStatus = organizer == null ? null : snapshot.contributionStatusByParticipant[organizer.id];
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
                  Expanded(child: Text(purchaseCategoryLabel(vink.purchaseCategory), style: VinkTypography.cardTitle)),
                  VinkStatusBadge(state: vink.state),
                ],
              ),
              const SizedBox(height: VinkSpacing.md),
              MoneyText(vink.requiredAmountMinor, style: VinkTypography.amountLarge),
              const SizedBox(height: VinkSpacing.md),
              VinkProgressIndicator(
                fundedAmountLabel: MoneyText.format(vink.fundedAmountMinor),
                requiredAmountLabel: MoneyText.format(vink.requiredAmountMinor),
                progress: progress,
              ),
              const SizedBox(height: VinkSpacing.md),
              Text(_stateCopy(vink.state), style: VinkTypography.bodySecondary),
              if (vink.state == 'OPEN' && _timeRemainingLabel(vink.submissionDeadline) != null) ...[
                const SizedBox(height: VinkSpacing.sm),
                Row(
                  children: [
                    Icon(Icons.schedule_rounded, size: 16, color: VinkColors.smoke),
                    const SizedBox(width: 4),
                    Text(_timeRemainingLabel(vink.submissionDeadline)!, style: VinkTypography.bodySmallSecondary),
                  ],
                ),
              ],
            ],
          ),
        ),
        if (showsSimulationNotice) ...[const SizedBox(height: VinkSpacing.md), const VinkSimulationNotice()],
        if (snapshot.card != null) ...[const SizedBox(height: VinkSpacing.md), _CardCard(card: snapshot.card!)],
        if (organizerCanPay) ...[
          const SizedBox(height: VinkSpacing.lg),
          VinkSurfaceCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Your share', style: VinkTypography.bodySecondary),
                const SizedBox(height: 2),
                MoneyText(organizer.allocatedAmountMinor, style: VinkTypography.amountMedium),
                const SizedBox(height: VinkSpacing.md),
                VinkPrimaryButton(
                  label: 'Pay my ${MoneyText.format(organizer.allocatedAmountMinor)}',
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
          padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.md, vertical: VinkSpacing.xs),
          child: Column(
            children: [
              for (final participant in snapshot.participants)
                VinkParticipantRow(
                  name: participant.displayName,
                  amountMinor: participant.allocatedAmountMinor,
                  paymentState: paymentStateFor(snapshot.contributionStatusByParticipant[participant.id]),
                  isSelf: participant.isOrganizer,
                  roleLabel: participant.isOrganizer ? 'Organizer' : (participant.isGuest ? 'Guest' : null),
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
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied.')));
                        }
                      },
                    ),
                  ),
                  const SizedBox(width: VinkSpacing.sm),
                  Expanded(
                    child: VinkSecondaryButton(label: 'Share', onPressed: () => Share.share(joinUrl)),
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
          VinkDestructiveButton(label: 'Cancel Vink', loading: cancelling, onPressed: onCancel),
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
          decoration: BoxDecoration(color: VinkColors.white, borderRadius: BorderRadius.circular(16)),
          child: Padding(
            padding: const EdgeInsets.all(VinkSpacing.md),
            child: QrImageView(data: joinUrl, size: 220, backgroundColor: VinkColors.white),
          ),
        ),
        const SizedBox(height: VinkSpacing.lg),
        VinkSecondaryButton(label: 'Done', onPressed: () => Navigator.of(context).pop()),
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
      decoration: BoxDecoration(color: VinkColors.ink, borderRadius: BorderRadius.circular(24)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'PILOT SIMULATION',
            style: VinkTypography.label.copyWith(color: VinkColors.paper.withValues(alpha: 0.6), letterSpacing: 1.5),
          ),
          const SizedBox(height: VinkSpacing.md),
          Text(
            '•••• •••• •••• ${card.displayLastFour}',
            style: VinkTypography.amountMedium.copyWith(color: VinkColors.paper, fontFeatures: const [FontFeature.tabularFigures()]),
          ),
          const SizedBox(height: VinkSpacing.md),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              MoneyText(
                card.spendingLimitMinor,
                style: VinkTypography.amountMedium.copyWith(color: VinkColors.paper, fontFeatures: const [FontFeature.tabularFigures()]),
              ),
              Text(
                card.merchantLocked ? 'Locked to merchant' : 'Not yet locked',
                style: VinkTypography.bodySmall.copyWith(color: VinkColors.paper.withValues(alpha: 0.6)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
