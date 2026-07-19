import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/models/vink.dart';

final myVinksProvider = FutureProvider.autoDispose<List<Vink>>((ref) async {
  final client = ref.read(apiClientProvider);
  final response = await client.get('/api/v1/vinks');
  return (response['vinks'] as List<dynamic>).map((entry) => Vink.fromJson(entry as Map<String, dynamic>)).toList();
});
