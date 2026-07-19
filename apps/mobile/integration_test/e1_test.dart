// PV9 exit-gate proof: "An organizer can complete E1 entirely from the Flutter
// application" (master plan §24). Runs on a REAL iOS Simulator against the REAL local
// backend (Postgres + Redis + apps/api/src/server.ts) — no mocks. Only the organizer's own
// actions go through the app's UI; the two participants' contribution approvals and the
// merchant simulation are driven by direct HTTP calls, matching the master plan's own
// screen split (participant/guest UI is PV10, merchant simulation is PV11's ops console —
// neither is organizer-app scope). Card provisioning is NOT simulator-triggered here — it
// happens automatically via the real server's deadline sweep, proving the production
// pipeline, not a test shortcut.

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

  testWidgets('E1: organizer completes the full journey from the Flutter app', (tester) async {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final username = 'pv9_organizer_$stamp';
    final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

    // The iOS Simulator's Keychain outlives app reinstalls, so a session saved by an earlier
    // test/dev run would otherwise boot this run straight past onboarding into Home. Force a
    // clean slate so the journey below always starts from a genuinely signed-out device.
    await SecureTokenStore().clear();

    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    // --- Welcome → Register (organizer creates their own account, through the app) -----
    await tester.tap(find.text('Create an account'));
    await tester.pumpAndSettle();

    final registerFields = find.byType(TextField);
    await tester.enterText(registerFields.at(0), 'PV9 Organizer');
    await tester.enterText(registerFields.at(1), username);
    await tester.enterText(registerFields.at(2), 'integration-test-password-1');
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();

    expect(find.text('Hi, PV9 Organizer'), findsOneWidget);
    await binding.takeScreenshot('01-home-after-register');

    // --- Create Vink: category + total ---------------------------------------------
    await tester.tap(find.text('New Vink'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '60.00');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    // --- Add participants (pre-seeded demo users, PV1's seed script) ----------------
    await tester.enterText(find.byType(TextField).first, 'demo_member_1');
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'demo_member_2');
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    expect(find.text('demo_member_1'), findsOneWidget);
    expect(find.text('demo_member_2'), findsOneWidget);

    // --- Split equally & review -------------------------------------------------------
    // Organizer covers $0 (PV9 has no "approve my own contribution" UI yet — see
    // create_vink_screen.dart); the two added participants split the full $60.
    await tester.tap(find.text('Split equally & review'));
    await tester.pumpAndSettle();
    expect(find.text('\$30.00'), findsNWidgets(2));
    await binding.takeScreenshot('02-review-equal-split');

    // --- Open the Vink → lands on the live Lobby --------------------------------------
    await tester.tap(find.text('Open Vink'));
    await tester.pumpAndSettle();
    expect(find.text('\$0.00 of \$60.00 funded'), findsOneWidget);
    await binding.takeScreenshot('03-lobby-open-unfunded');

    // Pull the organizer's own access token straight from the running app's provider
    // container — the same token the Lobby's WebSocket connection is already using.
    final container = ProviderScope.containerOf(tester.element(find.byType(VinkinApp)));
    final organizerToken = (container.read(authControllerProvider) as AuthSignedIn).accessToken;
    final myVinks = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final vinkId = ((myVinks.data as Map)['vinks'] as List).first['id'] as String;

    // --- Everything from here is deliberately OUTSIDE the organizer app's own UI: -----
    // participant contribution approval (PV10 guest/participant scope) and merchant
    // simulation (PV11 ops console scope). We drive them directly against the real
    // backend and watch the ALREADY-OPEN lobby screen update live via the WebSocket.
    final member1Token = await _login(backend, 'demo_member_1', 'vinkin-demo-password');
    final member2Token = await _login(backend, 'demo_member_2', 'vinkin-demo-password');
    for (final token in [member1Token, member2Token]) {
      await backend.post(
        '/api/v1/vinks/$vinkId/contributions/authorize',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
    }

    // Poll (bounded — a live WebSocket stream never "settles") until FUNDED arrives.
    var fundedSeen = false;
    for (var i = 0; i < 40 && !fundedSeen; i++) {
      await tester.pump(const Duration(milliseconds: 250));
      fundedSeen = find.text('\$60.00 of \$60.00 funded').evaluate().isNotEmpty;
    }
    expect(fundedSeen, isTrue, reason: 'lobby should show FUNDED live, without navigating away or refreshing');
    await binding.takeScreenshot('04-lobby-funded-live');

    // Card issuance happens automatically via the REAL server's deadline sweep (every
    // SWEEP_INTERVAL_MS = 10s) — no simulator call here. BullMQ's repeatable scheduler fires
    // its first tick 10s after the *scheduler* started, not after funding, so worst-case
    // phase alignment (funding lands just after a tick) means waiting up to ~2 full sweep
    // intervals. Budget generously rather than tightly coupling the test to sweep timing.
    var cardSeen = false;
    for (var i = 0; i < 200 && !cardSeen; i++) {
      await tester.pump(const Duration(milliseconds: 250));
      cardSeen = find.text('SIMULATED CARD').evaluate().isNotEmpty;
    }
    expect(cardSeen, isTrue, reason: 'the temporary card should appear live once the sweep provisions it');
    await binding.takeScreenshot('05-lobby-card-ready-live');

    // Merchant simulation (ops-console scope, PV11) — the ops action, not organizer UI.
    final auth = await backend.post(
      '/internal/simulator/vinks/$vinkId/merchant-authorizations',
      data: {'merchantName': 'Corner Grocer', 'merchantIdentifier': 'PV9-GROCER', 'mcc': '5411', 'amountMinor': 6000},
    );
    final authorizationId = auth.data['authorizationId'] as String;
    final providerAuthorizationId = auth.data['providerAuthorizationId'] as String;
    await backend.post(
      '/internal/simulator/authorizations/$authorizationId/capture',
      data: {'vinkId': vinkId, 'providerAuthorizationId': providerAuthorizationId, 'settledAmountMinor': 6000},
    );

    var completedSeen = false;
    for (var i = 0; i < 40 && !completedSeen; i++) {
      await tester.pump(const Duration(milliseconds: 250));
      completedSeen = find.text('Completed').evaluate().isNotEmpty;
    }
    expect(completedSeen, isTrue, reason: 'the lobby should show COMPLETED live once settlement matches');
    await binding.takeScreenshot('06-lobby-completed-live');
  });
}
