import 'dart:math';

/// A client-generated key for a single mutating attempt (ENG1 #4 — idempotent Vink
/// creation): generate once per attempt, reuse across retries of that same attempt, and
/// throw it away once the attempt succeeds. No `uuid` package dependency needed — 128 bits
/// of `Random.secure()` entropy is exactly as collision-resistant as a real UUIDv4 for this
/// purpose, just not formatted like one.
String newIdempotencyKey() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  return bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
}
