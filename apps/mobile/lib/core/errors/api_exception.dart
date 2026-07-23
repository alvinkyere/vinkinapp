/// Maps every API error shape (`{error, message}` from Fastify's Zod/ApplicationError/
/// DomainError handlers — apps/api/src/app.ts, modules/*/routes.ts) into one exception
/// type screens can branch on by `code`, never by parsing prose.
class ApiException implements Exception {
  const ApiException({required this.statusCode, required this.code, this.message});

  final int statusCode;
  final String code;
  final String? message;

  bool get isAuthError => statusCode == 401;

  /// ENG3: true for a request this app cancelled itself (screen disposed, superseded by a
  /// newer request) — never a server or network failure. A caller that still has a reference
  /// to the exception should skip error-state handling for it entirely rather than showing a
  /// message for something nobody is around to see.
  bool get isCancelled => code == 'REQUEST_CANCELLED';

  @override
  String toString() => message ?? code;
}
