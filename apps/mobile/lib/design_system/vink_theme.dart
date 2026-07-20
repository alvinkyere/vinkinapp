import 'package:flutter/material.dart';
import 'vink_colors.dart';
import 'vink_radius.dart';
import 'vink_typography.dart';

/// vinkin.org's page background is `paper` (warm cream), never white or cold gray; body
/// text is `ink`; the one accent is `blue`. This ThemeData exists mainly so text-selection
/// handles, native pickers, and anything MaterialApp needs by default look correct — every
/// screen in this app composes `Vink*` design-system widgets directly rather than Material
/// widgets styled through the theme, per the design correction's own instruction to build a
/// coherent product, not restyle Material defaults.
ThemeData buildVinkTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: VinkColors.blue,
    brightness: Brightness.light,
    primary: VinkColors.blue,
    surface: VinkColors.paper,
    onSurface: VinkColors.ink,
    error: VinkColors.danger,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: VinkColors.paper,
    textTheme: TextTheme(
      headlineLarge: VinkTypography.title,
      headlineMedium: VinkTypography.cardTitle,
      bodyLarge: VinkTypography.body,
      bodyMedium: VinkTypography.bodySmall,
      labelLarge: VinkTypography.label,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: VinkColors.paper,
      foregroundColor: VinkColors.ink,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: VinkTypography.cardTitle,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: VinkColors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(VinkRadius.xl),
        borderSide: BorderSide(color: VinkColors.ink.withValues(alpha: 0.12)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(VinkRadius.xl),
        borderSide: BorderSide(color: VinkColors.ink.withValues(alpha: 0.12)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(VinkRadius.xl),
        borderSide: const BorderSide(color: VinkColors.blue, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(VinkRadius.xl),
        borderSide: const BorderSide(color: VinkColors.danger, width: 1.5),
      ),
      labelStyle: VinkTypography.bodySmallSecondary,
    ),
    splashFactory: InkRipple.splashFactory,
  );
}
