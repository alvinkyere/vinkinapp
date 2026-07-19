import 'package:flutter/material.dart';
import '../colors/vinkin_colors.dart';
import '../spacing/vinkin_spacing.dart';
import '../typography/vinkin_typography.dart';

/// Maps the domain-level vink state (packages/domain canonical vocabulary, D11) to a
/// human label and color — one mapping, reused everywhere a state badge appears.
class StatusPill extends StatelessWidget {
  const StatusPill(this.state, {super.key});

  final String state;

  static const Map<String, (String, Color)> _byState = {
    'DRAFT': ('Draft', VinkinColors.textSecondary),
    'OPEN': ('Open', VinkinColors.primary),
    'SUBMISSIONS_CLOSED': ('Closing', VinkinColors.warning),
    'PROCESSING_GRACE': ('Processing', VinkinColors.warning),
    'FUNDED': ('Funded', VinkinColors.success),
    'CARD_PROVISIONING': ('Preparing card', VinkinColors.warning),
    'CARD_READY': ('Card ready', VinkinColors.success),
    'PURCHASE_AUTHORIZED': ('Purchase authorized', VinkinColors.success),
    'SETTLING': ('Settling', VinkinColors.warning),
    'COMPLETED': ('Completed', VinkinColors.success),
    'RECOVERY_REQUIRED': ('Recovery needed', VinkinColors.danger),
    'RECOVERY_PENDING': ('Recovery pending', VinkinColors.danger),
    'EXPIRED': ('Expired', VinkinColors.danger),
    'CANCELLED': ('Cancelled', VinkinColors.textSecondary),
    'RESTRICTED': ('Restricted', VinkinColors.danger),
    'FUNDING_REVERSAL': ('Reversing', VinkinColors.danger),
  };

  @override
  Widget build(BuildContext context) {
    final (label, color) = _byState[state] ?? (state, VinkinColors.textSecondary);
    return Semantics(
      label: 'Status: $label',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: VinkinSpacing.sm, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(label, style: VinkinTypography.label.copyWith(color: color)),
      ),
    );
  }
}
