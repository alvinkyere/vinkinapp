import 'package:flutter/material.dart';
import '../../../design_system/components/money_text.dart';
import '../../../design_system/components/vink_buttons.dart';
import '../../../design_system/components/vink_inline_error.dart';
import '../../../design_system/vink_spacing.dart';
import '../../../design_system/vink_typography.dart';
import '../person_entry.dart';
import '../purchase_category.dart';
import 'delivery_mode.dart';

/// Slice I5 (Phase 4 §5c, Phase 5 C15) — the transient Open Vink confirmation. A pure,
/// stateless summary + a single action; ALL business logic (submission, idempotency,
/// navigation) stays with the caller ([onOpen]) so this widget itself never talks to the
/// network and is trivially unit/widget-testable in isolation.
///
/// Contract this widget itself is responsible for:
///  - single primary action, disabled the instant it's tapped ([submitting])
///  - no fee line anywhere (D21)
///  - no provider/delivery diagnostics — only the customer-safe expectation per person
///  - dismissal (the caller's `showVinkBottomSheet` background-tap/back) never loses data —
///    this widget holds none of its own to lose
class OpenVinkConfirmationSheet extends StatelessWidget {
  const OpenVinkConfirmationSheet({
    super.key,
    required this.category,
    required this.requiredAmountMinor,
    required this.participants,
    required this.amountsMinorByParticipantId,
    required this.submitting,
    required this.onOpen,
    this.errorMessage,
  });

  final String category;
  final int requiredAmountMinor;
  final List<PersonEntry> participants;

  /// Each participant's own share, keyed by `participantId` — kept separate from
  /// [PersonEntry] rather than adding an amount field there, since a [PersonEntry] is also
  /// used before a split exists (People step) where "amount" isn't yet meaningful.
  final Map<String, int> amountsMinorByParticipantId;
  final bool submitting;
  final VoidCallback onOpen;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Open Vink', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        Text(
          'Once this Vink opens, anyone with an invite can pay their share.',
          style: VinkTypography.bodySecondary,
        ),
        const SizedBox(height: VinkSpacing.lg),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              purchaseCategoryLabel(category),
              style: VinkTypography.cardTitle,
            ),
            MoneyText(requiredAmountMinor, style: VinkTypography.amountMedium),
          ],
        ),
        const SizedBox(height: VinkSpacing.xs),
        Text(
          '${participants.length} ${participants.length == 1 ? 'person' : 'people'}',
          style: VinkTypography.bodySmallSecondary,
        ),
        const SizedBox(height: VinkSpacing.md),
        for (final person in participants)
          Padding(
            padding: const EdgeInsets.only(bottom: VinkSpacing.sm),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        person.isOrganizer
                            ? '${person.displayName} · You'
                            : person.displayName,
                        style: VinkTypography.body,
                      ),
                      // Customer-safe expectation only, per person — never provider
                      // acceptance/attempt history (Phase 4 §5c, explicitly no diagnostics
                      // during Create).
                      if (DeliveryMode.fromWireValue(person.deliveryMode)
                          case final mode?)
                        Text(
                          mode.shortExpectation,
                          style: VinkTypography.bodySmallSecondary,
                        ),
                    ],
                  ),
                ),
                MoneyText(
                  amountsMinorByParticipantId[person.participantId] ?? 0,
                  style: VinkTypography.bodySmall.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        if (errorMessage != null) ...[
          const SizedBox(height: VinkSpacing.sm),
          VinkInlineError(message: errorMessage!),
        ],
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(
          label: 'Open Vink',
          trailingIcon: Icons.arrow_forward_rounded,
          glow: true,
          loading: submitting,
          // Hard-disable the instant a request is in flight (Phase 5 C15) — `loading` alone
          // already disables VinkPrimaryButton (`onPressed == null || loading`), and passing
          // `null` here on top means a second tap can never queue a second request even if
          // the first `setState` hasn't rebuilt yet.
          onPressed: submitting ? null : onOpen,
        ),
      ],
    );
  }
}
