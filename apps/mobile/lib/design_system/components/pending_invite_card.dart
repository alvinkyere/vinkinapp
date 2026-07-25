import 'package:flutter/material.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';
import 'money_text.dart';
import 'vink_buttons.dart';
import 'vink_surface_card.dart';

/// Invites feature (D44) — Home's own "You're invited to…" card. Deliberately takes plain
/// primitives, not the feature-layer `PendingInvite` model, matching every other design_system
/// component's own decoupling from `core/models`/`features` (e.g. [VinkAvatar] takes a bare
/// `name`, not a `Participant`).
///
/// [onNotNow] is dismiss-only (a per-session Home preference, never a server call) — the real
/// Decline lives on the Invites tab, reached via [onView]. Two distinct verbs, two distinct
/// actions, matching the mockup's own framing.
class PendingInviteCard extends StatelessWidget {
  const PendingInviteCard({
    super.key,
    required this.title,
    required this.organizerDisplayName,
    required this.assignedShareMinor,
    required this.onView,
    required this.onNotNow,
  });

  final String title;
  final String organizerDisplayName;
  final int assignedShareMinor;
  final VoidCallback onView;
  final VoidCallback onNotNow;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label:
          "You're invited to $title by $organizerDisplayName, your share "
          '${MoneyText.format(assignedShareMinor)}',
      child: VinkSurfaceCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("You're invited to $title", style: VinkTypography.cardTitle),
            const SizedBox(height: 2),
            Text(
              'by $organizerDisplayName · ${MoneyText.format(assignedShareMinor)} your share',
              style: VinkTypography.bodySmallSecondary,
            ),
            const SizedBox(height: VinkSpacing.md),
            Row(
              children: [
                Expanded(
                  child: VinkTextButton(label: 'Not now', onPressed: onNotNow),
                ),
                const SizedBox(width: VinkSpacing.sm),
                Expanded(
                  child: VinkSecondaryButton(label: 'View', onPressed: onView),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
