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
    this.guestIdentityId,
  });

  final String id;
  final String displayName;
  final String role;
  final String status;
  final int allocatedAmountMinor;

  /// Non-null exactly when this participant joined without a VinkIn account (PV4/PV13) —
  /// the domain's own invariant (packages/domain/src/entities.ts) is "exactly one of
  /// userId or guestIdentityId," so this alone is enough to tell guest from member.
  final String? guestIdentityId;

  bool get isGuest => guestIdentityId != null;
  bool get isOrganizer => role == 'ORGANIZER';

  factory VinkParticipant.fromJson(Map<String, dynamic> json) =>
      VinkParticipant(
        id: json['id'] as String,
        displayName: json['displayName'] as String,
        role: json['role'] as String,
        status: json['status'] as String,
        allocatedAmountMinor:
            (json['allocatedAmount']?['amountMinor'] as num?)?.toInt() ?? 0,
        guestIdentityId: json['guestIdentityId'] as String?,
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
    this.submissionDeadline,
    this.role,
    this.purpose,
  });

  final String id;
  final String publicCode;

  /// Slice I5B (D39) — human-readable payment context; null for a Vink that never had one
  /// (every pre-I5B Vink, and every Vink the five-step wizard still creates). Callers apply
  /// their own customer-safe fallback (e.g. [purchaseCategory]'s own label) when null.
  final String? purpose;
  final String purchaseCategory;
  final String state;
  final int requiredAmountMinor;
  final int fundedAmountMinor;
  final int version;
  final String organizerUserId;
  final DateTime? submissionDeadline;

  /// Slice I2B, additive: present on `GET /api/v1/vinks` entries once
  /// `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL` is on server-side — `'organizer'` or
  /// `'participant'`. Absent (null) for every pre-I2B caller and whenever the flag is off,
  /// which this model treats identically to `'organizer'` (today's only possible value) —
  /// see [isOrganizerRole].
  final String? role;

  /// Defaults to organizer when [role] is absent — the exact pre-I2B assumption, since every
  /// vink `GET /api/v1/vinks` could ever return before this slice was organizer-owned.
  bool get isOrganizerRole => role != 'participant';

  factory Vink.fromJson(Map<String, dynamic> json) => Vink(
    id: json['id'] as String,
    publicCode: json['publicCode'] as String,
    purchaseCategory: json['purchaseCategory'] as String,
    state: json['state'] as String,
    requiredAmountMinor: (json['requiredAmount']?['amountMinor'] as num)
        .toInt(),
    fundedAmountMinor: (json['fundedAmount']?['amountMinor'] as num).toInt(),
    version: (json['version'] as num).toInt(),
    organizerUserId: json['organizerUserId'] as String,
    submissionDeadline: json['submissionDeadline'] == null
        ? null
        : DateTime.parse(json['submissionDeadline'] as String),
    role: json['role'] as String?,
    purpose: json['purpose'] as String?,
  );
}

/// Slice I2B — the customer-safe counterpart to [VinkSnapshot] for a signed-in participant
/// who isn't the organizer. Mirrors `packages/application/src/guest.ts`'s
/// `ParticipantVinkView` wire shape exactly (itself the authenticated-member twin of the
/// already-shipped `GuestVinkView`).
class ParticipantVinkSummary {
  const ParticipantVinkSummary({
    required this.purchaseCategory,
    required this.state,
    required this.requiredAmountMinor,
    required this.confirmedAmountMinor,
    required this.confirmedParticipantCount,
    required this.totalParticipantCount,
    required this.vinkOutcome,
  });

  final String purchaseCategory;
  final String state;
  final int requiredAmountMinor;
  final int confirmedAmountMinor;
  final int confirmedParticipantCount;
  final int totalParticipantCount;

  /// D25's six-way guest-safe outcome category, reused as-is for a signed-in participant —
  /// the categorization is identity-agnostic (state + own contribution status only).
  final String vinkOutcome;

  factory ParticipantVinkSummary.fromJson(
    Map<String, dynamic> json,
  ) => ParticipantVinkSummary(
    purchaseCategory: json['purchaseCategory'] as String,
    state: json['state'] as String,
    requiredAmountMinor: (json['requiredAmountMinor'] as num).toInt(),
    confirmedAmountMinor:
        (json['contributionProgress']['confirmedAmountMinor'] as num).toInt(),
    confirmedParticipantCount:
        (json['contributionProgress']['confirmedParticipantCount'] as num)
            .toInt(),
    totalParticipantCount:
        (json['contributionProgress']['totalParticipantCount'] as num).toInt(),
    vinkOutcome: json['vinkOutcome'] as String,
  );
}

class ParticipantSelf {
  const ParticipantSelf({
    required this.displayName,
    required this.allocatedAmountMinor,
    required this.contributionStatus,
  });

  final String displayName;
  final int allocatedAmountMinor;

  /// D24/D25's eight-value guest-safe contribution status, reused as-is.
  final String contributionStatus;

  factory ParticipantSelf.fromJson(Map<String, dynamic> json) =>
      ParticipantSelf(
        displayName: json['displayName'] as String,
        allocatedAmountMinor: (json['allocatedAmountMinor'] as num).toInt(),
        contributionStatus: json['contributionStatus'] as String,
      );
}

class ParticipantVinkView {
  const ParticipantVinkView({required this.vink, required this.participant});

  final ParticipantVinkSummary vink;
  final ParticipantSelf participant;

  factory ParticipantVinkView.fromJson(Map<String, dynamic> json) =>
      ParticipantVinkView(
        vink: ParticipantVinkSummary.fromJson(
          json['vink'] as Map<String, dynamic>,
        ),
        participant: ParticipantSelf.fromJson(
          json['participant'] as Map<String, dynamic>,
        ),
      );
}

class VinkSnapshot {
  const VinkSnapshot({
    required this.vink,
    required this.participants,
    required this.unallocatedAmountMinor,
    required this.allowedActions,
    required this.card,
    this.contributionStatusByParticipant = const {},
  });

  final Vink vink;
  final List<VinkParticipant> participants;
  final int unallocatedAmountMinor;
  final List<String> allowedActions;
  final VinkCard? card;

  /// Each participant's most recent contribution attempt's raw status (Contribution
  /// ['status'] — CREATED/AUTHORIZED/CAPTURED/etc.), keyed by participant id. Absence
  /// means no attempt yet. See `features/vink_lobby/participant_payment_state.dart` for the
  /// human "paid / processing / waiting" projection this feeds.
  final Map<String, String> contributionStatusByParticipant;

  factory VinkSnapshot.fromJson(Map<String, dynamic> json) => VinkSnapshot(
    vink: Vink.fromJson(json['vink'] as Map<String, dynamic>),
    participants: (json['participants'] as List<dynamic>)
        .map((entry) => VinkParticipant.fromJson(entry as Map<String, dynamic>))
        .toList(),
    unallocatedAmountMinor: (json['unallocatedAmountMinor'] as num).toInt(),
    allowedActions: (json['allowedActions'] as List<dynamic>).cast<String>(),
    card: json['card'] == null
        ? null
        : VinkCard.fromJson(json['card'] as Map<String, dynamic>),
    contributionStatusByParticipant: {
      for (final entry in (json['contributions'] as List<dynamic>? ?? const []))
        (entry as Map<String, dynamic>)['participantId'] as String:
            entry['status'] as String,
    },
  );
}
