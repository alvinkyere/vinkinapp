// Slice I2C — real-device proof that a signed-in participant's own Lobby view now updates
// live, closing the gap Slice I2B's own completion report flagged as out of scope ("wiring
// participant realtime is out of I2B's scope"). Deliberately narrow, like
// canonical_create_test.dart's own relationship to e1_test.dart: this test's only job is
// proving the realtime channel genuinely reaches a participant (not the organizer) and that
// the Lobby screen renders and updates from it — full funding/settlement is already proven,
// repeatedly, by e1_test.dart. Requires the real local backend started with
// VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL=1 in addition to the usual CORS env vars.

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:vinkin_mobile/app/app.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/networking/api_config.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('I2C: a participant sees the Lobby update live, with no manual reload', (tester) async {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final organizerUsername = 'i2c_organizer_$stamp';
    final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

    await SecureTokenStore().clear();

    // --- Organizer creates and opens an $80 Vink split with the seeded demo member ---------
    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('CREATE AN ACCOUNT'));
    await tester.pumpAndSettle();
    final registerFields = find.byType(TextField);
    await tester.enterText(registerFields.at(0), 'I2C Organizer');
    await tester.enterText(registerFields.at(1), organizerUsername);
    await tester.enterText(registerFields.at(4), 'integration-test-password-1');
    await tester.tap(find.text('CREATE ACCOUNT'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    expect(find.text('What\'s the total?'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '80.00');
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    expect(find.text('Who\'s in?'), findsOneWidget);
    await tester.tap(find.text('ADD SOMEONE'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'demo_member_1');
    await tester.tap(find.text('ADD'));
    await tester.pumpAndSettle();
    expect(find.text('Demo Member One'), findsOneWidget);
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    expect(find.text('How should everyone pay?'), findsOneWidget);
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    expect(find.text('Review your Vink'), findsOneWidget);
    await tester.tap(find.text('OPEN VINK'));
    await tester.pumpAndSettle();
    await binding.takeScreenshot('i2c-01-organizer-opened');

    final container = ProviderScope.containerOf(tester.element(find.byType(VinkinApp)));
    final organizerToken = (container.read(authControllerProvider) as AuthSignedIn).accessToken;
    final myVinks = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final vinkId = ((myVinks.data as Map)['vinks'] as List).first['id'] as String;

    // --- Sign out, sign back in as the member — the ONE with something to reach here --------
    await SecureTokenStore().clear();
    // Pumping the identical `const ProviderScope(child: VinkinApp())` widget a second time
    // would just diff against the current element tree (same const instance) and keep it
    // mounted — the old ProviderScope's state (AuthController's cached AuthSignedIn, the
    // router's current /vinks/:id location) would survive untouched. Unmounting with a
    // throwaway widget first forces a genuine teardown, so the app that comes back up is a
    // truly fresh instance — the closest a widget test gets to a real relaunch.
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

    // --- Home's participant-role card leads into the Lobby's participant branch -------------
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    await binding.takeScreenshot('i2c-02-participant-lobby');

    // Renders from the live `snapshot` message (or the parallel HTTP fetch, whichever wins) —
    // not stuck on "Loading…" indefinitely, and never the organizer's own scaffold.
    expect(find.text('0 of 2 paid'), findsOneWidget);
    expect(find.text('Your share'), findsOneWidget);

    // --- The organizer pays their own share from OUTSIDE this app instance — the direct
    // proof this participant's OWN Lobby updates live, with no reload/navigation of any kind.
    await backend.post(
      '/api/v1/vinks/$vinkId/contributions/authorize',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );

    var updatedSeen = false;
    for (var i = 0; i < 40 && !updatedSeen; i++) {
      await tester.pump(const Duration(milliseconds: 250));
      updatedSeen = find.text('1 of 2 paid').evaluate().isNotEmpty;
    }
    expect(
      updatedSeen,
      isTrue,
      reason: 'the participant Lobby should reflect the organizer\'s contribution live, with no manual reload',
    );
    await binding.takeScreenshot('i2c-03-participant-lobby-live-update');
  });
}
