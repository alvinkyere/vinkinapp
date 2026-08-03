/// Slice I5 — the client-side half of I4B's delivery-mode contract
/// (`apps/api/src/modules/vinks/routes.ts`'s `inviteGuestSchema`: `deliveryMode: 'sms' |
/// 'email' | 'manual'`, `contactDestination` required for sms/email, forbidden for manual).
/// Pure, network-free, and deliberately never infers a mode from the destination's shape —
/// the caller always passes an explicit [DeliveryMode] the guest/organizer picked.
library;

enum DeliveryMode {
  sms,
  email,
  manual;

  /// The exact lowercase wire value `inviteGuestSchema` expects.
  String get wireValue => switch (this) {
    DeliveryMode.sms => 'sms',
    DeliveryMode.email => 'email',
    DeliveryMode.manual => 'manual',
  };

  /// Matches the UPPERCASE value the API echoes back (`GuestIdentityRecord.deliveryMode`,
  /// `deliveryMode` on the invite/resend response) and what a resumed snapshot would carry.
  String get wireValueUppercase => wireValue.toUpperCase();

  String get label => switch (this) {
    DeliveryMode.sms => 'Text (SMS)',
    DeliveryMode.email => 'Email',
    DeliveryMode.manual => 'I\'ll share it myself',
  };

  /// Customer-safe expectation only — never provider acceptance, attempt history, or
  /// delivery diagnostics (explicitly prohibited in Create; that belongs to I7).
  String get expectationCaption => switch (this) {
    DeliveryMode.sms => 'They\'ll get a text once this Vink opens.',
    DeliveryMode.email => 'They\'ll get an email once this Vink opens.',
    DeliveryMode.manual => 'You\'ll share the link yourself.',
  };

  /// Short per-row caption for the People+Split list and the Open Vink confirmation summary
  /// (Phase 4 §5c "delivery method per person").
  String get shortExpectation => switch (this) {
    DeliveryMode.sms => 'Will be texted',
    DeliveryMode.email => 'Will be emailed',
    DeliveryMode.manual => 'Shared manually',
  };

  static DeliveryMode? fromWireValue(String? value) =>
      switch (value?.toUpperCase()) {
        'SMS' => DeliveryMode.sms,
        'EMAIL' => DeliveryMode.email,
        'MANUAL' => DeliveryMode.manual,
        _ => null,
      };
}

/// A loose phone-shape check mirroring the backend's own `PHONE_SHAPE` regex
/// (`apps/api/src/modules/vinks/routes.ts`) — real deliverability is the provider's concern,
/// this only catches an obviously-wrong value in the wrong field, so the client fails fast
/// with the same tolerance the server will apply anyway.
final RegExp _phoneShape = RegExp(r'^\+?[0-9][0-9\s\-().]{6,}$');

/// A loose email-shape check — good enough to catch "obviously not an email," not a full
/// RFC validator; the server (`z.email()`) is the final authority either way.
final RegExp _emailShape = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

/// The delivery-mode contract itself, enforced client-side before ever calling the API —
/// mirrors `assertDeliveryModeContract` (`packages/application/src/guest.ts`) exactly:
/// SMS/EMAIL require a validly-shaped destination, MANUAL must not carry one at all.
/// Returns a human validation message, or null if [destination] is valid for [mode].
String? validateContactDestination(DeliveryMode mode, String destination) {
  final trimmed = destination.trim();
  switch (mode) {
    case DeliveryMode.manual:
      return null; // manual never sends a destination to the API regardless of this field
    case DeliveryMode.sms:
      if (trimmed.isEmpty) return 'Enter a phone number.';
      if (!_phoneShape.hasMatch(trimmed)) return 'Enter a valid phone number.';
      return null;
    case DeliveryMode.email:
      if (trimmed.isEmpty) return 'Enter an email address.';
      if (!_emailShape.hasMatch(trimmed)) return 'Enter a valid email address.';
      return null;
  }
}
