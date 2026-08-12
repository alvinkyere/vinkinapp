import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../vink_colors.dart';
import '../vink_typography.dart';
import 'money_text.dart';

/// I7 (Phase 8 §15, Phase 4 §0, Phase 6 §12, D20/D24) — the Ink Progress vessel, driven only
/// by `contributionProgress` (never `fundedAmountMinor`, which only moves atomically at full
/// resolution, D5). Replaces [VinkProgressIndicator] entirely wherever it's used.
///
/// Two genuinely different visual treatments, matching the reference design's own split:
/// - **Primary** (Lobby): a real bowl silhouette with an animated wavy liquid surface and a
///   light droplet accent — the screen's own dominant object.
/// - **Compact** (Home card): a plain rounded pill bar — the reference design's own Home
///   card uses a simple bar, not a shrunken bowl; a tiny bowl reads as a rendering glitch,
///   not a smaller vessel.
class VinkProgressVessel extends StatefulWidget {
  const VinkProgressVessel({
    super.key,
    required this.confirmedAmountMinor,
    required this.totalAmountMinor,
    this.waitingClause,
    this.compact = false,
  });

  final int confirmedAmountMinor;
  final int totalAmountMinor;

  /// The full-vessel headline is always "$X of $Y ready"; this is the SECOND line — "Waiting
  /// for Maya" / "Waiting for 3 people" / "Everyone's ready" (Phase 6 §12's exact table).
  /// Null for the compact Home variant — the card's own caption line covers this instead.
  final String? waitingClause;

  /// Compact — Home's per-card preview: a plain rounded pill bar, no headline/waiting-clause
  /// text of its own (the caller's own card already shows the amount and a people caption).
  final bool compact;

  double get _fraction => totalAmountMinor == 0
      ? 0.0
      : (confirmedAmountMinor / totalAmountMinor).clamp(0.0, 1.0);

  @override
  State<VinkProgressVessel> createState() => _VinkProgressVesselState();
}

class _VinkProgressVesselState extends State<VinkProgressVessel>
    with TickerProviderStateMixin {
  late final AnimationController _waveController;
  late final AnimationController _celebrationController;
  bool _celebrated = false;

  @override
  void initState() {
    super.initState();
    // The approved reference is a calm, still ink vessel. Keeping this controller
    // stationary also avoids a permanently animating screen (and lets accessibility
    // tooling/tests reach a settled frame); only the one-shot completion celebration moves.
    _waveController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    );
    _celebrationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _celebrated = widget._fraction >= 1.0;
  }

  @override
  void didUpdateWidget(VinkProgressVessel old) {
    super.didUpdateWidget(old);
    if (widget._fraction >= 1.0 && !_celebrated) {
      _celebrated = true;
      final reduceMotion =
          MediaQuery.maybeOf(context)?.disableAnimations ?? false;
      if (!reduceMotion) _celebrationController.forward(from: 0);
    } else if (widget._fraction < 1.0) {
      _celebrated = false;
    }
  }

  @override
  void dispose() {
    _waveController.dispose();
    _celebrationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final headline =
        '${MoneyText.format(widget.confirmedAmountMinor)} of ${MoneyText.format(widget.totalAmountMinor)} ready';
    final semanticsLabel = widget.waitingClause == null
        ? headline
        : '$headline. ${widget.waitingClause}.';
    final fraction = widget._fraction;
    // Phase 8 §15 "Empty" state: a sliver stays visible even at $0 confirmed, so the vessel
    // reads as "a container," not "missing" — the ACCESSIBLE value below still reports the
    // real 0%, only the decorative minimum-visible-fill is floored.
    final visualFraction = fraction == 0.0 ? 0.05 : fraction;

    if (widget.compact) {
      return Semantics(
        label: semanticsLabel,
        value: '${(fraction * 100).round()}%',
        child: ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: SizedBox(
            height: 8,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Container(color: VinkColors.ink.withValues(alpha: 0.08)),
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: visualFraction, end: visualFraction),
                  duration: reduceMotion
                      ? Duration.zero
                      : const Duration(milliseconds: 700),
                  curve: Curves.easeOutCubic,
                  builder: (context, level, child) => FractionallySizedBox(
                    widthFactor: level,
                    alignment: Alignment.centerLeft,
                    child: child,
                  ),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [VinkColors.blue, VinkColors.blueDeep],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final vessel = Semantics(
      label: semanticsLabel,
      value: '${(fraction * 100).round()}%',
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 220, maxHeight: 190),
          child: AspectRatio(
            aspectRatio: 1.15,
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: visualFraction, end: visualFraction),
              duration: reduceMotion
                  ? Duration.zero
                  : const Duration(milliseconds: 700),
              curve: Curves.easeOutCubic,
              builder: (context, level, _) => AnimatedBuilder(
                animation: Listenable.merge([
                  _waveController,
                  _celebrationController,
                ]),
                builder: (context, _) => CustomPaint(
                  size: Size.infinite,
                  painter: _InkBowlPainter(
                    level: level,
                    wavePhase: reduceMotion
                        ? 0
                        : _waveController.value * 2 * math.pi,
                    sparkle: _celebrationController.value,
                    animateWave: !reduceMotion,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    // Concept-image placement: the headline reads above the vessel, not below it — the bowl
    // itself is the hero, with its own whitespace, and the waiting-clause caption sits below
    // as a quieter line (Typography section: "Money is always dominant... everything else
    // becomes visually quieter").
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text.rich(
          TextSpan(
            style: VinkTypography.amountMedium,
            children: [
              TextSpan(
                text: MoneyText.format(widget.confirmedAmountMinor),
                style: const TextStyle(color: VinkColors.blue),
              ),
              TextSpan(
                text: ' of ${MoneyText.format(widget.totalAmountMinor)} ready',
                style: const TextStyle(color: VinkColors.ink),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        vessel,
        if (widget.waitingClause != null) ...[
          const SizedBox(height: 12),
          Text(widget.waitingClause!, style: VinkTypography.bodySmallSecondary),
        ],
      ],
    );
  }
}

/// A real vessel silhouette (wider top, rounded bottom — a bowl, not a bar) with a wavy
/// liquid surface and a light droplet accent, matching the reference design's own Live Vink
/// visual. Deliberately calm: one gentle wave, a few small droplets, a brief sparkle burst
/// only at the exact moment the vessel completes — never a continuously-running splash/bubble
/// simulation.
class _InkBowlPainter extends CustomPainter {
  _InkBowlPainter({
    required this.level,
    required this.wavePhase,
    required this.sparkle,
    required this.animateWave,
  });

  final double level;
  final double wavePhase;
  final double sparkle;
  final bool animateWave;

  Path _bowlPath(Size size) {
    final w = size.width;
    final h = size.height;
    // A rounded glass/bowl silhouette: gently flared top corners, a much more rounded
    // bottom, and a slight inward taper on the sides — closer to the reference design's own
    // vessel than a plain rounded rectangle.
    final path = Path();
    final topRadius = h * 0.10;
    final bottomRadius = w * 0.30;
    final sideInset = w * 0.04;
    path.moveTo(0, topRadius);
    path.quadraticBezierTo(0, 0, topRadius, 0);
    path.lineTo(w - topRadius, 0);
    path.quadraticBezierTo(w, 0, w, topRadius);
    path.lineTo(w, h - bottomRadius);
    path.quadraticBezierTo(
      w,
      h - bottomRadius * 0.3,
      w - sideInset,
      h - bottomRadius * 0.15,
    );
    path.quadraticBezierTo(w / 2, h, sideInset, h - bottomRadius * 0.15);
    path.quadraticBezierTo(0, h - bottomRadius * 0.3, 0, h - bottomRadius);
    path.close();
    return path;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final bowl = _bowlPath(size);

    canvas.save();
    canvas.clipPath(bowl);
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = VinkColors.ink.withValues(alpha: 0.03),
    );

    final waveHeight = animateWave ? size.height * 0.05 : 0.0;
    final waveLength = size.width / 1.5;
    final baseY = size.height * (1 - level);
    final liquid = Path()..moveTo(0, size.height);
    liquid.lineTo(0, baseY);
    const step = 2.0;
    for (double x = 0; x <= size.width; x += step) {
      final y =
          baseY +
          math.sin((x / waveLength * 2 * math.pi) + wavePhase) * waveHeight +
          math.sin((x / waveLength * 2 * math.pi * 1.7) - wavePhase * 1.3) *
              (waveHeight * 0.4);
      liquid.lineTo(x, y);
    }
    liquid.lineTo(size.width, size.height);
    liquid.close();

    canvas.drawPath(
      liquid,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [VinkColors.blue, VinkColors.blueDeep],
        ).createShader(Offset.zero & size),
    );

    // A light droplet accent, only mid-fill (not empty, not full) — matches the reference
    // design's floating-droplet texture without ever reading as a physics simulation.
    if (level > 0.06 && level < 0.98) {
      final dropletPaint = Paint()
        ..color = VinkColors.white.withValues(alpha: 0.55);
      for (var i = 0; i < 4; i++) {
        final dx = size.width * (0.16 + i * 0.22);
        final bob = math.sin(wavePhase + i * 1.7) * size.height * 0.025;
        final dy = baseY - size.height * (0.08 + i * 0.035) + bob;
        if (dy > 2) {
          canvas.drawCircle(Offset(dx, dy), size.width * 0.014, dropletPaint);
        }
      }
    }

    // The one-shot completion sparkle — a few small highlights that fade in and back out
    // across `_celebrationController`'s single forward run, never a repeating flourish.
    if (sparkle > 0) {
      final sparkleOpacity = (math.sin(sparkle * math.pi)).clamp(0.0, 1.0);
      final sparklePaint = Paint()
        ..color = VinkColors.white.withValues(alpha: sparkleOpacity * 0.85);
      for (var i = 0; i < 6; i++) {
        final angle = (i / 6) * 2 * math.pi;
        final radius = size.width * (0.2 + sparkle * 0.18);
        final center = Offset(size.width / 2, size.height * 0.4);
        final point =
            center + Offset(math.cos(angle), math.sin(angle) * 0.7) * radius;
        canvas.drawCircle(point, size.width * 0.016, sparklePaint);
      }
    }

    canvas.restore();

    canvas.drawPath(
      bowl,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4
        ..color = VinkColors.ink.withValues(alpha: 0.14),
    );
  }

  @override
  bool shouldRepaint(covariant _InkBowlPainter oldDelegate) =>
      oldDelegate.level != level ||
      oldDelegate.wavePhase != wavePhase ||
      oldDelegate.sparkle != sparkle;
}

/// Above the vessel outside particles floating around it (the reference design's own small
/// blue confetti-dot accents scattered near the bowl). Deliberately outside the painter/clip
/// so they can drift slightly beyond the bowl's own silhouette, matching the reference.
class VinkVesselAmbientDots extends StatelessWidget {
  const VinkVesselAmbientDots({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      alignment: Alignment.center,
      children: [
        Positioned(top: -6, left: 8, child: _dot(4, 0.5)),
        Positioned(top: 4, right: -4, child: _dot(3, 0.35)),
        Positioned(bottom: 10, right: -10, child: _dot(5, 0.4)),
        Positioned(bottom: -8, left: -6, child: _dot(3, 0.3)),
        child,
      ],
    );
  }

  Widget _dot(double size, double opacity) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: VinkColors.blue.withValues(alpha: opacity),
    ),
  );
}

/// Phase 6 §12's exact waiting-clause table, organizer variant (real participant names —
/// already-visible data on the organizer's own Lobby, D24/D25's organizer-sees-all
/// boundary). `unconfirmedNames` is every non-organizer-excluded participant with a positive
/// allocation who hasn't confirmed yet, in a stable display order.
String organizerWaitingClause({
  required int confirmedAmountMinor,
  required int totalAmountMinor,
  required List<String> unconfirmedNames,
}) {
  if (confirmedAmountMinor >= totalAmountMinor && totalAmountMinor > 0) {
    return "Everyone's ready";
  }
  if (unconfirmedNames.isEmpty) return 'Waiting for everyone';
  if (unconfirmedNames.length == 1) {
    return 'Waiting for ${unconfirmedNames.first}';
  }
  if (unconfirmedNames.length == 2) {
    return 'Waiting for ${unconfirmedNames[0]} and ${unconfirmedNames[1]}';
  }
  return 'Waiting for ${unconfirmedNames.length} people';
}

/// The participant/guest-safe counterpart — D24/D25's privacy boundary means a participant's
/// own view never has other participants' names to begin with (`ParticipantVinkSummary` only
/// ever carries counts), so this deliberately never names anyone — a disclosed adaptation of
/// Phase 6 §12's own table, which assumes name data this view structurally doesn't have.
String participantSafeWaitingClause({
  required int confirmedAmountMinor,
  required int totalAmountMinor,
  required int confirmedParticipantCount,
  required int totalParticipantCount,
}) {
  if (confirmedAmountMinor >= totalAmountMinor && totalAmountMinor > 0) {
    return "Everyone's ready";
  }
  final remaining = totalParticipantCount - confirmedParticipantCount;
  if (confirmedParticipantCount == 0) return 'Waiting for everyone';
  if (remaining <= 0) return "Everyone's ready";
  if (remaining == 1) return 'Waiting for 1 more person';
  return 'Waiting for $remaining people';
}
