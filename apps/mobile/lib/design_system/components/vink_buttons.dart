import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_radius.dart';
import '../vink_shadows.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

/// Owner design directive (2026-07-24, concept-image visual spec): buttons are a rounded
/// rectangle (`VinkRadius.xxl`, 16px), sentence-case label — superseding vinkin.org's own
/// site CSS (`rounded-full`, uppercase), which this component originally replicated exactly.
/// The site's real blue/paper/ink color tokens are unchanged; only shape and case converge
/// to the concept. `minHeight: 48` clears the 44×44pt minimum touch target with room for
/// label ascenders/descenders.
const double _minButtonHeight = 52;
const double _buttonRadius = 999;

/// Swaps a button's label for a loading spinner without the button visibly resizing
/// (docs/design/phase-9-motion-system.md §2/§7, docs/design/phase-10-implementation-readiness.md
/// I0): both the label and the spinner are always laid out — only their opacity toggles —
/// so the Stack's intrinsic width is always the label's width (the spinner is smaller), and
/// switching `loading` never changes the button's footprint.
class _ButtonContent extends StatelessWidget {
  const _ButtonContent({
    required this.label,
    required this.loading,
    required this.spinnerColor,
    required this.textStyle,
    this.spinnerSize = 20,
    this.leadingIcon,
    this.trailingIcon,
  });

  final String label;
  final bool loading;
  final Color spinnerColor;
  final TextStyle textStyle;
  final double spinnerSize;

  /// Concept-image buttons carry a small directional/action icon ("+ Start a Vink",
  /// "Continue →") — opt-in per call site, default none, so every existing button is
  /// unaffected until a screen is deliberately converged.
  final IconData? leadingIcon;
  final IconData? trailingIcon;

  @override
  Widget build(BuildContext context) {
    final labelText = Text(label, style: textStyle);
    final content = (leadingIcon == null && trailingIcon == null)
        ? labelText
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (leadingIcon != null) ...[
                Icon(leadingIcon, size: 18, color: textStyle.color),
                const SizedBox(width: 6),
              ],
              labelText,
              if (trailingIcon != null) ...[
                const SizedBox(width: 6),
                Icon(trailingIcon, size: 18, color: textStyle.color),
              ],
            ],
          );
    // The label stays mounted (opacity-toggled, never removed) so it always reserves the
    // button's natural width; the spinner is only mounted while loading, which is safe
    // because it's smaller than the label and can never make the Stack narrower.
    return Stack(
      alignment: Alignment.center,
      children: [
        Opacity(opacity: loading ? 0 : 1, child: content),
        if (loading)
          SizedBox(
            width: spinnerSize,
            height: spinnerSize,
            child: CircularProgressIndicator(
              strokeWidth: 2.5,
              color: spinnerColor,
            ),
          ),
      ],
    );
  }
}

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
    this.leadingIcon,
    this.trailingIcon,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final String? semanticLabel;

  /// The site's blue CTA glow shadow — reserve for the single most important action on a
  /// screen (e.g. "Open Vink"), not every primary button, or it stops meaning anything.
  final bool glow;

  /// Concept-image icon accents ("+ Start a Vink", "Continue →") — opt-in, default none.
  final IconData? leadingIcon;
  final IconData? trailingIcon;

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
          color: disabled
              ? VinkColors.ink.withValues(alpha: 0.15)
              : VinkColors.blue,
          borderRadius: BorderRadius.circular(_buttonRadius),
          child: InkWell(
            onTap: disabled ? null : onPressed,
            borderRadius: BorderRadius.circular(_buttonRadius),
            splashColor: VinkColors.blueDeep.withValues(alpha: 0.3),
            highlightColor: VinkColors.blueDeep.withValues(alpha: 0.2),
            child: Container(
              constraints: const BoxConstraints(minHeight: _minButtonHeight),
              padding: const EdgeInsets.symmetric(
                horizontal: VinkSpacing.xl,
                vertical: VinkSpacing.md,
              ),
              alignment: Alignment.center,
              child: _ButtonContent(
                label: label,
                loading: loading,
                spinnerColor: VinkColors.white,
                textStyle: VinkTypography.buttonLabel.copyWith(
                  color: VinkColors.white,
                ),
                leadingIcon: leadingIcon,
                trailingIcon: trailingIcon,
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
  const VinkSecondaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.semanticLabel,
    this.leadingIcon,
    this.trailingIcon,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final String? semanticLabel;
  final IconData? leadingIcon;
  final IconData? trailingIcon;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    return Semantics(
      button: true,
      enabled: !disabled,
      label: semanticLabel ?? label,
      child: Material(
        color: VinkColors.white,
        borderRadius: BorderRadius.circular(_buttonRadius),
        child: InkWell(
          onTap: disabled ? null : onPressed,
          borderRadius: BorderRadius.circular(_buttonRadius),
          child: Container(
            constraints: const BoxConstraints(minHeight: _minButtonHeight),
            padding: const EdgeInsets.symmetric(
              horizontal: VinkSpacing.lg,
              vertical: VinkSpacing.sm + 2,
            ),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(_buttonRadius),
              border: Border.all(color: VinkColors.ink.withValues(alpha: 0.15)),
            ),
            child: _ButtonContent(
              label: label,
              loading: loading,
              spinnerColor: VinkColors.ink,
              spinnerSize: 18,
              textStyle: VinkTypography.buttonLabel.copyWith(
                color: disabled ? VinkColors.smoke : VinkColors.ink,
              ),
              leadingIcon: leadingIcon,
              trailingIcon: trailingIcon,
            ),
          ),
        ),
      ),
    );
  }
}

/// A destructive variant of the outline button (cancel a Vink). Foreground text is
/// `VinkColors.ink` (text.primary), not `danger` — `danger` text at this button's actual
/// rendered size (`buttonLabel`, 15px/700) fails WCAG AA against `white`/`paper`
/// (docs/spec/decision-log.md D36; docs/design/phase-8-visual-system-refinement.md §4/§10/§24
/// — bold weight alone doesn't qualify for the large-text exception, since 15px is under the
/// 18.66px-bold floor). `danger` is kept on the border only, a non-text use verified against
/// the 3:1 non-text threshold, so the destructive intent still reads visually.
class VinkDestructiveButton extends StatelessWidget {
  const VinkDestructiveButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.semanticLabel,
  });

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
        borderRadius: BorderRadius.circular(_buttonRadius),
        child: InkWell(
          onTap: disabled ? null : onPressed,
          borderRadius: BorderRadius.circular(_buttonRadius),
          child: Container(
            constraints: const BoxConstraints(minHeight: _minButtonHeight),
            padding: const EdgeInsets.symmetric(
              horizontal: VinkSpacing.lg,
              vertical: VinkSpacing.sm + 2,
            ),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(_buttonRadius),
              border: Border.all(
                color: VinkColors.danger.withValues(
                  alpha: disabled ? 0.3 : 0.6,
                ),
              ),
            ),
            child: _ButtonContent(
              label: label,
              loading: loading,
              spinnerColor: disabled
                  ? VinkColors.ink.withValues(alpha: 0.4)
                  : VinkColors.ink,
              spinnerSize: 18,
              textStyle: VinkTypography.buttonLabel.copyWith(
                color: disabled
                    ? VinkColors.ink.withValues(alpha: 0.4)
                    : VinkColors.ink,
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
  const VinkTextButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.color = VinkColors.blue,
  });

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
          padding: const EdgeInsets.symmetric(
            horizontal: VinkSpacing.sm,
            vertical: VinkSpacing.sm,
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: VinkTypography.label.copyWith(
              color: disabled ? VinkColors.smoke : color,
            ),
          ),
        ),
      ),
    );
  }
}
