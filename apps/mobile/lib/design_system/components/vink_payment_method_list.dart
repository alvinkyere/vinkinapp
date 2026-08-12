import 'package:flutter/material.dart';
import '../../core/models/payment_method.dart';
import '../vink_colors.dart';
import '../vink_spacing.dart';
import '../vink_typography.dart';

String _label(PaymentMethodType type) => switch (type) {
  PaymentMethodType.card => 'Card',
  PaymentMethodType.applePay => '',
  PaymentMethodType.venmo => 'V',
  PaymentMethodType.cashAppPay => r'$',
};

/// RM4C-B/F — the required invariant, rendered: a method is either genuinely selectable
/// (`available`) or shown disabled with truthful, specific copy — never a button that leads
/// nowhere with no explanation, never a fabricated success. Availability comes from the
/// server ([VinkRepository.getPaymentMethods]) — this widget never guesses.
class VinkPaymentMethodList extends StatelessWidget {
  const VinkPaymentMethodList({
    super.key,
    required this.methods,
    required this.selected,
    required this.onSelect,
  });

  final List<PaymentMethodOption> methods;
  final PaymentMethodType? selected;
  final ValueChanged<PaymentMethodType> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final method in methods) ...[
          _PaymentMethodTile(
            method: method,
            isSelected: selected == method.type,
            onTap: method.isAvailable ? () => onSelect(method.type) : null,
          ),
          const SizedBox(height: VinkSpacing.sm),
        ],
      ],
    );
  }
}

class _PaymentMethodTile extends StatelessWidget {
  const _PaymentMethodTile({
    required this.method,
    required this.isSelected,
    required this.onTap,
  });

  final PaymentMethodOption method;
  final bool isSelected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final isAvailable = method.isAvailable;
    return Semantics(
      button: isAvailable,
      selected: isSelected,
      label: isAvailable
          ? method.displayName
          : '${method.displayName}, ${method.unavailableReason ?? "unavailable"}',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
            horizontal: VinkSpacing.md,
            vertical: VinkSpacing.sm + 4,
          ),
          decoration: BoxDecoration(
            color: isSelected
                ? VinkColors.blueSoft
                : isAvailable
                    ? VinkColors.white
                    : VinkColors.ink.withValues(alpha: 0.02),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isSelected
                  ? VinkColors.blue
                  : VinkColors.line,
            ),
          ),
          child: Row(
            children: [
              Text(_label(method.type), style: const TextStyle(fontSize: 18)),
              const SizedBox(width: VinkSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      method.displayName,
                      style: VinkTypography.body.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (!isAvailable && method.unavailableReason != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          method.unavailableReason!,
                          style: VinkTypography.bodySmallSecondary,
                        ),
                      ),
                  ],
                ),
              ),
              if (isAvailable)
                Icon(
                  isSelected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: isSelected ? VinkColors.blue : VinkColors.smoke,
                )
              else
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: VinkColors.ink.withValues(alpha: 0.05),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    method.availability == PaymentMethodAvailability.comingSoon
                        ? 'COMING SOON'
                        : 'UNAVAILABLE',
                    style: VinkTypography.bodySmallSecondary.copyWith(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
