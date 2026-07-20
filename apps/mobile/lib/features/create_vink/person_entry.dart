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
  });

  final String participantId;
  final String displayName;
  final bool isGuest;
  final bool isOrganizer;

  /// Only set for guests — the pre-minted `/g/:token` link, held locally so "Copy link
  /// again" works without re-inviting (the raw token is returned exactly once, at invite
  /// time, per D14's hashed-at-rest rule).
  final String? guestJoinUrl;
}
