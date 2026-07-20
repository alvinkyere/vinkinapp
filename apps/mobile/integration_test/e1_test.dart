// PV13 design correction exit-gate proof: the fully scripted end-to-end journey the brief
// itself specifies — organizer creates a $120 Vink, adds an existing member and a guest,
// equal split ($40 each), reviews, opens, shares the guest link, the guest joins with no
// account, all three approve their own share (organizer through the SAME contribution
// engine as everyone else — no shortcut), live progress updates without a reload, the vink
// funds, a card is issued, the merchant simulation completes it, and every client sees
// completion. Uses the GROCERY category, not the brief's own "dinner" framing — this run
// caught a real defect: RESTAURANT is offered by the backend's enum but rejected at create
// time (UNSUPPORTED_PURCHASE_CATEGORY, packages/domain/src/policy.ts's
// `restaurant_variable_policy` flag is off by default) — fixed by restricting the app's
// category picker to the three categories the backend actually accepts today
// (purchase_category.dart), same "never offer what the backend will reject" rule this
// milestone already applies to the PERCENTAGE split method. Runs on a REAL iOS Simulator
// against the REAL local backend (Postgres + Redis + apps/api/src/server.ts) — no mocks.
// The guest's own join/approve steps are driven directly against the API (guest-web's own
// PV10 Playwright suite is the UI proof for that surface); everything the ORGANIZER does
// goes through this app's real UI.

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

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('E1: organizer completes the full \$120 dinner Vink journey from the redesigned app', (tester) async {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final username = 'pv13_organizer_$stamp';
    final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

    // The iOS Simulator's Keychain outlives app reinstalls — force a genuinely signed-out
    // start so this run never rides on a previous session.
    await SecureTokenStore().clear();

    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    // --- Welcome → Register --------------------------------------------------------
    await tester.tap(find.text('CREATE AN ACCOUNT'));
    await tester.pumpAndSettle();

    final registerFields = find.byType(TextField);
    await tester.enterText(registerFields.at(0), 'Organizer');
    await tester.enterText(registerFields.at(1), username);
    await tester.enterText(registerFields.at(2), 'integration-test-password-1');
    await tester.tap(find.text('CREATE ACCOUNT'));
    await tester.pumpAndSettle();

    expect(find.text('Hi, Organizer'), findsOneWidget);
    await binding.takeScreenshot('01-home');

    // --- Create Vink: Purpose ------------------------------------------------------
    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();
    expect(find.text('What\'s this Vink for?'), findsOneWidget);
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    // --- Total -----------------------------------------------------------------------
    expect(find.text('What\'s the total?'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '120.00');
    await binding.takeScreenshot('02-enter-total');
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    // --- Add people: an existing member, then an unknown username -> guest offer -----
    expect(find.text('Who\'s in?'), findsOneWidget);
    await binding.takeScreenshot('03-add-people-empty');

    await tester.tap(find.text('ADD SOMEONE'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'demo_member_1');
    await tester.tap(find.text('ADD'));
    await tester.pumpAndSettle();
    // The people list shows the real display name the API returns, not the raw username
    // typed to look them up — matches vinkin.org's own register: never expose a technical
    // handle where a name reads more naturally.
    expect(find.text('Demo Member One'), findsOneWidget);

    await tester.tap(find.text('ADD SOMEONE'));
    await tester.pumpAndSettle();
    final unknownUsername = 'nobody_$stamp';
    await tester.enterText(find.byType(TextField).first, unknownUsername);
    await tester.tap(find.text('ADD'));
    await tester.pumpAndSettle();

    // Unknown username must never be a dead end — it offers guest, not an error page.
    expect(find.text('No VinkIn account yet'), findsOneWidget);
    expect(find.textContaining('you have to be a member'), findsNothing);
    await binding.takeScreenshot('04-unknown-username-guest-prompt');

    await tester.tap(find.text('ADD AS GUEST'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Dinner Guest');
    await tester.tap(find.text('ADD GUEST'));
    await tester.pumpAndSettle();

    // The guest is added with NO account and gets a shareable link — capture it before
    // dismissing, so this test can approve the guest's own share later exactly the way a
    // real guest would (through the API, matching guest-web's own PV10 scope for guest UI).
    final linkText = tester
        .widgetList<Text>(find.byWidgetPredicate((w) => w is Text && (w.data?.contains('/g/') ?? false)))
        .first
        .data!;
    final guestToken = Uri.parse(linkText).pathSegments.last;
    await tester.tap(find.text('DONE'));
    await tester.pumpAndSettle();

    expect(find.text('Demo Member One'), findsOneWidget);
    expect(find.text('Dinner Guest'), findsOneWidget);
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    // --- Split: Equal, organizer included — $120 / 3 = exactly $40.00 each -----------
    expect(find.text('How should everyone pay?'), findsOneWidget);
    expect(find.text('\$40.00'), findsNWidgets(3));
    await binding.takeScreenshot('05-equal-split');
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();

    // --- Review & open -----------------------------------------------------------------
    expect(find.text('Review your Vink'), findsOneWidget);
    await binding.takeScreenshot('06-review');
    await tester.tap(find.text('OPEN VINK'));
    await tester.pumpAndSettle();

    // --- Live lobby: organizer pays their OWN share through the same engine -----------
    expect(find.text('\$0.00 of \$120.00 funded'), findsOneWidget);
    expect(find.text('PAY MY \$40.00'), findsOneWidget);
    await binding.takeScreenshot('07-live-lobby-waiting');

    await tester.tap(find.text('PAY MY \$40.00'));
    await tester.pumpAndSettle();
    expect(find.text('PAY MY \$40.00'), findsNothing, reason: 'organizer already approved their own share');

    // Pull the organizer's own vink id via the app's own provider container.
    final container = ProviderScope.containerOf(tester.element(find.byType(VinkinApp)));
    final organizerToken = (container.read(authControllerProvider) as AuthSignedIn).accessToken;
    final myVinks = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final vinkId = ((myVinks.data as Map)['vinks'] as List).first['id'] as String;

    // --- The member's and the guest's own approvals — deliberately outside this app's
    // UI (member/guest UI is guest-web's PV10 scope), driven directly against the API,
    // exactly as this same journey's participant steps always have been.
    final memberToken = await _login(backend, 'demo_member_1', 'vinkin-demo-password');
    await backend.post(
      '/api/v1/vinks/$vinkId/contributions/authorize',
      options: Options(headers: {'Authorization': 'Bearer $memberToken'}),
    );
    await backend.post(
      '/api/v1/guest/contributions/authorize',
      options: Options(headers: {'Authorization': 'Bearer $guestToken'}),
    );

    var fundedSeen = false;
    for (var i = 0; i < 40 && !fundedSeen; i++) {
      await tester.pump(const Duration(milliseconds: 250));
      fundedSeen = find.text('\$120.00 of \$120.00 funded').evaluate().isNotEmpty;
    }
    expect(fundedSeen, isTrue, reason: 'the lobby should show FUNDED live, without navigating away or refreshing');

    // Card issuance happens automatically via the REAL server's deadline sweep (every
    // SWEEP_INTERVAL_MS = 10s) — no simulator shortcut here.
    var cardSeen = false;
    for (var i = 0; i < 200 && !cardSeen; i++) {
      await tester.pump(const Duration(milliseconds: 250));
      cardSeen = find.text('PILOT SIMULATION').evaluate().isNotEmpty;
    }
    expect(cardSeen, isTrue, reason: 'the card should appear live once the sweep provisions it, clearly labeled');
    await binding.takeScreenshot('08-card-ready');

    // Merchant simulation (ops-console scope) completes the purchase.
    final auth = await backend.post(
      '/internal/simulator/vinks/$vinkId/merchant-authorizations',
      data: {'merchantName': 'Corner Grocer', 'merchantIdentifier': 'PV13-GROCER', 'mcc': '5411', 'amountMinor': 12000},
    );
    final authorizationId = auth.data['authorizationId'] as String;
    final providerAuthorizationId = auth.data['providerAuthorizationId'] as String;
    await backend.post(
      '/internal/simulator/authorizations/$authorizationId/capture',
      data: {'vinkId': vinkId, 'providerAuthorizationId': providerAuthorizationId, 'settledAmountMinor': 12000},
    );

    var completedSeen = false;
    for (var i = 0; i < 40 && !completedSeen; i++) {
      await tester.pump(const Duration(milliseconds: 250));
      completedSeen = find.text('This Vink is complete. Thanks for organizing.').evaluate().isNotEmpty;
    }
    expect(completedSeen, isTrue, reason: 'the lobby should show COMPLETED live once settlement matches');
    await binding.takeScreenshot('09-completed');
  });
}
