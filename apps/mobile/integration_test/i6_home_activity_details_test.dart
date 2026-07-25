// Slice I6 — real-device proof (real iOS Simulator, real local Postgres + Redis +
// apps/api/src/server.ts, no mocks) that Home's two-section redesign, Activity's
// outcome-summary list, and the new Vink Details screen work end to end, and that the D43
// privacy correction actually holds on a real render: an organizer sees only the aggregate
// summary, a participant sees only their own share, and a mixed-role account's Activity tab
// never crashes. Run with `--dart-define=HOME_ACTIVITY_V2=true` (FeatureFlags.homeActivityV2
// gates the tab-bar Home/Activity screens onto the new UI; router.dart's own
// `/activity/:vinkId` Vink Details route is unconditionally reachable).

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
  final response = await dio.post(
    '/api/v1/auth/login',
    data: {'username': username, 'password': password},
  );
  return response.data['accessToken'] as String;
}

Finder _fieldByLabel(String label) => find.byWidgetPredicate(
  (widget) => widget is TextField && widget.decoration?.labelText == label,
);

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('I6: organizer Home->Activity->Vink Details (aggregate-only), participant Home->Activity->'
      'Vink Details (own-data-only), and a mixed-role Activity tab that never crashes', (tester) async {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final organizerUsername = 'i6_organizer_$stamp';
    final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

    await SecureTokenStore().clear();

    // === Organizer creates + opens a $60 Vink split with demo_member_1 ($30 each) =========
    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('CREATE AN ACCOUNT'));
    await tester.pumpAndSettle();
    await tester.enterText(_fieldByLabel('Your name'), 'I6 Organizer');
    await tester.enterText(_fieldByLabel('Username'), organizerUsername);
    await tester.enterText(
      _fieldByLabel('Password (10+ characters)'),
      'integration-test-password-1',
    );
    await tester.tap(find.text('CREATE ACCOUNT'));
    await tester.pumpAndSettle();

    // R0: no persistent tagline/greeting on signed-in Home.
    expect(find.textContaining('Everyone in'), findsNothing);
    expect(find.textContaining('Hi, '), findsNothing);
    await binding.takeScreenshot('i6-01-home-empty');

    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    expect(find.text('What\'s the total?'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '60.00');
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

    await tester.tap(find.text('PAY MY \$30.00'));
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(VinkinApp)),
    );
    final organizerToken =
        (container.read(authControllerProvider) as AuthSignedIn).accessToken;
    final myVinks = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final vinkId =
        ((myVinks.data as Map)['vinks'] as List).first['id'] as String;

    // === Home: back to the tab, organizer's own paid Vink now waits on the member =========
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Waiting on others'), findsOneWidget);
    expect(
      find.text('Organizer'),
      findsOneWidget,
      reason: 'the role distinction on the card',
    );
    await binding.takeScreenshot('i6-02-organizer-home-waiting');

    // === Activity: not terminal yet — no outcome row for this Vink ==========================
    await tester.tap(find.text('Activity'));
    await tester.pumpAndSettle();
    expect(
      find.text('Groceries'),
      findsNothing,
      reason: 'an OPEN Vink has no outcome yet',
    );
    await binding.takeScreenshot('i6-03-organizer-activity-empty');

    // === The member pays, then the merchant simulation completes the purchase (backend) ====
    final memberToken = await _login(
      backend,
      'demo_member_1',
      'vinkin-demo-password',
    );
    await backend.post(
      '/api/v1/vinks/$vinkId/contributions/authorize',
      options: Options(headers: {'Authorization': 'Bearer $memberToken'}),
    );

    var funded = false;
    for (var i = 0; i < 40 && !funded; i++) {
      final snapshot = await backend.get(
        '/api/v1/vinks/$vinkId',
        options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
      );
      funded = (snapshot.data['vink']['state'] as String) != 'OPEN';
      if (!funded)
        await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    expect(
      funded,
      isTrue,
      reason: 'the vink should leave OPEN once both shares are in',
    );

    var cardReady = false;
    String? authorizationId;
    for (var i = 0; i < 60 && !cardReady; i++) {
      final snapshot = await backend.get(
        '/api/v1/vinks/$vinkId',
        options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
      );
      cardReady = snapshot.data['vink']['state'] == 'CARD_READY';
      if (!cardReady)
        await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    expect(
      cardReady,
      isTrue,
      reason: 'the deadline sweep should provision a card',
    );

    final auth = await backend.post(
      '/internal/simulator/vinks/$vinkId/merchant-authorizations',
      data: {
        'merchantName': 'Corner Grocer',
        'merchantIdentifier': 'I6-GROCER',
        'mcc': '5411',
        'amountMinor': 6000,
      },
    );
    authorizationId = auth.data['authorizationId'] as String;
    final providerAuthorizationId =
        auth.data['providerAuthorizationId'] as String;
    await backend.post(
      '/internal/simulator/authorizations/$authorizationId/capture',
      data: {
        'vinkId': vinkId,
        'providerAuthorizationId': providerAuthorizationId,
        'settledAmountMinor': 6000,
      },
    );

    var completed = false;
    for (var i = 0; i < 40 && !completed; i++) {
      final snapshot = await backend.get(
        '/api/v1/vinks/$vinkId',
        options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
      );
      completed = snapshot.data['vink']['state'] == 'COMPLETED';
      if (!completed)
        await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    expect(completed, isTrue, reason: 'the vink should settle to COMPLETED');

    // === Organizer: Activity now shows the outcome row; Home excludes the terminal Vink ====
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(RefreshIndicator), const Offset(0, 300));
    await tester.pumpAndSettle();
    expect(
      find.text('Nothing active right now'),
      findsOneWidget,
      reason: 'the completed Vink is excluded',
    );
    await binding.takeScreenshot('i6-04-organizer-home-empty-after-completion');

    await tester.tap(find.text('Activity'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(RefreshIndicator), const Offset(0, 300));
    await tester.pumpAndSettle();
    expect(find.text('Groceries'), findsOneWidget);
    await binding.takeScreenshot('i6-05-organizer-activity-completed');

    // === Organizer Vink Details: aggregate-only, D31/D43 =====================================
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    expect(find.text('You organized this Vink'), findsOneWidget);
    expect(find.textContaining('2 of 2 paid'), findsOneWidget);
    expect(
      find.text('Demo Member One'),
      findsNothing,
      reason: 'D43: no per-participant breakdown for the organizer',
    );
    expect(
      find.textContaining('eceipt'),
      findsNothing,
      reason: 'D31: never "receipt"',
    );
    await binding.takeScreenshot('i6-06-organizer-vink-details');

    // === Sign out, sign in as the member — the participant-safe view ========================
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

    await tester.tap(find.text('Activity'));
    await tester.pumpAndSettle();
    // demo_member_1 is a long-lived seeded account reused across every real-device test run
    // in this environment — its Activity list carries prior runs' own completed "Groceries"
    // vinks too, so this asserts at least one (not exactly one) and taps the FIRST, which
    // `vinkOutcomesProvider`'s own "newest first" ordering guarantees is the one just
    // completed above.
    expect(find.text('Groceries'), findsWidgets);
    await binding.takeScreenshot('i6-07-participant-activity');

    await tester.tap(find.text('Groceries').first);
    await tester.pumpAndSettle();
    expect(find.text('Organized by I6 Organizer'), findsOneWidget);
    expect(find.text('You organized this Vink'), findsNothing);
    expect(find.textContaining('eceipt'), findsNothing);
    await binding.takeScreenshot('i6-08-participant-vink-details');

    // === Mixed-role: this same account creates a second, still-OPEN Vink as organizer, ======
    // proving Activity (one terminal participant-role entry already loaded) and Home (a new
    // organizer-role active entry) both render without crashing for a genuinely mixed
    // account.
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '20.00');
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    // A solo (organizer-only) Vink is rejected client-side ("Add at least one other person
    // before continuing.") — add one guest so this second Vink can actually open.
    await tester.tap(find.text('ADD SOMEONE'));
    await tester.pumpAndSettle();
    final unknownUsername = 'i6_mixed_role_nobody_$stamp';
    await tester.enterText(find.byType(TextField).first, unknownUsername);
    await tester.tap(find.text('ADD'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ADD AS GUEST'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Mixed Role Guest');
    await tester.tap(find.text('ADD GUEST'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DONE'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OPEN VINK'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pumpAndSettle();

    expect(
      find.text('Organizer'),
      findsWidgets,
      reason: 'the new Vink, organizer-role, renders on Home',
    );
    await binding.takeScreenshot('i6-09-mixed-role-home');

    await tester.tap(find.text('Activity'));
    await tester.pumpAndSettle();
    expect(
      find.text("Couldn't load activity."),
      findsNothing,
      reason: 'a mixed-role account never crashes Activity',
    );
    expect(find.textContaining("couldn't load"), findsNothing);
    expect(
      find.text('Groceries'),
      findsWidgets,
      reason: 'the earlier participant-role completed Vink still shows',
    );
    await binding.takeScreenshot('i6-10-mixed-role-activity');
  });
}
