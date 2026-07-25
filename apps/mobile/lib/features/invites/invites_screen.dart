import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/commands/command_state.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/human_errors.dart';
import '../../core/models/pending_invite.dart';
import '../../core/repositories/vink_repository.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/vink_app_bar.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../create_vink/purchase_category.dart';
import '../home/home_providers.dart';
import 'invites_providers.dart';

/// Invites feature (D44) — the 4th tab. A real accept/decline gate, not a passive list:
/// each row's own Accept/Decline is the actual `INVITED -> JOINED`/`INVITED -> REMOVED`
/// transition (`acceptInviteCommand`/`declineInviteCommand`), not the Home card's dismiss-
/// only "Not now".
class InvitesScreen extends ConsumerWidget {
  const InvitesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invitesAsync = ref.watch(invitesProvider);

    return Scaffold(
      appBar: const VinkAppBar(title: 'Invites'),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => ref.refresh(invitesProvider.future),
          child: invitesAsync.when(
            loading: () =>
                const VinkLoadingState(message: 'Loading your invites…'),
            error: (error, _) => ListView(
              padding: const EdgeInsets.all(VinkSpacing.lg),
              children: [
                VinkInlineError(
                  message: error is ApiException
                      ? humanErrorMessage(error)
                      : "Couldn't load invites.",
                ),
                const SizedBox(height: VinkSpacing.md),
                VinkSecondaryButton(
                  label: 'Try again',
                  onPressed: () => ref.invalidate(invitesProvider),
                ),
              ],
            ),
            data: (invites) {
              if (invites.isEmpty) {
                return ListView(
                  children: [
                    const VinkEmptyState(
                      title: 'No pending invites',
                      message:
                          "When someone adds you to a Vink, it'll show up here.",
                      action: SizedBox.shrink(),
                    ),
                  ],
                );
              }
              return ListView.separated(
                padding: const EdgeInsets.all(VinkSpacing.lg),
                itemCount: invites.length,
                separatorBuilder: (_, _) =>
                    const SizedBox(height: VinkSpacing.md),
                itemBuilder: (context, index) =>
                    _PendingInviteRow(invite: invites[index]),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _PendingInviteRow extends ConsumerStatefulWidget {
  const _PendingInviteRow({required this.invite});

  final PendingInvite invite;

  @override
  ConsumerState<_PendingInviteRow> createState() => _PendingInviteRowState();
}

class _PendingInviteRowState extends ConsumerState<_PendingInviteRow> {
  void _guardedSetState(void Function() fn) {
    if (mounted) setState(fn);
  }

  late final _acceptCommand = CommandRunner<void>(_guardedSetState, ref);
  late final _declineCommand = CommandRunner<void>(_guardedSetState, ref);

  @override
  Widget build(BuildContext context) {
    final invite = widget.invite;
    final title =
        invite.purpose ?? purchaseCategoryLabel(invite.purchaseCategory);
    final busy =
        _acceptCommand.state.isInProgress || _declineCommand.state.isInProgress;

    return VinkSurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: VinkTypography.cardTitle),
          const SizedBox(height: 2),
          Text(
            'Organized by ${invite.organizerDisplayName}',
            style: VinkTypography.bodySmallSecondary,
          ),
          const SizedBox(height: VinkSpacing.sm),
          Text('Your share', style: VinkTypography.bodySmallSecondary),
          MoneyText(
            invite.assignedShareMinor,
            style: VinkTypography.amountMedium,
          ),
          if (_acceptCommand.state case CommandFailure(:final failure)) ...[
            const SizedBox(height: VinkSpacing.sm),
            VinkInlineError(message: failure.message),
          ],
          if (_declineCommand.state case CommandFailure(:final failure)) ...[
            const SizedBox(height: VinkSpacing.sm),
            VinkInlineError(message: failure.message),
          ],
          const SizedBox(height: VinkSpacing.md),
          Row(
            children: [
              Expanded(
                child: VinkSecondaryButton(
                  label: 'Decline',
                  loading: _declineCommand.state.isInProgress,
                  onPressed: busy
                      ? null
                      : () => _declineCommand.run(
                          () => ref
                              .read(vinkRepositoryProvider)
                              .declineInvite(invite.vinkId),
                          onSuccess: (_) async =>
                              ref.invalidate(invitesProvider),
                        ),
                ),
              ),
              const SizedBox(width: VinkSpacing.sm),
              Expanded(
                child: VinkPrimaryButton(
                  label: 'Accept',
                  loading: _acceptCommand.state.isInProgress,
                  onPressed: busy
                      ? null
                      : () => _acceptCommand.run(
                          () => ref
                              .read(vinkRepositoryProvider)
                              .acceptInvite(invite.vinkId),
                          onSuccess: (_) async {
                            ref.invalidate(invitesProvider);
                            ref.invalidate(myVinksProvider);
                            ref.invalidate(activeVinksProvider);
                          },
                        ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
