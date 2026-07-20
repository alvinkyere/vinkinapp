import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../design_system/components/vink_app_bar.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../../core/errors/human_errors.dart';
import '../../core/errors/api_exception.dart';
import 'activity_copy.dart';
import 'activity_providers.dart';

class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activityAsync = ref.watch(recentActivityProvider);

    return Scaffold(
      backgroundColor: VinkColors.paper,
      appBar: const VinkAppBar(title: 'Activity'),
      body: SafeArea(
        child: RefreshIndicator(
          color: VinkColors.blue,
          onRefresh: () => ref.refresh(recentActivityProvider.future),
          child: activityAsync.when(
            loading: () => const VinkLoadingState(message: 'Gathering recent activity…'),
            error: (error, _) => ListView(
              padding: const EdgeInsets.all(VinkSpacing.lg),
              children: [
                VinkInlineError(
                  message: error is ApiException ? humanErrorMessage(error) : "Couldn't load activity.",
                ),
                const SizedBox(height: VinkSpacing.md),
                VinkSecondaryButton(label: 'Try again', onPressed: () => ref.invalidate(recentActivityProvider)),
              ],
            ),
            data: (entries) {
              if (entries.isEmpty) {
                return ListView(
                  children: [
                    VinkEmptyState(
                      title: 'Nothing here yet',
                      message: 'Once a Vink you\'re part of starts moving — joins, payments, completion — it\'ll show up here.',
                      action: VinkPrimaryButton(label: 'Start a Vink', onPressed: () => context.go('/home')),
                    ),
                  ],
                );
              }
              return ListView.separated(
                padding: const EdgeInsets.all(VinkSpacing.lg),
                itemCount: entries.length,
                separatorBuilder: (_, _) => const SizedBox(height: VinkSpacing.sm),
                itemBuilder: (context, index) {
                  final item = entries[index];
                  return VinkSurfaceCard(
                    padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.md, vertical: VinkSpacing.sm + 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            activityCopy(item.entry, vinkTitle: item.vinkTitle),
                            style: VinkTypography.body,
                          ),
                        ),
                        const SizedBox(width: VinkSpacing.sm),
                        Text(_relativeTime(item.entry.at), style: VinkTypography.bodySmallSecondary),
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
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
