/// Mirrors `ActivityEntry` from packages/application/src/ports.ts — `detail` is a raw
/// jsonb blob (`{eventType, ...payload}`), interpreted into human copy by
/// `features/activity/activity_copy.dart`, never shown to a user as-is.
class ActivityEntry {
  const ActivityEntry({required this.kind, required this.at, required this.detail});

  final String kind;
  final DateTime at;
  final Map<String, dynamic> detail;

  String? get eventType => detail['eventType'] as String?;

  factory ActivityEntry.fromJson(Map<String, dynamic> json) => ActivityEntry(
    kind: json['kind'] as String,
    at: DateTime.parse(json['at'] as String),
    detail: json['detail'] as Map<String, dynamic>,
  );
}
