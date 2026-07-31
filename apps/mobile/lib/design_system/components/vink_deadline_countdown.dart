import 'dart:async';

import 'package:flutter/widgets.dart';

/// RM4B (D47): a genuinely live countdown, not a render-time-only snapshot. RM4A shortened the
/// default Vink submission window from 24h to 7 minutes, so a label computed once at build time
/// (the pre-RM4B behavior everywhere this widget replaces) could sit frozen or stale for the
/// entire time a screen is open — invisible at 24h granularity, a real, visible problem at
/// minutes-scale. Ticks every second and rebuilds only itself, not its ancestors.
class VinkDeadlineCountdown extends StatefulWidget {
  const VinkDeadlineCountdown({
    required this.deadline,
    required this.builder,
    this.now = DateTime.now,
    super.key,
  });

  final DateTime? deadline;
  final Widget Function(BuildContext context, Duration? remaining) builder;

  /// Injectable for tests — `Timer` itself is already fake under `flutter_test`'s
  /// `testWidgets`/`tester.pump(duration)`, but `DateTime.now()` is not, so a test that wants
  /// to prove a tick actually changed the rendered label needs to control both.
  final DateTime Function() now;

  @override
  State<VinkDeadlineCountdown> createState() => _VinkDeadlineCountdownState();
}

class _VinkDeadlineCountdownState extends State<VinkDeadlineCountdown> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _scheduleTicking();
  }

  @override
  void didUpdateWidget(covariant VinkDeadlineCountdown oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.deadline != widget.deadline) _scheduleTicking();
  }

  void _scheduleTicking() {
    _timer?.cancel();
    if (widget.deadline == null) return;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final deadline = widget.deadline;
    final remaining = deadline?.difference(widget.now());
    return widget.builder(context, remaining);
  }
}

/// The shared "Xm left"/"Xh left"/"Xd left" formatting every deadline label in this app already
/// used, extended with seconds-level display below one minute (RM4B, owner-approved during RM4A
/// planning) — disclosed as an engineering placeholder pending real product/copy review, not a
/// UX-track decision made unilaterally (Phase 6 owns copy). `pastLabel: null` hides the caller's
/// row entirely once the deadline passes (matches the Lobby screen's pre-RM4B behavior); a
/// non-null string keeps it visible (matches Home's pre-RM4B "Past deadline").
String? formatTimeRemaining(Duration? remaining, {String? pastLabel = 'Past deadline'}) {
  if (remaining == null) return null;
  if (remaining.isNegative) return pastLabel;
  if (remaining.inMinutes < 1) return '${remaining.inSeconds}s left';
  if (remaining.inMinutes < 60) return '${remaining.inMinutes}m left';
  if (remaining.inHours < 24) return '${remaining.inHours}h left';
  return '${remaining.inDays}d left';
}
