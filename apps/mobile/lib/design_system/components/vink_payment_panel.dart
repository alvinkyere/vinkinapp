import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// `PaymentMethodType` collides with this app's own RM4C-B enum of the same name
// (core/models/payment_method.dart) — hidden here since this file never needs Stripe's own.
import 'package:flutter_stripe/flutter_stripe.dart' hide PaymentMethodType;
import '../../core/models/payment_method.dart';
import '../../core/repositories/vink_repository.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';
import '../vink_colors.dart';
import 'vink_inline_error.dart';
import 'vink_payment_method_list.dart';
import 'vink_sandbox_mode_banner.dart';

sealed class _Phase {
  const _Phase();
}

class _Choose extends _Phase {
  const _Choose();
}

class _CreatingSession extends _Phase {
  const _CreatingSession();
}

class _Processing extends _Phase {
  const _Processing();
}

class _Declined extends _Phase {
  const _Declined(this.message);
  final String message;
}

class _PanelError extends _Phase {
  const _PanelError(this.message);
  final String message;
}

/// RM4C-C/F/G — the real payment-method selection + Stripe-hosted card entry experience.
/// `mock` mode renders [legacyButton] completely unchanged (mock mode stays fully supported,
/// byte-for-byte today's existing behavior) — only `stripe_sandbox` mode reaches any of the
/// new UI below. The client never marks a contribution paid itself: every terminal state
/// here ("Processing…") is provisional, and [onProcessing] hands control back to the
/// caller's own snapshot reload, which reflects the server's authoritative state once the
/// signed webhook resolves it (RM4C-C's own core invariant) — the same realtime pipeline
/// every other Lobby state change already flows through.
class VinkPaymentPanel extends ConsumerStatefulWidget {
  const VinkPaymentPanel({
    super.key,
    required this.vinkId,
    required this.legacyButton,
    required this.onProcessing,
  });

  final String vinkId;
  final Widget legacyButton;
  final VoidCallback onProcessing;

  @override
  ConsumerState<VinkPaymentPanel> createState() => _VinkPaymentPanelState();
}

class _VinkPaymentPanelState extends ConsumerState<VinkPaymentPanel> {
  PaymentModeInfo? _modeInfo;
  bool _loadFailed = false;
  PaymentMethodType? _selected;
  _Phase _phase = const _Choose();

  @override
  void initState() {
    super.initState();
    _loadMethods();
  }

  Future<void> _loadMethods() async {
    try {
      final info = await ref
          .read(vinkRepositoryProvider)
          .getPaymentMethods();
      if (!mounted) return;
      setState(() => _modeInfo = info);
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadFailed = true);
    }
  }

  Future<void> _startCardEntry() async {
    setState(() {
      _selected = PaymentMethodType.card;
      _phase = const _CreatingSession();
    });
    try {
      final session = await ref
          .read(vinkRepositoryProvider)
          .createContributionPaymentSession(widget.vinkId);
      if (!mounted) return;
      if (session.clientSecret == null) {
        setState(
          () => _phase = const _PanelError(
            'A payment is already in progress for your share. Pull to refresh to check its status.',
          ),
        );
        return;
      }
      final publishableKey = _modeInfo?.publishableKey;
      if (publishableKey == null) {
        setState(
          () => _phase = const _PanelError(
            "We couldn't start a card payment. Try again.",
          ),
        );
        return;
      }
      Stripe.publishableKey = publishableKey;
      await Stripe.instance.applySettings();
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: session.clientSecret,
          merchantDisplayName: 'VinkIn',
        ),
      );
      if (!mounted) return;
      setState(() => _phase = const _Processing());
      await Stripe.instance.presentPaymentSheet();
      if (!mounted) return;
      // Presenting completed with no exception: the client's part is done — never marked
      // paid locally. Only the signed webhook (already resolved through the exact same
      // engine every other contribution uses) decides what happens next.
      widget.onProcessing();
    } on StripeException catch (error) {
      if (!mounted) return;
      if (error.error.code == FailureCode.Canceled) {
        setState(() => _phase = const _Choose());
        return;
      }
      setState(
        () => _phase = _Declined(
          error.error.localizedMessage ??
              error.error.message ??
              'Your card was declined.',
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _phase = const _PanelError(
          "Something went wrong starting your payment. Try again.",
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadFailed) {
      return const VinkInlineError(
        message: "Couldn't load payment options. Pull to refresh to try again.",
      );
    }
    final modeInfo = _modeInfo;
    if (modeInfo == null) {
      return Text('Loading payment options…', style: VinkTypography.bodySmallSecondary);
    }

    // Today's exact existing behavior, unchanged — mock mode has no card-entry UI at all.
    if (modeInfo.mode == FinancialProviderMode.mock) {
      return widget.legacyButton;
    }

    final phase = _phase;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkSandboxModeBanner(),
        const SizedBox(height: VinkSpacing.sm),
        VinkPaymentMethodList(
          methods: modeInfo.methods,
          selected: _selected,
          onSelect: (type) {
            if (type == PaymentMethodType.card && phase is _Choose) {
              _startCardEntry();
            }
          },
        ),
        if (phase is _CreatingSession) ...[
          const SizedBox(height: VinkSpacing.sm),
          Text('Preparing secure card entry…', style: VinkTypography.bodySmallSecondary),
        ],
        if (phase is _Processing) ...[
          const SizedBox(height: VinkSpacing.sm),
          Semantics(
            liveRegion: true,
            child: Text(
              'Processing your payment…',
              style: VinkTypography.bodySecondary.copyWith(color: VinkColors.blue),
            ),
          ),
        ],
        if (phase is _Declined) ...[
          const SizedBox(height: VinkSpacing.sm),
          VinkInlineError(message: phase.message),
          const SizedBox(height: VinkSpacing.xs),
          TextButton(onPressed: _startCardEntry, child: const Text('Try again')),
        ],
        if (phase is _PanelError) ...[
          const SizedBox(height: VinkSpacing.sm),
          VinkInlineError(message: phase.message),
        ],
      ],
    );
  }
}
