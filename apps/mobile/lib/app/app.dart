import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../design_system/vink_theme.dart';
import 'router.dart';

final _routerProvider = Provider<GoRouter>(buildRouter);

class VinkinApp extends ConsumerWidget {
  const VinkinApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(_routerProvider);
    return MaterialApp.router(
      title: 'VinkIn',
      debugShowCheckedModeBanner: false,
      theme: buildVinkTheme(),
      routerConfig: router,
    );
  }
}
