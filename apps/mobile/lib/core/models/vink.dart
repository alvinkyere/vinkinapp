/// Mirrors the `VinkSnapshot` shape from `packages/application/src/queries.ts` and the
/// wire shape of `POST /api/v1/vinks` — the same JSON crosses both endpoints.
library;

class VinkParticipant {
  const VinkParticipant({
    required this.id,
    required this.displayName,
    required this.role,
    required this.status,
    required this.allocatedAmountMinor,
  });

  final String id;
  final String displayName;
  final String role;
  final String status;
  final int allocatedAmountMinor;

  factory VinkParticipant.fromJson(Map<String, dynamic> json) => VinkParticipant(
    id: json['id'] as String,
    displayName: json['displayName'] as String,
    role: json['role'] as String,
    status: json['status'] as String,
    allocatedAmountMinor: (json['allocatedAmount']?['amountMinor'] as num?)?.toInt() ?? 0,
  );
}

class VinkCard {
  const VinkCard({
    required this.status,
    required this.displayLastFour,
    required this.spendingLimitMinor,
    required this.merchantLocked,
  });

  final String status;
  final String displayLastFour;
  final int spendingLimitMinor;
  final bool merchantLocked;

  factory VinkCard.fromJson(Map<String, dynamic> json) => VinkCard(
    status: json['status'] as String,
    displayLastFour: json['displayLastFour'] as String,
    spendingLimitMinor: (json['spendingLimitMinor'] as num).toInt(),
    merchantLocked: json['merchantLocked'] as bool,
  );
}

class Vink {
  const Vink({
    required this.id,
    required this.publicCode,
    required this.purchaseCategory,
    required this.state,
    required this.requiredAmountMinor,
    required this.fundedAmountMinor,
    required this.version,
    required this.organizerUserId,
  });

  final String id;
  final String publicCode;
  final String purchaseCategory;
  final String state;
  final int requiredAmountMinor;
  final int fundedAmountMinor;
  final int version;
  final String organizerUserId;

  factory Vink.fromJson(Map<String, dynamic> json) => Vink(
    id: json['id'] as String,
    publicCode: json['publicCode'] as String,
    purchaseCategory: json['purchaseCategory'] as String,
    state: json['state'] as String,
    requiredAmountMinor: (json['requiredAmount']?['amountMinor'] as num).toInt(),
    fundedAmountMinor: (json['fundedAmount']?['amountMinor'] as num).toInt(),
    version: (json['version'] as num).toInt(),
    organizerUserId: json['organizerUserId'] as String,
  );
}

class VinkSnapshot {
  const VinkSnapshot({
    required this.vink,
    required this.participants,
    required this.unallocatedAmountMinor,
    required this.allowedActions,
    required this.card,
  });

  final Vink vink;
  final List<VinkParticipant> participants;
  final int unallocatedAmountMinor;
  final List<String> allowedActions;
  final VinkCard? card;

  factory VinkSnapshot.fromJson(Map<String, dynamic> json) => VinkSnapshot(
    vink: Vink.fromJson(json['vink'] as Map<String, dynamic>),
    participants: (json['participants'] as List<dynamic>)
        .map((entry) => VinkParticipant.fromJson(entry as Map<String, dynamic>))
        .toList(),
    unallocatedAmountMinor: (json['unallocatedAmountMinor'] as num).toInt(),
    allowedActions: (json['allowedActions'] as List<dynamic>).cast<String>(),
    card: json['card'] == null ? null : VinkCard.fromJson(json['card'] as Map<String, dynamic>),
  );
}
