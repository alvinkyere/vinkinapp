import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_typography.dart';

/// A paper-background, borderless app bar — the site never uses a hard divider under its
/// header, relying on spacing and the fixed/transparent-to-solid scroll transition instead.
/// This app keeps it simplest: flat, no elevation, ink title text.
class VinkAppBar extends StatelessWidget implements PreferredSizeWidget {
  const VinkAppBar({super.key, required this.title, this.leading, this.actions});

  final String title;
  final Widget? leading;
  final List<Widget>? actions;

  @override
  Size get preferredSize => const Size.fromHeight(64);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: VinkColors.paper,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      leading: leading,
      title: Text(title, style: VinkTypography.cardTitle),
      actions: actions,
    );
  }
}
