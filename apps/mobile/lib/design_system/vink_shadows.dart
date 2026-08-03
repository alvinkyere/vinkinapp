import 'package:flutter/widgets.dart';
import 'vink_colors.dart';

/// vinkin.org's two colored, soft, large-radius shadows — ink-tinted for surfaces, a
/// blue-tinted "glow" reserved for the one primary CTA per screen. Translated from CSS
/// box-shadow (offset-x offset-y blur spread color) to Flutter's BoxShadow (which has no
/// separate spread-as-negative-blur concept — blurRadius approximates the CSS blur value).
class VinkShadows {
  const VinkShadows._();

  /// `0 8px 24px -12px rgba(10,10,11,.25)` — the everyday card shadow.
  static List<BoxShadow> card = [
    BoxShadow(
      color: VinkColors.ink.withValues(alpha: 0.055),
      offset: const Offset(0, 8),
      blurRadius: 24,
    ),
  ];

  /// `0 40px 100px -20px rgba(10,10,11,.55)` — the hero mockup's dramatic elevated shadow,
  /// for the single most prominent card on a screen (e.g. the live lobby's Vink card).
  static List<BoxShadow> cardElevated = [
    BoxShadow(
      color: VinkColors.ink.withValues(alpha: 0.08),
      offset: const Offset(0, 16),
      blurRadius: 40,
    ),
  ];

  /// `0 16px 40px -12px rgba(49,92,255,.6)` — the primary-CTA glow. Use once per screen.
  static List<BoxShadow> ctaGlow = [
    BoxShadow(
      color: VinkColors.blue.withValues(alpha: 0.18),
      offset: const Offset(0, 10),
      blurRadius: 24,
    ),
  ];
}
