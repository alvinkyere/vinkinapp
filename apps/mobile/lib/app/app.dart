import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../design_system/vink_theme.dart';
import 'deep_link_listener.dart';
import 'router.dart';

final _routerProvider = Provider<GoRouter>(buildRouter);

/// ENG3 Slice 4: a side-effect-only provider — `VinkinApp.build` watches it purely to keep
/// the listener alive for the app's lifetime, never reads a meaningful value from it. Reads
/// `_routerProvider` itself rather than taking a `GoRouter` parameter, so it's always wired
/// to the exact same router instance `MaterialApp.router` renders.
final _deepLinkListenerProvider = Provider<DeepLinkListener>((ref) {
  final listener = DeepLinkListener(ref.watch(_routerProvider));
  ref.onDispose(listener.dispose);
  return listener;
});

class VinkinApp extends ConsumerWidget {
  const VinkinApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(_routerProvider);
    ref.watch(_deepLinkListenerProvider);
    return MaterialApp.router(
      title: 'VinkIn',
      debugShowCheckedModeBanner: false,
      theme: buildVinkTheme(),
      routerConfig: router,
    );
  }
}
