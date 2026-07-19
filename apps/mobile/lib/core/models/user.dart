/// Mirrors `apps/api/src/modules/auth/service.ts` `PublicUser`. Hand-written (no codegen,
/// PV9 scope note in pubspec.yaml) — the API surface is small enough that this stays cheap.
class VinkinUser {
  const VinkinUser({required this.id, required this.username, required this.displayName, this.email});

  final String id;
  final String username;
  final String displayName;
  final String? email;

  factory VinkinUser.fromJson(Map<String, dynamic> json) => VinkinUser(
    id: json['id'] as String,
    username: json['username'] as String,
    displayName: json['displayName'] as String,
    email: json['email'] as String?,
  );
}
