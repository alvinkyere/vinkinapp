import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_typography.dart';

/// Initials-based avatar (no photo upload anywhere in this product) — `ink`-on-`paper` for
/// the signed-in organizer's own identity chip, `blue`-on-white elsewhere, keeping the
/// palette to the same two colors used throughout.
class VinkAvatar extends StatelessWidget {
  const VinkAvatar({super.key, required this.name, this.size = 40, this.isSelf = false});

  final String name;
  final double size;
  final bool isSelf;

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: isSelf ? VinkColors.ink : VinkColors.blue.withValues(alpha: 0.12),
      ),
      child: Text(
        _initials,
        style: VinkTypography.label.copyWith(
          color: isSelf ? VinkColors.paper : VinkColors.blue,
          fontSize: size * 0.36,
        ),
      ),
    );
  }
}
