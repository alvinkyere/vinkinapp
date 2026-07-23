import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Durable local persistence for the create-Vink flow's PRE-network steps (Purpose, Total —
/// ENG1 #5 "unsaved local form"). Nothing here is sensitive; this reuses
/// `flutter_secure_storage` only because it's already the app's one on-device key-value
/// store (`core/storage/secure_token_store.dart`), under its own key, so as not to add a
/// new pub dependency for one small JSON blob. Once a Vink exists server-side (`_vinkId` is
/// set), the SERVER becomes the source of truth and this store is cleared immediately —
/// the two mechanisms never overlap.
class LocalDraftStore {
  LocalDraftStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _key = 'vinkin.unsaved_create_vink_draft';

  Future<UnsavedDraft?> read() async {
    final raw = await _storage.read(key: _key);
    if (raw == null) return null;
    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      final category = json['category'] as String?;
      final totalText = json['totalText'] as String?;
      if (category == null) return null;
      // Slice I5B (D39): `purpose` is new and additive — a draft saved by the (still
      // current, flag-off) five-step wizard before this slice never has the key at all;
      // absent-vs-empty are treated identically, both read back as ''.
      final purpose = json['purpose'] as String?;
      return UnsavedDraft(category: category, totalText: totalText ?? '', purpose: purpose ?? '');
    } on FormatException {
      return null; // corrupt/old-shape value — treat as no draft rather than crashing
    }
  }

  Future<void> save(UnsavedDraft draft) => _storage.write(
    key: _key,
    value: jsonEncode({
      'category': draft.category,
      'totalText': draft.totalText,
      'purpose': draft.purpose,
    }),
  );

  Future<void> clear() => _storage.delete(key: _key);
}

class UnsavedDraft {
  const UnsavedDraft({required this.category, required this.totalText, this.purpose = ''});

  final String category;
  final String totalText;

  /// Slice I5B (D39) — empty string for the five-step wizard (which never sets one) and for
  /// any canonical draft the user hasn't typed a purpose into yet; never null, matching
  /// `totalText`'s own "empty means not entered yet" convention.
  final String purpose;
}
