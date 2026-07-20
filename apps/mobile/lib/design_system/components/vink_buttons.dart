import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_radius.dart';
import '../vink_shadows.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

/// Every button on vinkin.org is `rounded-full` with an uppercase, bold, wide-tracked
/// `font-display` label — never sentence case, never the body font. `minHeight: 48`
/// clears the 44×44pt minimum touch target with room for label ascenders/descenders.
const double _minButtonHeight = 48;

/// `bg-blue text-white`, hover → `bg-blue-deep`; the site's large `px-9 py-4` padding.
/// The one dominant action per screen (docs/design/vinkin-design-system.md "Buttons").
class VinkPrimaryButton extends StatelessWidget {
  const VinkPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.semanticLabel,
    this.glow = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final String? semanticLabel;

  /// The site's blue CTA glow shadow — reserve for the single most important action on a
  /// screen (e.g. "Open Vink"), not every primary button, or it stops meaning anything.
  final bool glow;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    return Semantics(
      button: true,
      enabled: !disabled,
      label: semanticLabel ?? label,
      child: DecoratedBox(
        decoration: BoxDecoration(
          boxShadow: glow && !disabled ? VinkShadows.ctaGlow : null,
        ),
        child: Material(
          color: disabled ? VinkColors.ink.withValues(alpha: 0.15) : VinkColors.blue,
          borderRadius: BorderRadius.circular(VinkRadius.pill),
          child: InkWell(
            onTap: disabled ? null : onPressed,
            borderRadius: BorderRadius.circular(VinkRadius.pill),
            splashColor: VinkColors.blueDeep.withValues(alpha: 0.3),
            highlightColor: VinkColors.blueDeep.withValues(alpha: 0.2),
            child: Container(
              constraints: const BoxConstraints(minHeight: _minButtonHeight),
              padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.xl, vertical: VinkSpacing.md),
              alignment: Alignment.center,
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.5, color: VinkColors.white),
                    )
                  : Text(
                      label.toUpperCase(),
                      style: VinkTypography.buttonLabel.copyWith(color: VinkColors.white),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// `bg-paper text-ink` — a quieter action, e.g. beside a primary button.
class VinkSecondaryButton extends StatelessWidget {
  const VinkSecondaryButton({super.key, required this.label, required this.onPressed, this.loading = false, this.semanticLabel});

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    return Semantics(
      button: true,
      enabled: !disabled,
      label: semanticLabel ?? label,
      child: Material(
        color: VinkColors.white,
        borderRadius: BorderRadius.circular(VinkRadius.pill),
        child: InkWell(
          onTap: disabled ? null : onPressed,
          borderRadius: BorderRadius.circular(VinkRadius.pill),
          child: Container(
            constraints: const BoxConstraints(minHeight: _minButtonHeight),
            padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.lg, vertical: VinkSpacing.sm + 2),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(VinkRadius.pill),
              border: Border.all(color: VinkColors.ink.withValues(alpha: 0.15)),
            ),
            child: loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: VinkColors.ink),
                  )
                : Text(
                    label.toUpperCase(),
                    style: VinkTypography.buttonLabel.copyWith(
                      color: disabled ? VinkColors.smoke : VinkColors.ink,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

/// A destructive variant of the outline button (cancel a Vink) — the one place this app
/// needs a color the site itself never shows (see VinkColors.danger's doc comment).
class VinkDestructiveButton extends StatelessWidget {
  const VinkDestructiveButton({super.key, required this.label, required this.onPressed, this.loading = false, this.semanticLabel});

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    return Semantics(
      button: true,
      enabled: !disabled,
      label: semanticLabel ?? label,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(VinkRadius.pill),
        child: InkWell(
          onTap: disabled ? null : onPressed,
          borderRadius: BorderRadius.circular(VinkRadius.pill),
          child: Container(
            constraints: const BoxConstraints(minHeight: _minButtonHeight),
            padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.lg, vertical: VinkSpacing.sm + 2),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(VinkRadius.pill),
              border: Border.all(color: VinkColors.danger.withValues(alpha: disabled ? 0.3 : 0.6)),
            ),
            child: loading
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: VinkColors.danger.withValues(alpha: 0.6)),
                  )
                : Text(
                    label.toUpperCase(),
                    style: VinkTypography.buttonLabel.copyWith(
                      color: disabled ? VinkColors.danger.withValues(alpha: 0.4) : VinkColors.danger,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

/// A plain text action — "Try another username", "Edit", "Sign out". Body font (not
/// display), since these are quiet, secondary actions, not brand-voice CTAs.
class VinkTextButton extends StatelessWidget {
  const VinkTextButton({super.key, required this.label, required this.onPressed, this.color = VinkColors.blue});

  final String label;
  final VoidCallback? onPressed;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null;
    return Semantics(
      button: true,
      enabled: !disabled,
      label: label,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(VinkRadius.lg),
        child: Container(
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.sm, vertical: VinkSpacing.sm),
          alignment: Alignment.center,
          child: Text(
            label,
            style: VinkTypography.label.copyWith(color: disabled ? VinkColors.smoke : color),
          ),
        ),
      ),
    );
  }
}
