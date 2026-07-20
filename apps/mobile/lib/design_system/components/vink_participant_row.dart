import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_typography.dart';
import 'vink_avatar.dart';
import 'money_text.dart';

enum VinkParticipantPaymentState {
  /// The site's demo card: solid `bg-blue` circle, white check.
  paid,

  /// The site's demo card: `text-blue` monospace "…", `animate-pulse` — currently resolving.
  processing,

  /// The site's demo card: `text-smoke/50` monospace "…" — hasn't acted yet.
  waiting,
}

/// The participant list row from vinkin.org's own Vink-card mockup (design doc): name in
/// `ink` (paid) or `smoke/70` (not yet), a filled-blue checkmark circle or a muted "…" on
/// the right. Extended here with the amount and an optional role/action the site's static
/// mockup didn't need but this app does (guest label, "Pay my $X" action).
class VinkParticipantRow extends StatelessWidget {
  const VinkParticipantRow({
    super.key,
    required this.name,
    required this.amountMinor,
    required this.paymentState,
    this.isSelf = false,
    this.roleLabel,
    this.trailingAction,
  });

  final String name;
  final int amountMinor;
  final VinkParticipantPaymentState paymentState;
  final bool isSelf;

  /// e.g. "Organizer", "Guest" — shown as a small tag after the name.
  final String? roleLabel;

  /// Overrides the default status indicator with an action (e.g. "Pay my $30" button) —
  /// used only for the signed-in organizer's own row when they haven't paid yet.
  final Widget? trailingAction;

  @override
  Widget build(BuildContext context) {
    final nameColor = paymentState == VinkParticipantPaymentState.paid ? VinkColors.ink : VinkColors.smoke.withValues(alpha: 0.85);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          VinkAvatar(name: name, size: 36, isSelf: isSelf),
          const SizedBox(width: 12),
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    isSelf ? '$name · You' : name,
                    style: VinkTypography.participantName.copyWith(color: nameColor),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (roleLabel != null) ...[
                  const SizedBox(width: 6),
                  Text('· $roleLabel', style: VinkTypography.bodySmallSecondary),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          MoneyText(amountMinor, style: VinkTypography.bodySmall.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(width: 12),
          trailingAction ?? _StatusIndicator(state: paymentState),
        ],
      ),
    );
  }
}

class _StatusIndicator extends StatelessWidget {
  const _StatusIndicator({required this.state});

  final VinkParticipantPaymentState state;

  @override
  Widget build(BuildContext context) {
    switch (state) {
      case VinkParticipantPaymentState.paid:
        return Semantics(
          label: 'Paid',
          child: Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: VinkColors.blue),
            child: const Text('✓', style: TextStyle(color: VinkColors.white, fontSize: 13, fontWeight: FontWeight.bold)),
          ),
        );
      case VinkParticipantPaymentState.processing:
        return Semantics(
          label: 'Confirming payment',
          child: Text('···', style: VinkTypography.monoIndicator.copyWith(color: VinkColors.blue)),
        );
      case VinkParticipantPaymentState.waiting:
        return Semantics(
          label: 'Waiting',
          child: Text('···', style: VinkTypography.monoIndicator.copyWith(color: VinkColors.smoke.withValues(alpha: 0.5))),
        );
    }
  }
}
