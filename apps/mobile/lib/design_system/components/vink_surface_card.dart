import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_radius.dart';
import '../vink_shadows.dart';
import '../vink_spacing.dart';

/// The card treatment straight from vinkin.org's own hero mockup (see the design doc's
/// "closest real reference" section): `rounded-[2rem]`, `p-7`. The site's mockup card is
/// `bg-paper` because it sits on a dark `ink` section; this app's page background is
/// itself `paper` (VinkTheme), so cards use `white` instead — the site's own "surface/card
/// colors" distinction (white is "used sparingly, distinct from paper") applied to a
/// paper-background context. [elevated] swaps in the hero's dramatic shadow — reserve for
/// the single most important card on a screen (the live lobby's Vink card); every other
/// card uses the quieter default.
class VinkSurfaceCard extends StatelessWidget {
  const VinkSurfaceCard({
    super.key,
    required this.child,
    this.elevated = false,
    this.padding,
  });

  final Widget child;
  final bool elevated;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding ?? const EdgeInsets.all(VinkSpacing.cardPadding),
      decoration: BoxDecoration(
        color: VinkColors.paper,
        borderRadius: BorderRadius.circular(VinkRadius.card),
        border: Border.all(color: VinkColors.line),
        boxShadow: elevated ? VinkShadows.cardElevated : VinkShadows.card,
      ),
      child: child,
    );
  }
}
