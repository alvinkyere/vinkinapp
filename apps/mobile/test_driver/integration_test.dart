// Resolves the gap PV13's own milestone report flagged: `flutter test -d <device>`'s
// `takeScreenshot()` captures pixels but never persists them without a driver consuming the
// `integration_test` package's screenshot channel. `flutter drive` + this driver does —
// `onScreenshot` receives each named capture's raw PNG bytes and writes them to
// `artifacts/product-screenshots/raw/`, exactly where the screenshot plan expects them.
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() => integrationDriver(
  onScreenshot: (String screenshotName, List<int> screenshotBytes, [Map<String, Object?>? args]) async {
    final file = File('../../artifacts/product-screenshots/raw/$screenshotName.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(screenshotBytes, flush: true);
    return true;
  },
);
