import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/config/feature_flags.dart';
import '../design_system/vink_colors.dart';
import '../design_system/vink_typography.dart';

/// The tab structure the design correction calls for — no backend terminology anywhere in
/// navigation, just Home / Activity / (Invites) / Profile.
///
/// Invites feature (D44): a 4th tab, gated by [invitesEnabled] (defaults to the real
/// `FeatureFlags.invitesEnabled`, overridable for tests exactly like [router.dart]'s own
/// `homeActivityV2`/`canonicalCreateFlow` params) — this widget and `router.dart`'s branch
/// list must agree on the same flag value, since branch *count* itself changes, not just a
/// visual toggle.
class VinkNavShell extends StatelessWidget {
  const VinkNavShell({
    super.key,
    required this.navigationShell,
    this.invitesEnabled = FeatureFlags.invitesEnabled,
  });

  final StatefulNavigationShell navigationShell;
  final bool invitesEnabled;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          color: VinkColors.paper,
          border: const Border(top: BorderSide(color: VinkColors.line)),
        ),
        child: SafeArea(
          child: SizedBox(
            height: 68,
            child: Row(
              children: [
                _NavItem(
                  icon: Icons.home_outlined,
                  activeIcon: Icons.home_rounded,
                  label: 'Home',
                  selected: navigationShell.currentIndex == 0,
                  onTap: () => navigationShell.goBranch(0),
                ),
                _NavItem(
                  icon: Icons.receipt_long_outlined,
                  activeIcon: Icons.receipt_long_rounded,
                  label: 'Activity',
                  selected: navigationShell.currentIndex == 1,
                  onTap: () => navigationShell.goBranch(1),
                ),
                if (invitesEnabled)
                  _NavItem(
                    icon: Icons.mail_outline_rounded,
                    activeIcon: Icons.mail_rounded,
                    label: 'Invites',
                    selected: navigationShell.currentIndex == 2,
                    onTap: () => navigationShell.goBranch(2),
                  ),
                _NavItem(
                  icon: Icons.person_outline_rounded,
                  activeIcon: Icons.person_rounded,
                  label: 'Me',
                  selected:
                      navigationShell.currentIndex == (invitesEnabled ? 3 : 2),
                  onTap: () => navigationShell.goBranch(invitesEnabled ? 3 : 2),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? VinkColors.blue : VinkColors.smoke;
    return Expanded(
      child: Semantics(
        button: true,
        selected: selected,
        label: label,
        child: InkWell(
          onTap: onTap,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(selected ? activeIcon : icon, color: color, size: 23),
              const SizedBox(height: 3),
              Text(
                label,
                style: VinkTypography.bodySmall.copyWith(
                  color: color,
                  fontSize: 11,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
