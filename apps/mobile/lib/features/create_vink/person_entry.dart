/// A person added to the Vink being built — mirrors just enough of `VinkParticipant` for
/// the create-flow's own list (the server participant is the source of truth once added;
/// this is the client's working copy through steps 3–5).
class PersonEntry {
  const PersonEntry({
    required this.participantId,
    required this.displayName,
    required this.isGuest,
    required this.isOrganizer,
    this.guestJoinUrl,
    this.deliveryMode,
    this.contactDestination,
  });

  final String participantId;
  final String displayName;
  final bool isGuest;
  final bool isOrganizer;

  /// Only set for guests — the pre-minted `/g/:token` link, held locally so "Copy link
  /// again" works without re-inviting (the raw token is returned exactly once, at invite
  /// time, per D14's hashed-at-rest rule).
  final String? guestJoinUrl;

  /// Slice I5 — the guest's chosen invitation-delivery mode (`'SMS' | 'EMAIL' | 'MANUAL'`,
  /// the exact wire values `POST /vinks/:vinkId/guests` returns, I4B). Always null for the
  /// organizer and for members: a member's automatic delivery uses their own account contact
  /// info (I4) and is never a client-side choice; the organizer never receives an automatic
  /// invitation at all. Only the canonical flow's add-person sheet ever sets this — the
  /// five-step wizard's guest add never sends `deliveryMode`, so its guests default
  /// server-side to `'MANUAL'` but this field stays null on the client either way (the old
  /// flow has no use for it).
  final String? deliveryMode;

  /// Slice I5B (D40) — the guest's current phone/email, when [deliveryMode] is `SMS`/`EMAIL`
  /// (null for `MANUAL` and for every member/organizer) — held locally purely so the
  /// canonical flow's edit sheet can pre-fill it; never displayed as-is elsewhere.
  final String? contactDestination;
}
