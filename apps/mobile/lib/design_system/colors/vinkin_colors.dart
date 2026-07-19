import 'package:flutter/material.dart';

/// Design tokens (Plan §19 design_system). A small, named palette rather than inline
/// hex values scattered through screens — the "design system" PV9 asks for, kept small
/// on purpose for a validation-build MVP.
class VinkinColors {
  const VinkinColors._();

  static const Color primary = Color(0xFF2E5EFF);
  static const Color primaryDark = Color(0xFF1B3FBF);
  static const Color success = Color(0xFF1F9D55);
  static const Color warning = Color(0xFFC98A00);
  static const Color danger = Color(0xFFD64545);
  static const Color simulation = Color(0xFF8B5CF6); // "this is a simulation" accent

  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceMuted = Color(0xFFF4F5F8);
  static const Color border = Color(0xFFE1E4EA);
  static const Color textPrimary = Color(0xFF14161A);
  static const Color textSecondary = Color(0xFF5B616E);
  static const Color textOnPrimary = Color(0xFFFFFFFF);
}
