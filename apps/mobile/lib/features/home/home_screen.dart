import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/config/feature_flags.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/human_errors.dart';
import '../../design_system/components/vink_avatar.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_logo.dart';
import '../../design_system/components/vink_progress_indicator.dart';
import '../../design_system/components/vink_progress_vessel.dart';
import '../../design_system/components/vink_status_badge.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../../design_system/components/pending_invite_card.dart';
import '../activity/activity_copy.dart';
import '../activity/activity_providers.dart';
import '../create_vink/purchase_category.dart';
import '../invites/invites_providers.dart';
import 'home_providers.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({
    super.key,
    this.homeActivityV2 = FeatureFlags.homeActivityV2,
    this.invitesEnabled = FeatureFlags.invitesEnabled,
    this.inkProgressVessel = FeatureFlags.inkProgressVessel,
  });

  /// Slice I6 — gates Home's two-section redesign as one unit. Defaults to the real,
  /// `--dart-define`-driven flag so every existing call site (including every pre-I6 test
  /// that constructs `HomeScreen()` directly) is unaffected; `buildRouter`'s own
  /// `homeActivityV2` override threads a resolved value through explicitly.
  final bool homeActivityV2;

  /// Invites feature (D44) — gates the "You're invited to…" card section, independent of
  /// [homeActivityV2] (it applies to both the old and new Active-Vinks layout equally, since
  /// it's a wholly separate feature, not a variant of the I6 redesign).
  final bool invitesEnabled;

  /// I7 — gates the compact Ink Progress vessel on the (flag-on) active-Vink card, replacing
  /// `VinkProgressIndicator`. The flag-off `_ActiveVinkCard` is untouched, same rollback
  /// discipline as every other flagged pair in this file.
  final bool inkProgressVessel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: VinkColors.paper,
      body: SafeArea(
        child: RefreshIndicator(
          color: VinkColors.blue,
          onRefresh: () async {
            ref.invalidate(myVinksProvider);
            ref.invalidate(activeVinksProvider);
            if (!homeActivityV2) ref.invalidate(recentActivityProvider);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              VinkSpacing.lg,
              VinkSpacing.lg,
              VinkSpacing.lg,
              VinkSpacing.xxl,
            ),
            children: [
              // R0 (owner decision): the persistent "Everyone In. One Payment." tagline is
              // removed from signed-in Home, unconditionally — not gated behind
              // `homeActivityV2`, since keeping it on the old flow while removing it from the
              // new one would contradict the decision itself. Not replaced with a generic
              // greeting either ("Hi, $firstName" is also gone, not swapped for different
              // copy) — just a restrained identity mark and Profile access, matching Phase 8
              // §22's own Home composition, which never specified a greeting line at all.
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const VinkWordmark(fontSize: 28, showMark: false),
                  IconButton(
                    icon: const Icon(
                      Icons.person_outline_rounded,
                      color: VinkColors.ink,
                    ),
                    tooltip: 'Profile',
                    onPressed: () => context.go('/profile'),
                  ),
                ],
              ),
              const SizedBox(height: VinkSpacing.xl),
              if (invitesEnabled) const _PendingInvitesSection(),
              if (homeActivityV2) ...[
                _ActiveVinksSectionsV2(inkProgressVessel: inkProgressVessel),
                const SizedBox(height: VinkSpacing.lg),
                Align(
                  alignment: Alignment.center,
                  child: VinkTextButton(
                    label: 'See Activity',
                    onPressed: () => context.go('/activity'),
                  ),
                ),
              ] else ...[
                Text('Active Vinks', style: VinkTypography.cardTitle),
                const SizedBox(height: VinkSpacing.md),
                const _ActiveVinksSection(),
                const SizedBox(height: VinkSpacing.xl),
                VinkPrimaryButton(
                  label: 'Start a Vink',
                  leadingIcon: Icons.add_rounded,
                  onPressed: () => context.push('/create-vink'),
                ),
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
            ],
          ),
        ),
      ),
    );
  }
}

/// Invites feature (D44) — Home's own "You're invited to…" section, above whichever
/// Active-Vinks layout is currently showing. Renders nothing (not even an empty-state or
/// error banner — this is additive, discoverability-only content, not a primary Home
/// surface) when there's nothing to show or the fetch fails; the Invites tab remains the
/// authoritative place to see and act on every pending invite regardless.
class _PendingInvitesSection extends ConsumerWidget {
  const _PendingInvitesSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invitesAsync = ref.watch(invitesProvider);
    final dismissed = ref.watch(dismissedInviteIdsProvider);

    return invitesAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (invites) {
        final visible = invites
            .where((invite) => !dismissed.contains(invite.vinkId))
            .toList();
        if (visible.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final invite in visible) ...[
              PendingInviteCard(
                title:
                    invite.purpose ??
                    purchaseCategoryLabel(invite.purchaseCategory),
                organizerDisplayName: invite.organizerDisplayName,
                assignedShareMinor: invite.assignedShareMinor,
                onView: () => context.go('/invites'),
                onNotNow: () => ref
                    .read(dismissedInviteIdsProvider.notifier)
                    .update((state) => {...state, invite.vinkId}),
              ),
              const SizedBox(height: VinkSpacing.md),
            ],
            const SizedBox(height: VinkSpacing.lg),
          ],
        );
      },
    );
  }
}

/// Slice I6 (Phase 3 §1), restructured per the owner's design directive: a single swipeable
/// carousel under an "Active Vinks" header, needs-attention cards first (attention-bucket
/// ordering is preserved — only the two labeled section headings are gone, replaced by page
/// order + dot indicators). Phase 3 §1's own instruction not to duplicate Activity's feed here
/// is still honored by omitting any activity preview — see the "See Activity" link in
/// [HomeScreen] instead.
class _ActiveVinksSectionsV2 extends ConsumerWidget {
  const _ActiveVinksSectionsV2({required this.inkProgressVessel});

  final bool inkProgressVessel;

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
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              VinkSurfaceCard(
                child: const VinkEmptyState(
                  title: 'Nothing active right now',
                  message:
                      'Split a purchase with your group — everyone pays their share, you pay the merchant once.',
                  action: SizedBox.shrink(),
                ),
              ),
              const SizedBox(height: VinkSpacing.xl),
              VinkPrimaryButton(
                label: 'Start a Vink',
                leadingIcon: Icons.add_rounded,
                onPressed: () => context.push('/create-vink'),
              ),
            ],
          );
        }
        final ordered = [
          ...active.where(
            (item) => item.attentionBucket == AttentionBucket.needsAttention,
          ),
          ...active.where(
            (item) => item.attentionBucket == AttentionBucket.waitingOnOthers,
          ),
        ];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Active Vinks', style: VinkTypography.cardTitle),
            const SizedBox(height: VinkSpacing.md),
            _ActiveVinksCarousel(
              items: ordered,
              inkProgressVessel: inkProgressVessel,
            ),
          ],
        );
      },
    );
  }
}

/// One card per page, needs-attention items first (attention-bucket ordering carried over from
/// the old two-section layout — only the labeled headings were removed). Dots below the
/// carousel reflect the real page count/position; a single card renders with no dots at all
/// (nothing to page between).
class _ActiveVinksCarousel extends StatefulWidget {
  const _ActiveVinksCarousel({
    required this.items,
    required this.inkProgressVessel,
  });

  final List<ActiveVink> items;
  final bool inkProgressVessel;

  @override
  State<_ActiveVinksCarousel> createState() => _ActiveVinksCarouselState();
}

class _ActiveVinksCarouselState extends State<_ActiveVinksCarousel> {
  // Full-width pages — a 0.94 "peek next card" fraction was tried first, but it squeezed
  // the card's own internal width enough to wrap the title text against the status badge
  // (caught via a real-device screenshot); full width preserves the exact card width
  // already proven to render correctly in the old single-column list.
  late final PageController _controller = PageController();
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          height: 282,
          child: PageView.builder(
            controller: _controller,
            itemCount: widget.items.length,
            onPageChanged: (page) => setState(() => _page = page),
            // The page's own tight height (this SizedBox's 280) lets a shorter card's
            // content sit top-aligned with blank space below (Column's own default
            // alignment), rather than forcing every card variant to exactly fill it.
            itemBuilder: (context, index) => _ActiveVinkCardV2(
              item: widget.items[index],
              inkProgressVessel: widget.inkProgressVessel,
            ),
          ),
        ),
        if (widget.items.length > 1) ...[
          const SizedBox(height: VinkSpacing.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < widget.items.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == _page ? 18 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(3),
                    color: i == _page
                        ? VinkColors.blue
                        : VinkColors.ink.withValues(alpha: 0.15),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

/// Slice I6 — a parallel card to [_ActiveVinkCard], not a shared/parameterized version of it:
/// the old flow's card stays byte-for-byte untouched for rollback (same discipline every prior
/// flagged slice in this codebase has followed — the old and new UIs are two separate
/// implementations, never one merged with a branch inside it). The one real content
/// difference: the title prefers the real [Vink.purpose] (Slice I5B, D39) over the category
/// label, falling back identically to today's behavior when a Vink has none.
class _ActiveVinkCardV2 extends StatelessWidget {
  const _ActiveVinkCardV2({
    required this.item,
    required this.inkProgressVessel,
  });

  final ActiveVink item;
  final bool inkProgressVessel;

  @override
  Widget build(BuildContext context) {
    final vink = item.vink;
    // Slice I6 (owner correction): the server-projected `contributionProgress` (D20/D24) is
    // the one source of truth for this bar — never derived from `fundedAmountMinor`, which
    // keeps its own separate, all-at-once-at-full-resolution meaning.
    final progress = item.contributionProgress;
    final timeLabel = _timeRemainingLabel(vink.submissionDeadline);
    final actionLabel = _nextActionLabel(vink.state);
    final statusLabel = vinkStatusLabel(vink.state);
    final title = vink.purpose ?? purchaseCategoryLabel(vink.purchaseCategory);
    final roleLabel = vink.isOrganizerRole ? 'Organizer' : 'Participant';
    final destination = vink.state == 'DRAFT'
        ? '/create-vink/resume/${vink.id}'
        : vink.isOrganizerRole
        ? '/vinks/${vink.id}'
        : '/vinks/${vink.id}?role=participant';

    return Semantics(
      button: true,
      label:
          '$title, $roleLabel, ${MoneyText.format(progress.confirmedAmountMinor)} of ${MoneyText.format(progress.totalAmountMinor)} confirmed, '
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
                  // Slice 3 (Home visual polish) — a plain category icon in a tinted circle,
                  // cosmetic only (same "wire value is still the raw enum" discipline as
                  // `purchaseCategoryLabel`), no new decision about what the icon means.
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: VinkColors.blue.withValues(alpha: 0.1),
                    ),
                    child: Icon(
                      purchaseCategoryIcon(vink.purchaseCategory),
                      size: 20,
                      color: VinkColors.blue,
                    ),
                  ),
                  const SizedBox(width: VinkSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: VinkTypography.cardTitle),
                        // Slice I6: distinguishes organized from participated Vinks "where
                        // useful" (owner instruction) — plain text, not a colored pill, per
                        // this slice's own "avoid excessive status pills" visual direction.
                        Text(
                          roleLabel,
                          style: VinkTypography.bodySmallSecondary,
                        ),
                      ],
                    ),
                  ),
                  if (vink.state != 'OPEN') VinkStatusBadge(state: vink.state),
                ],
              ),
              const SizedBox(height: VinkSpacing.md),
              // Headline restored on the compact card: "the compact variant never shows
              // text" was this component's original rule under the calm-bar interpretation;
              // the owner's design directive supersedes it in favor of matching the
              // reference design's own Home card, which always shows the amount headline.
              if (inkProgressVessel)
                RichText(
                  text: TextSpan(
                    style: VinkTypography.body,
                    children: [
                      TextSpan(
                        text: MoneyText.format(progress.confirmedAmountMinor),
                        style: const TextStyle(
                          color: VinkColors.blue,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      TextSpan(
                        text:
                            ' of ${MoneyText.format(progress.totalAmountMinor)} ready',
                        style: const TextStyle(color: VinkColors.ink),
                      ),
                    ],
                  ),
                ),
              if (inkProgressVessel) const SizedBox(height: VinkSpacing.sm),
              if (inkProgressVessel)
                VinkProgressVessel(
                  confirmedAmountMinor: progress.confirmedAmountMinor,
                  totalAmountMinor: progress.totalAmountMinor,
                  compact: true,
                )
              else
                VinkProgressIndicator(
                  fundedAmountLabel: MoneyText.format(
                    progress.confirmedAmountMinor,
                  ),
                  requiredAmountLabel: MoneyText.format(
                    progress.totalAmountMinor,
                  ),
                  progress: progress.fraction,
                ),
              const SizedBox(height: VinkSpacing.sm),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: VinkSpacing.md,
                runSpacing: VinkSpacing.xs,
                children: [
                  // Slice 3 (Home visual polish) — real initials circles for an organizer-
                  // role card (their own already-visible participant list); the plain icon +
                  // count for a participant-role card, since `participantNames` is
                  // deliberately empty there (D24/D25 — no other participant's identity to
                  // show safely).
                  if (item.participantNames.isNotEmpty)
                    _ParticipantAvatarStack(names: item.participantNames)
                  else
                    Icon(
                      Icons.people_outline_rounded,
                      size: 16,
                      color: VinkColors.smoke,
                    ),
                  const SizedBox(width: 6),
                  Text(
                    // Contribution-progress-sourced count (D20/D24), not the raw roster
                    // size — matches what the vessel/headline above are already reporting.
                    '${progress.confirmedParticipantCount} of ${progress.totalParticipantCount} people are in',
                    style: VinkTypography.bodySmallSecondary,
                  ),
                  if (timeLabel != null) ...[
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
                alignment: Alignment.centerRight,
                child: VinkTextButton(
                  label: '$actionLabel →',
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

/// Slice 3 (Home visual polish) — up to 3 real initials circles, overlapping, plus a "+N"
/// overflow chip for the rest. Reuses the existing [VinkAvatar] component (already used on
/// Create Vink, Lobby, and Profile) — no new avatar rendering logic invented.
class _ParticipantAvatarStack extends StatelessWidget {
  const _ParticipantAvatarStack({required this.names});

  final List<String> names;

  @override
  Widget build(BuildContext context) {
    // Sized and spaced to stay legible at small scale — the first attempt at this (20px
    // circles, 60% overlap, a 1px ring) rendered as illegible overlapping mush on a real
    // device; this is deliberately bigger with a real separation ring between circles.
    const size = 26.0;
    const overlap = 16.0;
    final shown = names.take(3).toList();
    final overflow = names.length - shown.length;
    return SizedBox(
      height: size,
      width: size + (shown.length - 1) * overlap + (overflow > 0 ? overlap : 0),
      child: Stack(
        children: [
          for (var i = 0; i < shown.length; i++)
            Positioned(
              left: i * overlap,
              child: DecoratedBox(
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: VinkColors.paper,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(2),
                  child: VinkAvatar(
                    name: shown[i],
                    size: size - 4,
                    filled: true,
                  ),
                ),
              ),
            ),
          if (overflow > 0)
            Positioned(
              left: shown.length * overlap,
              child: DecoratedBox(
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: VinkColors.paper,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(2),
                  child: CircleAvatar(
                    radius: (size - 4) / 2,
                    backgroundColor: VinkColors.ink.withValues(alpha: 0.08),
                    child: Text(
                      '+$overflow',
                      style: VinkTypography.bodySmall.copyWith(
                        fontSize: 10,
                        color: VinkColors.ink,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
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
      data: (result) {
        if (result.entries.isEmpty) {
          return Text(
            'Nothing to show yet — activity from your Vinks will appear here.',
            style: VinkTypography.bodySmallSecondary,
          );
        }
        final preview = result.entries.take(3).toList();
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
