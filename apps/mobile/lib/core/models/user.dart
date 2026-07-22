/// Mirrors `apps/api/src/modules/auth/service.ts` `PublicUser`. Hand-written (no codegen,
/// PV9 scope note in pubspec.yaml) — the API surface is small enough that this stays cheap.
class VinkinUser {
  const VinkinUser({
    required this.id,
    required this.username,
    required this.displayName,
    this.email,
    this.phone,
  });

  final String id;
  final String username;
  final String displayName;
  final String? email;

  /// Slice I4 (D19/D27) — mirrors `PublicUser.phone`, wired into the backend since this
  /// slice; `users.phone` itself existed since PV1 but was never surfaced anywhere before.
  final String? phone;

  factory VinkinUser.fromJson(Map<String, dynamic> json) => VinkinUser(
    id: json['id'] as String,
    username: json['username'] as String,
    displayName: json['displayName'] as String,
    email: json['email'] as String?,
    phone: json['phone'] as String?,
  );
}
