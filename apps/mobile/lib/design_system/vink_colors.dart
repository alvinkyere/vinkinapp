import 'package:flutter/widgets.dart';

/// Sourced directly from vinkin.org's compiled CSS (docs/design/vinkin-design-system.md) —
/// five named colors, always used at full opacity or as opacity variants of themselves
/// (`ink.withValues(alpha: .15)`), never a larger fixed palette.
class VinkColors {
  const VinkColors._();

  static const ink = Color(0xFF080B1A);
  static const paper = Color(0xFFFCFBF8);
  static const smoke = Color(0xFF6F7280);
  static const blue = Color(0xFF063EF5);
  static const blueDeep = Color(0xFF002EC7);
  static const white = Color(0xFFFFFFFF);
  static const line = Color(0xFFE3E4E8);
  static const blueSoft = Color(0xFFE8EDFF);

  /// App-derived (docs/design/vinkin-design-system.md's "Buttons" section flags this
  /// explicitly): the site has no destructive/error palette to source from — its own
  /// "paid" checkmark badge is blue, not green (see the design doc's card reference).
  /// One red, used only for cancel/destructive actions and validation errors; "paid"
  /// stays `blue`, matching the site exactly, not a separate success color.
  static const danger = Color(0xFFD64545);
}
