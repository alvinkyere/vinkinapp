import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/analytics/analytics.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/config/feature_flags.dart';
import '../../design_system/components/vink_app_bar.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../../core/errors/human_errors.dart';
import '../../core/errors/api_exception.dart';
import '../create_vink/purchase_category.dart';
import 'activity_copy.dart';
import 'activity_providers.dart';

/// Concept-image Activity filters the already-fetched outcome list client-side (no new
/// backend query) — `all` matches the flag-off list's own unfiltered behavior exactly.
enum _OutcomeFilter { all, completed, cancelled, expired }

extension on _OutcomeFilter {
  String get label => switch (this) {
    _OutcomeFilter.all => 'All',
    _OutcomeFilter.completed => 'Completed',
    _OutcomeFilter.cancelled => 'Cancelled',
    _OutcomeFilter.expired => 'Expired',
  };

  bool matches(String outcomeLabel) =>
      this == _OutcomeFilter.all || outcomeLabel == name;
}

class ActivityScreen extends ConsumerStatefulWidget {
  const ActivityScreen({
    super.key,
    this.homeActivityV2 = FeatureFlags.homeActivityV2,
  });

  /// Slice I6 — gates the outcome-summary list (one row per terminal Vink, tappable into Vink
  /// Details) as one unit with Home's own redesign. See `HomeScreen.homeActivityV2`'s own doc
  /// comment for the exact override/default relationship.
  final bool homeActivityV2;

  @override
  ConsumerState<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends ConsumerState<ActivityScreen> {
  _OutcomeFilter _filter = _OutcomeFilter.all;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VinkColors.paper,
      appBar: VinkAppBar(
        title: 'Activity',
        // Concept-image filter icon — real, not decorative: opens a sheet that filters the
        // already-fetched outcome list client-side. Only meaningful for the outcome list;
        // the flag-off flat event feed below has no outcome to filter by.
        actions: widget.homeActivityV2
            ? [
                IconButton(
                  icon: const Icon(Icons.tune_rounded, color: VinkColors.ink),
                  tooltip: 'Filter',
                  onPressed: () async {
                    final selected = await showModalBottomSheet<_OutcomeFilter>(
                      context: context,
                      backgroundColor: VinkColors.paper,
                      shape: const RoundedRectangleBorder(
                        borderRadius: BorderRadius.vertical(
                          top: Radius.circular(24),
                        ),
                      ),
                      builder: (sheetContext) => SafeArea(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const SizedBox(height: VinkSpacing.md),
                            for (final option in _OutcomeFilter.values)
                              ListTile(
                                title: Text(option.label),
                                trailing: option == _filter
                                    ? const Icon(
                                        Icons.check_rounded,
                                        color: VinkColors.blue,
                                      )
                                    : null,
                                onTap: () =>
                                    Navigator.of(sheetContext).pop(option),
                              ),
                          ],
                        ),
                      ),
                    );
                    if (selected != null && mounted) {
                      setState(() => _filter = selected);
                    }
                  },
                ),
              ]
            : null,
      ),
      body: SafeArea(
        child: widget.homeActivityV2
            ? _ActivityOutcomeList(filter: _filter)
            : const _ActivityEventList(),
      ),
    );
  }
}

/// Slice I6 (Phase 3 §4, Phase 4 §10, D29) — one row per terminal Vink, tappable into Vink
/// Details. Replaces the flat per-event list for the flag-on experience only; [_ActivityEventList]
/// below stays byte-for-byte unchanged for rollback.
class _ActivityOutcomeList extends ConsumerWidget {
  const _ActivityOutcomeList({required this.filter});

  final _OutcomeFilter filter;

  Analytics _analytics(WidgetRef ref) => ref.read(analyticsProvider);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final outcomesAsync = ref.watch(vinkOutcomesProvider);

    return RefreshIndicator(
      color: VinkColors.blue,
      onRefresh: () => ref.refresh(vinkOutcomesProvider.future),
      child: outcomesAsync.when(
        loading: () =>
            const VinkLoadingState(message: 'Gathering your Vink history…'),
        error: (error, _) => ListView(
          padding: const EdgeInsets.all(VinkSpacing.lg),
          children: [
            VinkInlineError(
              message: error is ApiException
                  ? humanErrorMessage(error)
                  : "Couldn't load activity.",
            ),
            const SizedBox(height: VinkSpacing.md),
            VinkSecondaryButton(
              label: 'Try again',
              onPressed: () => ref.invalidate(vinkOutcomesProvider),
            ),
          ],
        ),
        data: (result) {
          final outcomes = result.summaries
              .where((item) => filter.matches(item.outcomeLabel))
              .toList();
          if (result.summaries.isEmpty && result.failedCount == 0) {
            return ListView(
              children: [
                VinkEmptyState(
                  title: 'Nothing here yet',
                  message:
                      'Once a Vink you\'re part of wraps up — completed, cancelled, expired — it\'ll show up here.',
                  action: VinkPrimaryButton(
                    label: 'Start a Vink',
                    onPressed: () => context.go('/home'),
                  ),
                ),
              ],
            );
          }
          // Slice I6 (owner-directed partial-failure resilience): a failed row is skipped, not
          // hidden — everything that DID load still renders, with an honest note above it
          // rather than either a silent gap or a full-screen error over one bad fetch.
          final banner = result.failedCount > 0
              ? Padding(
                  padding: const EdgeInsets.only(bottom: VinkSpacing.sm),
                  child: VinkInlineError(
                    message: result.failedCount == 1
                        ? "One Vink couldn't load right now."
                        : '${result.failedCount} Vinks couldn\'t load right now.',
                  ),
                )
              : null;
          if (outcomes.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(VinkSpacing.lg),
              children: [
                ?banner,
                if (filter != _OutcomeFilter.all)
                  Text(
                    'No ${filter.label.toLowerCase()} activity yet.',
                    style: VinkTypography.bodySecondary,
                  ),
              ],
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(VinkSpacing.lg),
            // Concept-image "Recent" section label above the list, once, not per-row.
            itemCount: outcomes.length + (banner != null ? 1 : 0) + 1,
            separatorBuilder: (_, index) => index == 0
                ? const SizedBox(height: VinkSpacing.sm)
                : const SizedBox(height: VinkSpacing.md),
            itemBuilder: (context, index) {
              if (index == 0) {
                return Text('Recent', style: VinkTypography.cardTitle);
              }
              index -= 1;
              if (banner != null) {
                if (index == 0) return banner;
                index -= 1;
              }
              final item = outcomes[index];
              return Semantics(
                button: true,
                label:
                    '${item.vinkTitle}, ${outcomeLabelCopy(item.outcomeLabel)}, '
                    '${_shortDate(item.date)}, ${MoneyText.format(item.amountMinor)}',
                child: InkWell(
                  borderRadius: BorderRadius.circular(20),
                  onTap: () {
                    _analytics(
                      ref,
                    ).track('activity_row_opened', const {}, item.vinkId);
                    context.push('/activity/${item.vinkId}');
                  },
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: VinkColors.blue.withValues(alpha: 0.1),
                        ),
                        child: Icon(
                          purchaseCategoryIcon(item.purchaseCategory),
                          size: 20,
                          color: VinkColors.blue,
                        ),
                      ),
                      const SizedBox(width: VinkSpacing.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(item.vinkTitle, style: VinkTypography.body),
                            Text(
                              outcomeLabelCopy(item.outcomeLabel),
                              style: VinkTypography.bodySmallSecondary,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: VinkSpacing.sm),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            MoneyText.format(item.amountMinor),
                            style: VinkTypography.bodySmall.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            _shortDate(item.date),
                            style: VinkTypography.bodySmallSecondary,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _ActivityEventList extends ConsumerWidget {
  const _ActivityEventList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activityAsync = ref.watch(recentActivityProvider);

    return RefreshIndicator(
      color: VinkColors.blue,
      onRefresh: () => ref.refresh(recentActivityProvider.future),
      child: activityAsync.when(
        loading: () =>
            const VinkLoadingState(message: 'Gathering recent activity…'),
        error: (error, _) => ListView(
          padding: const EdgeInsets.all(VinkSpacing.lg),
          children: [
            VinkInlineError(
              message: error is ApiException
                  ? humanErrorMessage(error)
                  : "Couldn't load activity.",
            ),
            const SizedBox(height: VinkSpacing.md),
            VinkSecondaryButton(
              label: 'Try again',
              onPressed: () => ref.invalidate(recentActivityProvider),
            ),
          ],
        ),
        data: (result) {
          final entries = result.entries;
          if (entries.isEmpty && result.failedCount == 0) {
            return ListView(
              children: [
                VinkEmptyState(
                  title: 'Nothing here yet',
                  message:
                      'Once a Vink you\'re part of starts moving — joins, payments, completion — it\'ll show up here.',
                  action: VinkPrimaryButton(
                    label: 'Start a Vink',
                    onPressed: () => context.go('/home'),
                  ),
                ),
              ],
            );
          }
          final banner = result.failedCount > 0
              ? Padding(
                  padding: const EdgeInsets.only(bottom: VinkSpacing.sm),
                  child: VinkInlineError(
                    message: result.failedCount == 1
                        ? "One Vink couldn't load right now."
                        : '${result.failedCount} Vinks couldn\'t load right now.',
                  ),
                )
              : null;
          if (entries.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(VinkSpacing.lg),
              children: [?banner],
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(VinkSpacing.lg),
            itemCount: entries.length + (banner != null ? 1 : 0),
            separatorBuilder: (_, _) => const SizedBox(height: VinkSpacing.sm),
            itemBuilder: (context, index) {
              if (banner != null) {
                if (index == 0) return banner;
                index -= 1;
              }
              final item = entries[index];
              return VinkSurfaceCard(
                padding: const EdgeInsets.symmetric(
                  horizontal: VinkSpacing.md,
                  vertical: VinkSpacing.sm + 4,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        activityCopy(
                          item.entry,
                          vinkTitle: item.vinkTitle,
                          isOrganizerViewer: item.isOrganizerRole,
                        ),
                        style: VinkTypography.body,
                      ),
                    ),
                    const SizedBox(width: VinkSpacing.sm),
                    Text(
                      _relativeTime(item.entry.at),
                      style: VinkTypography.bodySmallSecondary,
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}

String _relativeTime(DateTime at) {
  final diff = DateTime.now().difference(at);
  if (diff.inMinutes < 1) return 'now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inHours < 24) return '${diff.inHours}h';
  return '${diff.inDays}d';
}

const _monthAbbrev = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// Concept-image Activity list shows a calendar date ("Jul 4"), not a relative-time string —
/// a historical outcome list reads better as "when it happened" than "how long ago."
String _shortDate(DateTime at) => '${_monthAbbrev[at.month - 1]} ${at.day}';
