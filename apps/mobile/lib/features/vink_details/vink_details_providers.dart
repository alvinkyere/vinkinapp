import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models/vink.dart';
import '../../core/repositories/vink_repository.dart';

/// Slice I6 — `GET /api/v1/vinks/:vinkId/details` (D29/D31 "Vink details," never "receipt").
/// Family provider (one instance per `vinkId`, `.autoDispose` so a screen that's popped
/// releases its own fetch rather than caching every Vink ever viewed for the app's lifetime).
final vinkDetailsProvider = FutureProvider.autoDispose
    .family<VinkDetailsView, String>((ref, vinkId) {
      return ref.read(vinkRepositoryProvider).getDetails(vinkId);
    });
