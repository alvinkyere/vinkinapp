// I7 (Phase 8 §15, D20/D24) — real-device proof that the Ink Progress vessel is driven by
// `contributionProgress`, rising per-contribution rather than jumping 0→100% at full
// resolution (the exact P0-3 regression I7 exists to fix, and the same gap D19 flagged for
// `fundedAmountMinor`). Run with `--dart-define=INK_PROGRESS_VESSEL=true`.

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:vinkin_mobile/app/app.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/networking/api_config.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';

Finder _fieldByLabel(String label) =>
    find.byWidgetPredicate((widget) => widget is TextField && widget.decoration?.labelText == label);

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Ink Progress vessel rises per-contribution, not 0->100 at the end', (tester) async {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final organizerUsername = 'vessel_organizer_$stamp';
    final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

    await SecureTokenStore().clear();

    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('CREATE AN ACCOUNT'));
    await tester.pumpAndSettle();
    await tester.enterText(_fieldByLabel('Your name'), 'Vessel Organizer');
    await tester.enterText(_fieldByLabel('Username'), organizerUsername);
    await tester.enterText(_fieldByLabel('Password (10+ characters)'), 'integration-test-password-1');
    await tester.tap(find.text('CREATE ACCOUNT'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();
    final resumeDialog = find.text('Continue your last Vink?');
    if (resumeDialog.evaluate().isNotEmpty) {
      await tester.tap(find.text('Start over'));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, '80.00');
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('ADD SOMEONE'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'demo_member_1');
    await tester.tap(find.text('ADD'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OPEN VINK'));
    await tester.pumpAndSettle();

    // The vessel's own headline replaces the old "funded" copy.
    expect(find.text(r'$0.00 of $80.00 ready'), findsOneWidget);
    await binding.takeScreenshot('vessel-01-empty');

    await tester.tap(find.text('PAY MY \$40.00'));
    await tester.pumpAndSettle();

    // The organizer's own confirmation alone already moves the vessel — proving a real,
    // incremental rise exists (the exact thing fundedAmountMinor, per D19, cannot show).
    expect(
      find.text(r'$40.00 of $80.00 ready'),
      findsOneWidget,
      reason: r'rose after ONE confirmation, not stuck at $0',
    );
    await binding.takeScreenshot('vessel-02-half');

    final container = ProviderScope.containerOf(tester.element(find.byType(VinkinApp)));
    final organizerToken = (container.read(authControllerProvider) as AuthSignedIn).accessToken;
    final myVinks = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final vinkId = ((myVinks.data as Map)['vinks'] as List).first['id'] as String;

    final memberResponse = await backend.post(
      '/api/v1/auth/login',
      data: {'username': 'demo_member_1', 'password': 'vinkin-demo-password'},
    );
    final memberToken = memberResponse.data['accessToken'] as String;
    await backend.post(
      '/api/v1/vinks/$vinkId/contributions/authorize',
      options: Options(headers: {'Authorization': 'Bearer $memberToken'}),
    );

    var fullySeen = false;
    for (var i = 0; i < 40 && !fullySeen; i++) {
      await tester.pump(const Duration(milliseconds: 250));
      fullySeen = find.text(r'$80.00 of $80.00 ready').evaluate().isNotEmpty;
    }
    expect(fullySeen, isTrue, reason: 'the vessel should reach full, live, without navigating away');
    await binding.takeScreenshot('vessel-03-full');
  });
}
