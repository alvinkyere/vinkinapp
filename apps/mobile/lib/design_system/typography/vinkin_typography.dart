import 'package:flutter/material.dart';
import '../colors/vinkin_colors.dart';

/// Named type scale — screens reference `VinkinTypography.title`, never a raw TextStyle,
/// so the scale can change in one place.
class VinkinTypography {
  const VinkinTypography._();

  static const TextStyle display = TextStyle(
    fontSize: 32,
    fontWeight: FontWeight.w700,
    color: VinkinColors.textPrimary,
    height: 1.2,
  );

  static const TextStyle title = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w700,
    color: VinkinColors.textPrimary,
    height: 1.25,
  );

  static const TextStyle body = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w400,
    color: VinkinColors.textPrimary,
    height: 1.4,
  );

  static const TextStyle bodySecondary = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: VinkinColors.textSecondary,
    height: 1.4,
  );

  static const TextStyle label = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w600,
    color: VinkinColors.textSecondary,
    letterSpacing: 0.4,
  );

  static const TextStyle money = TextStyle(
    fontSize: 28,
    fontWeight: FontWeight.w700,
    color: VinkinColors.textPrimary,
    fontFeatures: [FontFeature.tabularFigures()],
  );
}
