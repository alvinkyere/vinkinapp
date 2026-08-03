/// Invites feature (D44, 2026-07-23) — a Vink this signed-in user has been added to but not
/// yet accepted or declined. The wire shape mirrors `packages/application/src/invites.ts`'s
/// `PendingInvite` exactly (`GET /api/v1/invites`).
class PendingInvite {
  const PendingInvite({
    required this.vinkId,
    required this.purpose,
    required this.purchaseCategory,
    required this.organizerDisplayName,
    required this.assignedShareMinor,
    required this.invitedAt,
  });

  final String vinkId;
  final String? purpose;
  final String purchaseCategory;
  final String organizerDisplayName;
  final int assignedShareMinor;
  final DateTime invitedAt;

  factory PendingInvite.fromJson(Map<String, dynamic> json) => PendingInvite(
    vinkId: json['vinkId'] as String,
    purpose: json['purpose'] as String?,
    purchaseCategory: json['purchaseCategory'] as String,
    organizerDisplayName: json['organizerDisplayName'] as String,
    assignedShareMinor: (json['assignedShareMinor'] as num).toInt(),
    invitedAt: DateTime.parse(json['invitedAt'] as String),
  );
}
