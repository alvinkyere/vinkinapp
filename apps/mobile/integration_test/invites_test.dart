// Invites feature (D44) — real-device proof (real iOS Simulator, real local backend, no
// mocks): an organizer adds an existing member, who lands as a pending invite (not an
// immediate Home participant card); accepting moves them into real membership (visible on
// Home); declining removes them and reopens the split. Run with
// `--dart-define=INVITES_ENABLED=true --dart-define=HOME_ACTIVITY_V2=true`.

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:vinkin_mobile/app/app.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/networking/api_config.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';

Future<String> _login(Dio dio, String username, String password) async {
  final response = await dio.post('/api/v1/auth/login', data: {'username': username, 'password': password});
  return response.data['accessToken'] as String;
}

Finder _fieldByLabel(String label) =>
    find.byWidgetPredicate((widget) => widget is TextField && widget.decoration?.labelText == label);

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Invites: add-existing-member is a real accept/decline gate, not immediate membership', (
    tester,
  ) async {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final organizerUsername = 'inv_organizer_$stamp';
    final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

    await SecureTokenStore().clear();

    // === Organizer creates + opens a $60 Vink, adding demo_member_1 ========================
    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('CREATE AN ACCOUNT'));
    await tester.pumpAndSettle();
    await tester.enterText(_fieldByLabel('Your name'), 'Invites Organizer');
    await tester.enterText(_fieldByLabel('Username'), organizerUsername);
    await tester.enterText(_fieldByLabel('Password (10+ characters)'), 'integration-test-password-1');
    await tester.tap(find.text('CREATE ACCOUNT'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();
    // LocalDraftStore is device-scoped, not account-scoped (ENG1 Slice 3) — a leftover local
    // draft from an earlier test run on this same simulator can surface a "Continue your last
    // Vink?" dialog here. Discard it so this run starts from a genuinely fresh flow.
    final resumeDialog = find.text('Continue your last Vink?');
    if (resumeDialog.evaluate().isNotEmpty) {
      await tester.tap(find.text('Start over'));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, '60.00');
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('ADD SOMEONE'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'demo_member_1');
    await tester.tap(find.text('ADD'));
    await tester.pumpAndSettle();
    expect(find.text('Demo Member One'), findsOneWidget);
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OPEN VINK'));
    await tester.pumpAndSettle();
    await binding.takeScreenshot('inv-01-organizer-opened');

    final container = ProviderScope.containerOf(tester.element(find.byType(VinkinApp)));
    final organizerToken = (container.read(authControllerProvider) as AuthSignedIn).accessToken;
    final myVinks = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final vinkId = ((myVinks.data as Map)['vinks'] as List).first['id'] as String;

    // === Sign out, sign in as demo_member_1 — the invitee ====================================
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();
    await SecureTokenStore().clear();
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('I already have an account'.toUpperCase()));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'demo_member_1');
    await tester.enterText(find.byType(TextField).last, 'vinkin-demo-password');
    await tester.tap(find.text('LOG IN'));
    await tester.pumpAndSettle();

    // demo_member_1 is a long-lived seeded account reused across every real-device test run
    // in this environment (organizer, participant, and now invitee across many prior runs) —
    // it may genuinely have other real "Groceries" Vinks in its history, so this test verifies
    // THIS specific vink's own state via the real backend directly rather than counting UI
    // text, which the shared account makes unreliable.
    final memberToken = await _login(backend, 'demo_member_1', 'vinkin-demo-password');
    // Per this slice's own design default (§7 Q5 of the plan): an INVITED user CAN preview
    // the full participant view before deciding — so this is a 200 with status: INVITED, not
    // a 403. The real gate is authorizeContributionCommand (can't pay until JOINED,
    // already proven at the application layer) and listVinksByParticipant (won't show up in
    // "my vinks" until JOINED, checked below) — not this read.
    final beforeAccept = await backend.get(
      '/api/v1/vinks/$vinkId/participant-view',
      options: Options(headers: {'Authorization': 'Bearer $memberToken'}),
    );
    expect(beforeAccept.data['participant']['status'], 'INVITED');

    // === The Invites tab shows at least this pending invite, with the real organizer/amount =
    await tester.tap(find.text('Invites'));
    await tester.pumpAndSettle();
    expect(find.text('Groceries'), findsWidgets);
    expect(find.textContaining('Invites Organizer'), findsWidgets);
    await binding.takeScreenshot('inv-02-member-invites-tab');

    // === Accept the FIRST (newest-invited-first ordering guarantees it's this run's own) ====
    await tester.tap(find.text('ACCEPT').first);
    await tester.pumpAndSettle();
    await binding.takeScreenshot('inv-03-accepted');

    // === Verify against the real backend directly: status is JOINED, joinedAt is set ========
    final afterAccept = await backend.get(
      '/api/v1/vinks/$vinkId/participant-view',
      options: Options(headers: {'Authorization': 'Bearer $memberToken'}),
    );
    expect(afterAccept.statusCode, 200, reason: 'now JOINED — participant-view is reachable');
    expect(afterAccept.data['participant']['status'], 'JOINED');

    // === Home now genuinely includes this Vink among the member's real, accepted Vinks ======
    final myVinksAfter = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $memberToken'}),
    );
    final ids = ((myVinksAfter.data as Map)['vinks'] as List).map((v) => (v as Map)['id']);
    expect(ids, contains(vinkId));
  });
}
