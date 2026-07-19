/// Maps every API error shape (`{error, message}` from Fastify's Zod/ApplicationError/
/// DomainError handlers — apps/api/src/app.ts, modules/*/routes.ts) into one exception
/// type screens can branch on by `code`, never by parsing prose.
class ApiException implements Exception {
  const ApiException({required this.statusCode, required this.code, this.message});

  final int statusCode;
  final String code;
  final String? message;

  bool get isAuthError => statusCode == 401;

  @override
  String toString() => message ?? code;
}
