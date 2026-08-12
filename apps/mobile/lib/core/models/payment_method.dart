/// RM4C-B (D49) — mirrors `packages/application/src/payment-methods.ts`'s wire shape exactly
/// (server is the single source of truth on availability; the client never guesses).
enum PaymentMethodType { card, applePay, venmo, cashAppPay }

PaymentMethodType _parsePaymentMethodType(String raw) => switch (raw) {
  'card' => PaymentMethodType.card,
  'apple_pay' => PaymentMethodType.applePay,
  'venmo' => PaymentMethodType.venmo,
  'cash_app_pay' => PaymentMethodType.cashAppPay,
  _ => throw ArgumentError('unknown payment method type: $raw'),
};

enum PaymentMethodAvailability {
  available,
  unavailable,
  requiresConfiguration,
  comingSoon,
}

PaymentMethodAvailability _parseAvailability(String raw) => switch (raw) {
  'available' => PaymentMethodAvailability.available,
  'unavailable' => PaymentMethodAvailability.unavailable,
  'requires_configuration' => PaymentMethodAvailability.requiresConfiguration,
  'coming_soon' => PaymentMethodAvailability.comingSoon,
  _ => throw ArgumentError('unknown payment method availability: $raw'),
};

class PaymentMethodOption {
  const PaymentMethodOption({
    required this.type,
    required this.displayName,
    required this.availability,
    this.unavailableReason,
  });

  factory PaymentMethodOption.fromJson(Map<String, dynamic> json) =>
      PaymentMethodOption(
        type: _parsePaymentMethodType(json['type'] as String),
        displayName: json['displayName'] as String,
        availability: _parseAvailability(json['availability'] as String),
        unavailableReason: json['unavailableReason'] as String?,
      );

  final PaymentMethodType type;
  final String displayName;
  final PaymentMethodAvailability availability;
  final String? unavailableReason;

  bool get isAvailable => availability == PaymentMethodAvailability.available;
}

enum FinancialProviderMode { mock, stripeSandbox }

class PaymentModeInfo {
  const PaymentModeInfo({
    required this.mode,
    required this.publishableKey,
    required this.methods,
  });

  factory PaymentModeInfo.fromJson(Map<String, dynamic> json) =>
      PaymentModeInfo(
        mode: json['mode'] == 'stripe_sandbox'
            ? FinancialProviderMode.stripeSandbox
            : FinancialProviderMode.mock,
        publishableKey: json['publishableKey'] as String?,
        methods: (json['methods'] as List<dynamic>)
            .map(
              (entry) =>
                  PaymentMethodOption.fromJson(entry as Map<String, dynamic>),
            )
            .toList(),
      );

  final FinancialProviderMode mode;
  final String? publishableKey;
  final List<PaymentMethodOption> methods;
}

/// RM4C-C — real hosted card collection. `clientSecret` is null when an existing in-flight
/// session was returned instead of starting a new one (a double tap) — mirrors
/// `CreateContributionPaymentSessionResult` on the server exactly.
class PaymentSessionResult {
  const PaymentSessionResult({
    required this.contributionId,
    required this.contributionStatus,
    required this.clientSecret,
    required this.replayed,
  });

  factory PaymentSessionResult.fromJson(Map<String, dynamic> json) {
    final contribution = json['contribution'] as Map<String, dynamic>;
    return PaymentSessionResult(
      contributionId: contribution['id'] as String,
      contributionStatus: contribution['status'] as String,
      clientSecret: json['clientSecret'] as String?,
      replayed: json['replayed'] as bool,
    );
  }

  final String contributionId;
  final String contributionStatus;
  final String? clientSecret;
  final bool replayed;
}
