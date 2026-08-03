import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'app/app.dart';

Future<void> main() async {
  const dsn = String.fromEnvironment('SENTRY_DSN');
  const environment = String.fromEnvironment(
    'VINKIN_ENV',
    defaultValue: 'development',
  );
  const verifySentry = bool.fromEnvironment('SENTRY_SMOKE_TEST');

  void runVinkin() => runApp(const ProviderScope(child: VinkinApp()));
  if (dsn.isEmpty) {
    runVinkin();
    return;
  }

  await SentryFlutter.init((options) {
    options.dsn = dsn;
    options.environment = environment;
    options.tracesSampleRate = 0;
    options.sendDefaultPii = false;
  }, appRunner: runVinkin);

  if (verifySentry) {
    await Sentry.captureException(
      StateError('VinkIn Flutter Sentry verification'),
    );
  }
}
