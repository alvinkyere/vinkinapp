import 'package:flutter/material.dart';
import '../design_system/colors/vinkin_colors.dart';

/// Builds Flutter's ThemeData FROM the design tokens (never the reverse) — screens reach
/// for VinkinColors/VinkinTypography directly; this just makes default Material widgets
/// (AppBar, Scaffold background) agree with the same palette.
ThemeData buildVinkinTheme() {
  return ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(seedColor: VinkinColors.primary, primary: VinkinColors.primary),
    scaffoldBackgroundColor: VinkinColors.surfaceMuted,
    appBarTheme: const AppBarTheme(
      backgroundColor: VinkinColors.surface,
      foregroundColor: VinkinColors.textPrimary,
      elevation: 0,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: VinkinColors.surface,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: VinkinColors.border)),
    ),
  );
}
