import 'package:flutter/widgets.dart';
import 'package:google_fonts/google_fonts.dart';
import 'vink_colors.dart';

/// vinkin.org uses two families: Bricolage Grotesque for every heading AND every button
/// label (never the body font), Inter for everything else. Tracking/line-height values
/// below are taken from the site's `.display`/`.eyebrow` utility classes and its
/// `tracking-tightest/-tight/-wide/-widest` scale (docs/design/vinkin-design-system.md).
class VinkTypography {
  const VinkTypography._();

  static TextStyle _display({
    required double fontSize,
    required FontWeight weight,
    double letterSpacingEm = -0.025,
    Color color = VinkColors.ink,
  }) {
    return GoogleFonts.inter(
      fontSize: fontSize,
      fontWeight: weight,
      height: 1.12,
      letterSpacing: letterSpacingEm * fontSize,
      color: color,
    );
  }

  static TextStyle _body({
    required double fontSize,
    required double lineHeight,
    FontWeight weight = FontWeight.w400,
    Color color = VinkColors.ink,
  }) {
    return GoogleFonts.inter(
      fontSize: fontSize,
      fontWeight: weight,
      height: lineHeight / fontSize,
      color: color,
    );
  }

  // --- Display (Bricolage Grotesque) — headings, amounts, button labels -------------

  static TextStyle heroDisplay = _display(
    fontSize: 48,
    weight: FontWeight.w500,
    letterSpacingEm: -0.045,
  );
  static TextStyle title = _display(
    fontSize: 30,
    weight: FontWeight.w700,
    letterSpacingEm: -0.035,
  );
  static TextStyle cardTitle = _display(
    fontSize: 18,
    weight: FontWeight.w700,
    letterSpacingEm: -0.025,
  );
  static TextStyle amountLarge = _display(
    fontSize: 40,
    weight: FontWeight.w500,
    letterSpacingEm: -0.045,
  );
  static TextStyle amountMedium = _display(
    fontSize: 24,
    weight: FontWeight.w700,
    letterSpacingEm: -0.035,
  );

  /// Button labels: uppercase is applied by the button component, not baked into the
  /// TextStyle, so this style stays reusable for anything display-weight + wide-tracked.
  static TextStyle buttonLabel = _display(
    fontSize: 15,
    weight: FontWeight.w500,
    letterSpacingEm: -0.01,
  );

  // --- Body (Inter) ------------------------------------------------------------------

  static TextStyle body = _body(fontSize: 16, lineHeight: 24);
  static TextStyle bodySecondary = _body(
    fontSize: 16,
    lineHeight: 24,
    color: VinkColors.smoke,
  );
  static TextStyle bodySmall = _body(fontSize: 14, lineHeight: 20);
  static TextStyle bodySmallSecondary = _body(
    fontSize: 14,
    lineHeight: 20,
    color: VinkColors.smoke,
  );
  static TextStyle label = _body(
    fontSize: 14,
    lineHeight: 20,
    weight: FontWeight.w600,
  );
  static TextStyle participantName = _body(
    fontSize: 14,
    lineHeight: 20,
    weight: FontWeight.w600,
  );

  /// The site's `.eyebrow` utility: 11.2px (`.7rem`), +0.28em tracking — the widest
  /// tracking on the whole site, reserved for small overline labels ("Sound familiar?").
  static TextStyle eyebrow = GoogleFonts.inter(
    fontSize: 11.2,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.28 * 11.2,
    color: VinkColors.smoke,
  );

  /// The hero mockup's "still deciding" indicator: monospace, widest tracking.
  static const TextStyle monoIndicator = TextStyle(
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: FontWeight.w600,
  );
}
