import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../vink_colors.dart';

/// vinkin.org's actual mark, reproduced from its own SVG path data (viewBox 0 0 48 48,
/// see docs/design/vinkin-design-system.md "Logo treatment"): an angular V-shaped vessel
/// with a droplet above its opening — an ink drop about to fall in.
class VinkLogoMark extends StatelessWidget {
  const VinkLogoMark({
    super.key,
    this.size = 28,
    this.vesselColor = VinkColors.ink,
  });

  final double size;
  final Color vesselColor;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _VinkMarkPainter(vesselColor: vesselColor)),
    );
  }
}

class _VinkMarkPainter extends CustomPainter {
  _VinkMarkPainter({required this.vesselColor});

  final Color vesselColor;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 48;
    canvas.save();
    canvas.scale(scale);

    // The V vessel: M5 12h9.8L24 33.6 33.2 12H43L27.6 43h-7.2L5 12Z
    final vessel = Path()
      ..moveTo(5, 12)
      ..lineTo(14.8, 12)
      ..lineTo(24, 33.6)
      ..lineTo(33.2, 12)
      ..lineTo(43, 12)
      ..lineTo(27.6, 43)
      ..lineTo(20.4, 43)
      ..lineTo(5, 12)
      ..close();
    canvas.drawPath(vessel, Paint()..color = vesselColor);

    // The droplet: M24 2.5c2.8 3.6 4.4 6 4.4 8.2a4.4 4.4 0 0 1-8.8 0c0-2.2 1.6-4.6 4.4-8.2Z
    final droplet = Path()
      ..moveTo(24, 2.5)
      ..relativeCubicTo(2.8, 3.6, 4.4, 6, 4.4, 8.2)
      ..relativeArcToPoint(
        const Offset(-8.8, 0),
        radius: const Radius.circular(4.4),
        clockwise: true,
      )
      ..relativeCubicTo(0, -2.2, 1.6, -4.6, 4.4, -8.2)
      ..close();
    canvas.drawPath(droplet, Paint()..color = VinkColors.blue);

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _VinkMarkPainter oldDelegate) =>
      oldDelegate.vesselColor != vesselColor;
}

/// The full lockup: mark + "Vink" (in [vesselColor]) + "In" (always blue) — matches the
/// site's header exactly (font-display, extrabold, tightest tracking).
class VinkWordmark extends StatelessWidget {
  const VinkWordmark({
    super.key,
    this.fontSize = 20,
    this.color = VinkColors.ink,
    this.showMark = true,
  });

  final double fontSize;
  final Color color;
  final bool showMark;

  @override
  Widget build(BuildContext context) {
    final style = GoogleFonts.dmSerifDisplay(
      fontSize: fontSize,
      fontWeight: FontWeight.w400,
      letterSpacing: -0.025 * fontSize,
      color: color,
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showMark) ...[
          VinkLogoMark(size: fontSize * 1.4, vesselColor: color),
          const SizedBox(width: 8),
        ],
        Text.rich(
          TextSpan(
            children: [TextSpan(text: 'VinkIn', style: style)],
          ),
        ),
      ],
    );
  }
}
