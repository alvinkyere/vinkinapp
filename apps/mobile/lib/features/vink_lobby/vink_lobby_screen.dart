import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../core/models/vink.dart';
import '../../core/realtime/realtime_client.dart';
import '../../design_system/colors/vinkin_colors.dart';
import '../../design_system/components/async_state_view.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/simulation_banner.dart';
import '../../design_system/components/status_pill.dart';
import '../../design_system/components/vinkin_button.dart';
import '../../design_system/spacing/vinkin_spacing.dart';
import '../../design_system/typography/vinkin_typography.dart';

/// The organizer's live view of one Vink (Plan §20 "Vink lobby" / "Funding progress" /
/// "Processing grace" / "Mock card ready" / "Purchase completed" — the states below cover
/// all of those from one screen, matching Plan PV6's card states already on the domain
/// state machine). This is the screen the PV8/PV8.5 realtime channel exists for: the
/// server pushes a `snapshot` on connect and a message per domain event after — this
/// screen never polls.
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
    // Every other message carries only the vink's current state/funded/required directly
    // (apps/api/src/realtime/outbox-publisher.ts sends a lean payload by design, not the
    // full snapshot) — patch those two fields immediately for a snappy header update, then
    // re-fetch the full snapshot so participants/card/allowedActions (e.g. the card that
    // just got provisioned) catch up too. Events are per domain transition, not per second,
    // so one REST round trip per message is cheap.
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
        ),
        participants: current.participants,
        unallocatedAmountMinor: current.unallocatedAmountMinor,
        allowedActions: current.allowedActions,
        card: current.card,
      );
    });
    unawaited(_refreshSnapshot());
  }

  Future<void> _refreshSnapshot() async {
    try {
      final response = await ref.read(apiClientProvider).get('/api/v1/vinks/${widget.vinkId}');
      if (!mounted) return;
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
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  void dispose() {
    _realtime?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Vink')),
      body: AsyncStateView<VinkSnapshot>(
        loading: _snapshot == null && _error == null,
        error: _error,
        data: _snapshot,
        onRetry: () {
          setState(() => _error = null);
          _realtime?.connect();
        },
        builder: (context, snapshot) => _LobbyBody(
          snapshot: snapshot,
          cancelling: _cancelling,
          onCancel: snapshot.allowedActions.contains('CANCEL_VINK') ? _cancelVink : null,
        ),
      ),
    );
  }
}

class _LobbyBody extends StatelessWidget {
  const _LobbyBody({required this.snapshot, required this.cancelling, required this.onCancel});

  final VinkSnapshot snapshot;
  final bool cancelling;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final vink = snapshot.vink;
    final progress = vink.requiredAmountMinor == 0 ? 0.0 : (vink.fundedAmountMinor / vink.requiredAmountMinor).clamp(0.0, 1.0);
    final showsMockMoney = const {
      'FUNDED',
      'CARD_PROVISIONING',
      'CARD_READY',
      'PURCHASE_AUTHORIZED',
      'SETTLING',
      'COMPLETED',
    }.contains(vink.state);

    return ListView(
      padding: const EdgeInsets.all(VinkinSpacing.lg),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(vink.purchaseCategory, style: VinkinTypography.label),
            StatusPill(vink.state),
          ],
        ),
        const SizedBox(height: VinkinSpacing.sm),
        MoneyText(vink.requiredAmountMinor, style: VinkinTypography.display),
        const SizedBox(height: VinkinSpacing.md),
        Semantics(
          label: 'Funding progress: ${MoneyText.format(vink.fundedAmountMinor)} of ${MoneyText.format(vink.requiredAmountMinor)}',
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(value: progress, minHeight: 10, backgroundColor: VinkinColors.border),
          ),
        ),
        const SizedBox(height: VinkinSpacing.xs),
        Text(
          '${MoneyText.format(vink.fundedAmountMinor)} of ${MoneyText.format(vink.requiredAmountMinor)} funded',
          style: VinkinTypography.bodySecondary,
        ),
        const SizedBox(height: VinkinSpacing.lg),
        if (showsMockMoney) ...[
          const SimulationBanner(),
          const SizedBox(height: VinkinSpacing.md),
        ],
        if (snapshot.card != null) _CardCard(card: snapshot.card!),
        if (snapshot.card != null) const SizedBox(height: VinkinSpacing.md),
        const Text('Participants', style: VinkinTypography.label),
        const SizedBox(height: VinkinSpacing.sm),
        ...snapshot.participants.map(
          (participant) => Padding(
            padding: const EdgeInsets.only(bottom: VinkinSpacing.xs),
            child: Row(
              children: [
                Expanded(child: Text(participant.displayName, style: VinkinTypography.body)),
                MoneyText(participant.allocatedAmountMinor, style: VinkinTypography.body),
              ],
            ),
          ),
        ),
        if (onCancel != null) ...[
          const SizedBox(height: VinkinSpacing.lg),
          VinkinButton(label: 'Cancel Vink', variant: VinkinButtonVariant.destructive, loading: cancelling, onPressed: onCancel),
        ],
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
      padding: const EdgeInsets.all(VinkinSpacing.md),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [VinkinColors.primary, VinkinColors.primaryDark]),
        borderRadius: BorderRadius.circular(VinkinSpacing.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('SIMULATED CARD', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1)),
          const SizedBox(height: VinkinSpacing.sm),
          Text('•••• •••• •••• ${card.displayLastFour}', style: const TextStyle(color: Colors.white, fontSize: 20, fontFeatures: [FontFeature.tabularFigures()])),
          const SizedBox(height: VinkinSpacing.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              MoneyText(
                card.spendingLimitMinor,
                style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()]),
              ),
              Text(card.merchantLocked ? 'Locked to merchant' : 'Not yet locked', style: const TextStyle(color: Colors.white70, fontSize: 12)),
            ],
          ),
        ],
      ),
    );
  }
}
