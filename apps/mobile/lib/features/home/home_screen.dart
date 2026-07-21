import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/human_errors.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_progress_indicator.dart';
import '../../design_system/components/vink_status_badge.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../activity/activity_copy.dart';
import '../activity/activity_providers.dart';
import '../create_vink/purchase_category.dart';
import 'home_providers.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);
    final firstName = authState is AuthSignedIn
        ? authState.user.displayName.split(' ').first
        : '';

    return Scaffold(
      backgroundColor: VinkColors.paper,
      body: SafeArea(
        child: RefreshIndicator(
          color: VinkColors.blue,
          onRefresh: () async {
            ref.invalidate(myVinksProvider);
            ref.invalidate(activeVinksProvider);
            ref.invalidate(recentActivityProvider);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              VinkSpacing.lg,
              VinkSpacing.lg,
              VinkSpacing.lg,
              VinkSpacing.xxl,
            ),
            children: [
              Text(
                'Hi, $firstName',
                style: VinkTypography.heroDisplay.copyWith(fontSize: 28),
              ),
              const SizedBox(height: VinkSpacing.xs),
              Text(
                'Everyone in. One purchase.',
                style: VinkTypography.bodySecondary,
              ),
              const SizedBox(height: VinkSpacing.lg),
              VinkPrimaryButton(
                label: 'Start a Vink',
                glow: true,
                onPressed: () => context.push('/create-vink'),
              ),
              const SizedBox(height: VinkSpacing.xxl),
              Text('Active Vinks', style: VinkTypography.cardTitle),
              const SizedBox(height: VinkSpacing.md),
              const _ActiveVinksSection(),
              const SizedBox(height: VinkSpacing.xxl),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Recent activity', style: VinkTypography.cardTitle),
                  VinkTextButton(
                    label: 'See all',
                    onPressed: () => context.go('/activity'),
                  ),
                ],
              ),
              const SizedBox(height: VinkSpacing.sm),
              const _RecentActivityPreview(),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActiveVinksSection extends ConsumerWidget {
  const _ActiveVinksSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeAsync = ref.watch(activeVinksProvider);

    return activeAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: VinkSpacing.lg),
        child: VinkLoadingState(message: 'Loading your Vinks…'),
      ),
      error: (error, _) => VinkInlineError(
        message: error is ApiException
            ? humanErrorMessage(error)
            : "Couldn't load your Vinks.",
      ),
      data: (active) {
        if (active.isEmpty) {
          return VinkSurfaceCard(
            child: VinkEmptyState(
              title: 'Nothing active right now',
              message:
                  'Split a purchase with your group — everyone pays their share, you pay the merchant once.',
              action: VinkPrimaryButton(
                label: 'Start your first Vink',
                onPressed: () => context.push('/create-vink'),
              ),
            ),
          );
        }
        return Column(
          children: [
            for (final item in active) ...[
              _ActiveVinkCard(item: item),
              const SizedBox(height: VinkSpacing.md),
            ],
          ],
        );
      },
    );
  }
}

class _ActiveVinkCard extends StatelessWidget {
  const _ActiveVinkCard({required this.item});

  final ActiveVink item;

  @override
  Widget build(BuildContext context) {
    final vink = item.vink;
    final progress = vink.requiredAmountMinor == 0
        ? 0.0
        : vink.fundedAmountMinor / vink.requiredAmountMinor;
    final timeLabel = _timeRemainingLabel(vink.submissionDeadline);
    final actionLabel = _nextActionLabel(vink.state);
    final statusLabel = vinkStatusLabel(vink.state);
    final title = purchaseCategoryLabel(vink.purchaseCategory);
    // ENG1 #5: a DRAFT Vink has no live/funding state to show — VinkLobbyScreen is for
    // OPEN-and-beyond. State decides the destination, not the "Draft" label alone
    // (VinkLobbyScreen redirects here too, for any other path that reaches a DRAFT vink).
    // Slice I2B: a participant-role entry carries `?role=participant` so VinkLobbyScreen
    // knows, without a network round trip, to use the customer-safe participant-view route
    // rather than the organizer-only snapshot route (which would 403 for this user). A DRAFT
    // vink is always organizer-owned (participants are never added before OPEN's own
    // precondition is met in a way that surfaces here), so the role param is moot for that
    // branch.
    final destination = vink.state == 'DRAFT'
        ? '/create-vink/resume/${vink.id}'
        : vink.isOrganizerRole
        ? '/vinks/${vink.id}'
        : '/vinks/${vink.id}?role=participant';

    return Semantics(
      button: true,
      label:
          '$title, ${MoneyText.format(vink.fundedAmountMinor)} of ${MoneyText.format(vink.requiredAmountMinor)} funded, '
          '${item.participantCount} people, $statusLabel. $actionLabel',
      child: InkWell(
        borderRadius: BorderRadius.circular(32),
        onTap: () => context.push(destination),
        child: VinkSurfaceCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(title, style: VinkTypography.cardTitle)),
                  VinkStatusBadge(state: vink.state),
                ],
              ),
              const SizedBox(height: VinkSpacing.md),
              VinkProgressIndicator(
                fundedAmountLabel: MoneyText.format(vink.fundedAmountMinor),
                requiredAmountLabel: MoneyText.format(vink.requiredAmountMinor),
                progress: progress,
              ),
              const SizedBox(height: VinkSpacing.md),
              Row(
                children: [
                  Icon(
                    Icons.people_outline_rounded,
                    size: 16,
                    color: VinkColors.smoke,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${item.participantCount} ${item.participantCount == 1 ? 'person' : 'people'}',
                    style: VinkTypography.bodySmallSecondary,
                  ),
                  if (timeLabel != null) ...[
                    const SizedBox(width: VinkSpacing.md),
                    Icon(
                      Icons.schedule_rounded,
                      size: 16,
                      color: VinkColors.smoke,
                    ),
                    const SizedBox(width: 4),
                    Text(timeLabel, style: VinkTypography.bodySmallSecondary),
                  ],
                ],
              ),
              const SizedBox(height: VinkSpacing.md),
              Align(
                alignment: Alignment.centerLeft,
                child: VinkSecondaryButton(
                  label: actionLabel,
                  onPressed: () => context.push(destination),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _nextActionLabel(String state) => switch (state) {
  'DRAFT' => 'Finish setup',
  'OPEN' => 'View & share',
  'SUBMISSIONS_CLOSED' || 'PROCESSING_GRACE' => 'View progress',
  'FUNDED' || 'CARD_PROVISIONING' => 'View progress',
  'CARD_READY' => 'Pay now',
  'FUNDING_REVERSAL' ||
  'RECOVERY_REQUIRED' ||
  'RECOVERY_PENDING' => 'Needs attention',
  'PURCHASE_AUTHORIZED' || 'SETTLING' => 'View progress',
  _ => 'View Vink',
};

String? _timeRemainingLabel(DateTime? deadline) {
  if (deadline == null) return null;
  final diff = deadline.difference(DateTime.now());
  if (diff.isNegative) return 'Past deadline';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m left';
  if (diff.inHours < 24) return '${diff.inHours}h left';
  return '${diff.inDays}d left';
}

class _RecentActivityPreview extends ConsumerWidget {
  const _RecentActivityPreview();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activityAsync = ref.watch(recentActivityProvider);

    return activityAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: VinkSpacing.md),
        child: VinkLoadingState(),
      ),
      error: (_, _) => Text(
        'Recent activity isn\'t available right now.',
        style: VinkTypography.bodySmallSecondary,
      ),
      data: (entries) {
        if (entries.isEmpty) {
          return Text(
            'Nothing to show yet — activity from your Vinks will appear here.',
            style: VinkTypography.bodySmallSecondary,
          );
        }
        final preview = entries.take(3).toList();
        return Column(
          children: [
            for (final item in preview) ...[
              VinkSurfaceCard(
                padding: const EdgeInsets.symmetric(
                  horizontal: VinkSpacing.md,
                  vertical: VinkSpacing.sm + 4,
                ),
                child: Text(
                  activityCopy(item.entry, vinkTitle: item.vinkTitle),
                  style: VinkTypography.body,
                ),
              ),
              const SizedBox(height: VinkSpacing.sm),
            ],
          ],
        );
      },
    );
  }
}
