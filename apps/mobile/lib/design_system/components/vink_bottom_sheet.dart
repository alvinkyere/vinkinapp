import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_radius.dart';
import '../vink_spacing.dart';

/// The "Add someone" sheet, and every other modal surface in this app — paper background,
/// large top radius, a drag handle, keyboard-safe padding so the sheet never sits behind
/// the on-screen keyboard.
Future<T?> showVinkBottomSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = true,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: isScrollControlled,
    backgroundColor: VinkColors.paper,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(VinkRadius.card)),
    ),
    builder: (context) {
      return Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SafeArea(
          top: false,
          // Bounded to the viewport so content taller than the screen (e.g. the guest-invite
          // QR + link + actions on a shorter device) scrolls instead of overflowing —
          // `showModalBottomSheet` alone doesn't cap height, so without this bound
          // `SingleChildScrollView` would just grow with its child instead of scrolling.
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.9),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(VinkSpacing.lg, VinkSpacing.sm, VinkSpacing.lg, VinkSpacing.lg),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: VinkSpacing.lg),
                    decoration: BoxDecoration(
                      color: VinkColors.ink.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                  Builder(builder: builder),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}
