import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_typography.dart';

/// Every canonical D11 vink state (docs/architecture/03-state-machines.md) mapped to
/// human copy — no raw backend state name is ever shown to a user. Colors stay inside the
/// site's own palette: `blue` for "in progress, good," `ink`-on-`ink/8` for neutral/
/// waiting, `danger` only for states that need the organizer's attention.
class _StatusPresentation {
  const _StatusPresentation(this.label, this.tone);
  final String label;
  final _Tone tone;
}

enum _Tone { neutral, active, positive, attention }

const Map<String, _StatusPresentation> _presentations = {
  'DRAFT': _StatusPresentation('Draft', _Tone.neutral),
  'OPEN': _StatusPresentation('Waiting for everyone', _Tone.neutral),
  'SUBMISSIONS_CLOSED': _StatusPresentation('Wrapping up', _Tone.active),
  'PROCESSING_GRACE': _StatusPresentation('Confirming payments', _Tone.active),
  'FUNDED': _StatusPresentation("Everyone's in", _Tone.positive),
  'CARD_PROVISIONING': _StatusPresentation(
    'Getting your card ready',
    _Tone.active,
  ),
  'CARD_READY': _StatusPresentation('Ready to pay', _Tone.positive),
  'FUNDING_REVERSAL': _StatusPresentation('Refunding', _Tone.attention),
  'PURCHASE_AUTHORIZED': _StatusPresentation('Paying now', _Tone.active),
  'SETTLING': _StatusPresentation('Finishing up', _Tone.active),
  'COMPLETED': _StatusPresentation('Completed', _Tone.positive),
  'RECOVERY_REQUIRED': _StatusPresentation(
    'Resolving a shortfall',
    _Tone.attention,
  ),
  'RECOVERY_PENDING': _StatusPresentation(
    'Resolving a shortfall',
    _Tone.attention,
  ),
  'CANCELLED': _StatusPresentation('Cancelled', _Tone.neutral),
  'RESTRICTED': _StatusPresentation('Restricted', _Tone.attention),
  'EXPIRED': _StatusPresentation('Expired', _Tone.attention),
};

/// Maps a raw D11 state name to its human label — usable anywhere the badge's exact pill
/// chrome isn't wanted (e.g. inline in a sentence: "$title is ${vinkStatusLabel(state)}").
String vinkStatusLabel(String rawState) =>
    _presentations[rawState]?.label ?? rawState;

class VinkStatusBadge extends StatelessWidget {
  const VinkStatusBadge({super.key, required this.state});

  final String state;

  @override
  Widget build(BuildContext context) {
    final presentation =
        _presentations[state] ?? _StatusPresentation(state, _Tone.neutral);
    final (background, foreground) = switch (presentation.tone) {
      _Tone.neutral => (
        VinkColors.ink.withValues(alpha: 0.08),
        VinkColors.smoke,
      ),
      _Tone.active => (
        VinkColors.blue.withValues(alpha: 0.12),
        VinkColors.blue,
      ),
      _Tone.positive => (VinkColors.blue, VinkColors.white),
      // Text stays VinkColors.ink, not danger: danger-on-danger/12 fails WCAG AA at this
      // badge's actual text size (label, 14px/600 — under the large-text floor, D36;
      // docs/design/phase-8-visual-system-refinement.md §4/§24). The danger-tinted
      // background is a non-text use and clears the 3:1 non-text threshold on its own, so
      // the attention signal is preserved via the background tint, not the text color.
      _Tone.attention => (
        VinkColors.danger.withValues(alpha: 0.12),
        VinkColors.ink,
      ),
    };
    return Semantics(
      label: 'Status: ${presentation.label}',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          presentation.label,
          style: VinkTypography.bodySmall.copyWith(
            color: foreground,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
