import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/human_errors.dart';
import '../../core/models/activity_entry.dart';
import '../../core/models/vink.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/vink_avatar.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../activity/activity_copy.dart';
import '../create_vink/purchase_category.dart';
import 'vink_details_providers.dart';

/// Slice I6 (Phase 4 §11, D29/D31) — the organizer/member shared, read-only historical view.
/// Pushed screen, no tab bar, matching Phase 8 §22's exact composition. Deliberately the only
/// screen in this app where a mere participant sees every OTHER participant's own outcome —
/// Phase 4 §11's own explicit widening, confined to this one screen.
///
/// **D31 lock: never render "receipt"/"Receipt" anywhere on this screen** — VinkIn's own
/// recorded data is real, but naming it a receipt overstates its provenance while the
/// provider is still mocked (M0 gate open). See `test/features/vink_details/` for the
/// regression test proving this.
const _supportContactUrl = String.fromEnvironment(
  'SUPPORT_CONTACT_URL',
  defaultValue: '',
);

class VinkDetailsScreen extends ConsumerStatefulWidget {
  const VinkDetailsScreen({super.key, required this.vinkId});

  final String vinkId;

  @override
  ConsumerState<VinkDetailsScreen> createState() => _VinkDetailsScreenState();
}

class _VinkDetailsScreenState extends ConsumerState<VinkDetailsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(analyticsProvider)
          .track('vink_details_opened', const {}, widget.vinkId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final detailsAsync = ref.watch(vinkDetailsProvider(widget.vinkId));

    return Scaffold(
      backgroundColor: VinkColors.paper,
      appBar: AppBar(
        backgroundColor: VinkColors.paper,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: VinkColors.ink),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: detailsAsync.when(
          loading: () =>
              const VinkLoadingState(message: 'Loading Vink details…'),
          error: (error, _) => Padding(
            padding: const EdgeInsets.all(VinkSpacing.lg),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                VinkInlineError(
                  message: error is ApiException
                      ? humanErrorMessage(error)
                      : "This Vink's details aren't available right now.",
                ),
                const SizedBox(height: VinkSpacing.md),
                VinkSecondaryButton(
                  label: 'Try again',
                  onPressed: () =>
                      ref.invalidate(vinkDetailsProvider(widget.vinkId)),
                ),
              ],
            ),
          ),
          data: (details) => _VinkDetailsBody(details: details),
        ),
      ),
    );
  }
}

class _VinkDetailsBody extends StatelessWidget {
  const _VinkDetailsBody({required this.details});

  final VinkDetailsView details;

  String get _title =>
      details.purpose ?? purchaseCategoryLabel(details.purchaseCategory);

  /// Neutral, third-person copy — this screen is shared between the organizer and every
  /// participant (Phase 4 §11's own widening), so no "you"-framed phrasing (matching D34's
  /// established money-outcome discipline). Driven by the server-computed [VinkDetailsView
  /// .vinkOutcome] (D43) — never a raw state name, and never re-derived client-side from the
  /// timeline (which the earlier draft of this screen did before D43 corrected the whole
  /// privacy model).
  String get _outcomeStatement => switch (details.vinkOutcome) {
    'completed' =>
      'The merchant was paid ${MoneyText.format(details.totalMinor)}.',
    'cancelled' => 'This Vink was cancelled. No one was charged.',
    'expired' => 'This Vink expired before everyone joined.',
    'recovery_required' => "We're resolving a shortfall on this Vink.",
    'not_open_yet' => "This Vink hasn't opened yet.",
    _ => 'This Vink is still in progress.',
  };

  @override
  Widget build(BuildContext context) {
    final viewer = details.viewerParticipant;
    return ListView(
      padding: const EdgeInsets.all(VinkSpacing.lg),
      children: [
        // Concept-image: a centered category icon, title, and a compact outcome badge — the
        // hero identity block, matching the Vink Details reference layout.
        Center(
          child: Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: VinkColors.blue,
            ),
            child: Icon(
              purchaseCategoryIcon(details.purchaseCategory),
              color: VinkColors.white,
              size: 26,
            ),
          ),
        ),
        const SizedBox(height: VinkSpacing.sm),
        Text(
          _title,
          textAlign: TextAlign.center,
          style: VinkTypography.cardTitle,
        ),
        const SizedBox(height: VinkSpacing.xs),
        Center(
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: VinkSpacing.sm,
              vertical: 4,
            ),
            decoration: BoxDecoration(
              color: VinkColors.blue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              outcomeLabelCopy(details.vinkOutcome),
              style: VinkTypography.bodySmall.copyWith(
                color: VinkColors.blue,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        const SizedBox(height: VinkSpacing.sm),
        // The fuller sentence stays too (quieter, below the badge) — genuinely useful detail
        // the concept's own compact badge doesn't carry on its own (e.g. "No one was
        // charged" for a cancelled Vink).
        Text(
          _outcomeStatement,
          textAlign: TextAlign.center,
          style: VinkTypography.bodySmallSecondary,
        ),
        const SizedBox(height: VinkSpacing.xl),
        _DetailRow(
          label: 'Total',
          value: MoneyText.format(details.totalMinor),
          emphasized: true,
        ),
        const SizedBox(height: VinkSpacing.sm),
        // Slice I6 (D43): a customer-safe AGGREGATE only — never a per-participant
        // breakdown, for either the organizer or a participant.
        _DetailRow(
          label: 'Confirmed',
          value:
              '${MoneyText.format(details.summary.confirmedAmountMinor)} · '
              '${details.summary.confirmedParticipantCount} of '
              '${details.summary.totalParticipantCount} paid',
        ),
        if (details.merchantSettlementDetail != null) ...[
          const SizedBox(height: VinkSpacing.sm),
          Text(
            details.merchantSettlementDetail!,
            style: VinkTypography.bodySmallSecondary,
          ),
        ],
        const SizedBox(height: VinkSpacing.xl),
        if (details.isOrganizerViewer) ...[
          Text('Organizer', style: VinkTypography.cardTitle),
          const SizedBox(height: VinkSpacing.sm),
          // D43: no name/avatar here — this is the organizer's OWN screen, and a per-
          // participant identity (even their own) stays out of the aggregate-only view.
          Text('You organized this Vink', style: VinkTypography.body),
        ] else if (viewer != null) ...[
          Text('Your share', style: VinkTypography.cardTitle),
          const SizedBox(height: VinkSpacing.sm),
          Row(
            children: [
              VinkAvatar(name: details.organizerDisplayName, size: 32),
              const SizedBox(width: VinkSpacing.sm),
              Text(
                'Organized by ${details.organizerDisplayName}',
                style: VinkTypography.bodySmallSecondary,
              ),
            ],
          ),
          const SizedBox(height: VinkSpacing.sm),
          _DetailRow(
            label: 'Assigned',
            value: MoneyText.format(viewer.assignedShareMinor),
          ),
          const SizedBox(height: VinkSpacing.sm),
          _DetailRow(
            label: 'Your outcome',
            value: _outcomeCopy(viewer.contributionOutcomeLabel),
          ),
        ],
        if (details.timeline.isNotEmpty) ...[
          const SizedBox(height: VinkSpacing.xl),
          Text('Timeline', style: VinkTypography.cardTitle),
          const SizedBox(height: VinkSpacing.sm),
          for (final entry in details.timeline)
            Padding(
              padding: const EdgeInsets.only(bottom: VinkSpacing.sm),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.check_circle_rounded,
                    size: 18,
                    color: VinkColors.blue,
                  ),
                  const SizedBox(width: VinkSpacing.sm),
                  Expanded(
                    child: Text(
                      activityCopy(
                        ActivityEntry(
                          kind: 'event',
                          at: entry.at,
                          detail: {'eventType': entry.eventType},
                        ),
                        vinkTitle: _title,
                        isOrganizerViewer: false,
                      ),
                      style: VinkTypography.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
        ],
        // Concept-image "Get help" is a persistent outlined action, not error-state-only —
        // widened from the prior unclear-outcome-only gate (no test/decision pinned that
        // gate, so this is a disclosed convergence, not an override of a ratified rule).
        if (_supportContactUrl.isNotEmpty) ...[
          const SizedBox(height: VinkSpacing.xl),
          VinkSecondaryButton(
            label: 'Get help',
            leadingIcon: Icons.help_outline_rounded,
            onPressed: () async {
              await Clipboard.setData(
                const ClipboardData(text: _supportContactUrl),
              );
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Support link copied')),
                );
              }
            },
          ),
        ],
      ],
    );
  }
}

/// Plain label-left/value-right row — the concept's own Total/Your share/Your payment rhythm.
class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: VinkTypography.bodySecondary),
        Text(
          value,
          style: emphasized
              ? VinkTypography.amountMedium
              : VinkTypography.body.copyWith(fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}

/// D24/D25's eight-value guest-safe status vocabulary, reused as-is (this screen never
/// invents a parallel one) — every value gets explicit copy here, unlike the Lobby's own
/// `_participantStatusCopy` (which leaves `not_started`/`declined_retryable` blank because a
/// button fills that space there; this is a read-only historical screen with no button).
String _outcomeCopy(String contributionOutcomeLabel) =>
    switch (contributionOutcomeLabel) {
      'confirmed' => 'Paid',
      'processing' => 'Processing…',
      'not_started' => "Didn't pay",
      'declined_retryable' || 'declined_final' => 'Payment declined',
      'return_pending' => 'Refund in progress',
      'returned' => 'Refunded',
      'recovery_required' => 'Resolving a shortfall',
      _ => contributionOutcomeLabel,
    };
