// ENG1 Slice 3 exit-gate proof: server-persisted setup resumes at its exact valid step after
// a relaunch, and an unsaved local form (pre-network) is offered back as resume-or-discard
// rather than silently lost. Runs on a REAL iOS Simulator against the REAL local backend
// (Postgres + Redis + apps/api/src/server.ts) — no mocks. A relaunch can't literally be
// simulated from inside one test process (the OS never tears the app down), so each scenario
// re-pumps a fresh `VinkinApp()` widget tree — every provider re-constructed from scratch,
// nothing carried over except what's actually durable (the signed-in session in Keychain,
// the Vink in Postgres) — which is the part this slice is actually about proving.

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:vinkin_mobile/app/app.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/networking/api_config.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';
import 'package:vinkin_mobile/features/create_vink/local_draft_store.dart';

Future<void> _relaunch(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink()); // tear the old tree down first
  await tester.pumpAndSettle();
  await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
  await tester.pumpAndSettle();
}

/// A relaunch involves real async work below `pumpAndSettle`'s radar (restoring the session
/// from Keychain, then fetching Active Vinks from the real API) — bounded polling, not a
/// single settle, is what actually proves the screen gets there rather than racing it.
Future<void> _pumpUntilFound(WidgetTester tester, Finder finder, {int maxTries = 60}) async {
  for (var i = 0; i < maxTries; i++) {
    if (finder.evaluate().isNotEmpty) return;
    await tester.pump(const Duration(milliseconds: 250));
  }
  expect(finder, findsOneWidget); // give a real failure with the usual diagnostic output
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('ENG1 #5: a server-persisted DRAFT setup resumes at its exact valid step after relaunch', (
    tester,
  ) async {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final username = 'eng1s3_organizer_$stamp';
    final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

    await SecureTokenStore().clear();
    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();
    // On a freshly erased simulator, google_fonts fetches and caches BricolageGrotesque
    // asynchronously on first use; text briefly renders in a fallback font, then relayouts
    // once the real font lands, which pumpAndSettle can return before observing — leaving
    // subsequent tap() calls aimed at coordinates the button has since moved off of. Give it
    // room to finish before the first real interaction.
    await tester.pump(const Duration(seconds: 2));

    await tester.tap(find.text('CREATE AN ACCOUNT'));
    await tester.pumpAndSettle();
    final registerFields = find.byType(TextField);
    await tester.enterText(registerFields.at(0), 'Organizer');
    await tester.enterText(registerFields.at(1), username);
    await tester.enterText(registerFields.at(2), 'integration-test-password-1');
    await tester.tap(find.text('CREATE ACCOUNT'));
    await tester.pumpAndSettle();

    // Start a Vink, add one other person, but deliberately DON'T finish the split — this is
    // the interrupted-mid-setup state a relaunch has to recover from correctly.
    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Groceries'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '90.00');
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    expect(find.text('Who\'s in?'), findsOneWidget, reason: 'the Vink now exists server-side as DRAFT');

    await tester.tap(find.text('ADD SOMEONE'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'demo_member_1');
    await tester.tap(find.text('ADD'));
    await tester.pumpAndSettle();
    expect(find.text('Demo Member One'), findsOneWidget);

    // Simulate the app being killed right here — mid-setup, split never submitted — and
    // relaunched. Nothing survives except the signed-in session and whatever is in Postgres.
    await _relaunch(tester);

    // VinkSecondaryButton renders its label uppercased (design_system/components/
    // vink_buttons.dart) — the underlying action label is 'Finish setup'. Home must show
    // the DRAFT as needing setup, not a live/funding view.
    await _pumpUntilFound(tester, find.text('FINISH SETUP'));
    await tester.tap(find.text('FINISH SETUP'));
    await tester.pumpAndSettle();

    // The OLD behavior routed here straight into the live Lobby (built for OPEN-and-beyond
    // state) — a dead end for an unsplit DRAFT with no way to actually finish setup. This is
    // the defect this slice fixes: the resumed screen must be the create flow's own Split
    // step, not the Lobby, and the already-added person must still be there.
    expect(find.text('How should everyone pay?'), findsOneWidget, reason: 'resumed directly into Split, not Add people or the Lobby');
    expect(find.text('Connecting…'), findsNothing);
    expect(find.text('Demo Member One'), findsOneWidget, reason: 'the participant added before the interruption is still there');

    // Confirm the resumed setup can actually be finished end-to-end, not just displayed.
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    expect(find.text('Review your Vink'), findsOneWidget);
    await tester.tap(find.text('OPEN VINK'));
    await tester.pumpAndSettle();
    expect(find.text('\$0.00 of \$90.00 funded'), findsOneWidget, reason: 'the resumed Vink opened for real, live lobby now correct');

    // Exactly one Vink exists for this organizer — the relaunch didn't fork a duplicate.
    final container = ProviderScope.containerOf(tester.element(find.byType(VinkinApp)));
    final token = (container.read(authControllerProvider) as AuthSignedIn).accessToken;
    final myVinks = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );
    expect((myVinks.data as Map)['vinks'] as List, hasLength(1));
  });

  testWidgets('ENG1 #5: an unsaved pre-network form is offered back as resume-or-discard after relaunch', (
    tester,
  ) async {
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final username = 'eng1s3_unsaved_$stamp';

    await SecureTokenStore().clear();
    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();
    // On a freshly erased simulator, google_fonts fetches and caches BricolageGrotesque
    // asynchronously on first use; text briefly renders in a fallback font, then relayouts
    // once the real font lands, which pumpAndSettle can return before observing — leaving
    // subsequent tap() calls aimed at coordinates the button has since moved off of. Give it
    // room to finish before the first real interaction.
    await tester.pump(const Duration(seconds: 2));

    await tester.tap(find.text('CREATE AN ACCOUNT'));
    await tester.pumpAndSettle();
    final registerFields = find.byType(TextField);
    await tester.enterText(registerFields.at(0), 'Organizer');
    await tester.enterText(registerFields.at(1), username);
    await tester.enterText(registerFields.at(2), 'integration-test-password-1');
    await tester.tap(find.text('CREATE ACCOUNT'));
    await tester.pumpAndSettle();

    // Pick a category and start typing a total — but never tap Continue on the Total step,
    // so no Vink is ever created server-side. This is pure local, in-memory-only state.
    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Retail'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CONTINUE'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '55.00');
    // The persist-on-change listener writes to the real iOS Keychain fire-and-forget — poll
    // for the write to actually land rather than guessing a fixed delay, so this test proves
    // real persistence completed, not just that some arbitrary pump duration happened to be
    // long enough.
    var persisted = false;
    for (var i = 0; i < 40 && !persisted; i++) {
      await tester.pump(const Duration(milliseconds: 50));
      final draft = await LocalDraftStore().read();
      persisted = draft?.totalText == '55.00';
    }
    expect(persisted, isTrue, reason: 'the unsaved draft must actually reach durable storage');

    await _relaunch(tester);

    // A relaunch lands a signed-in user on Home (the router's own redirect target), not back
    // inside the create flow — there's nothing server-side to show for a purely local,
    // never-submitted draft, so Home has no special state for it. The prompt lives where the
    // draft can actually resume: the next time the user starts a Vink again.
    await _pumpUntilFound(tester, find.text('START A VINK'));
    await tester.tap(find.text('START A VINK'));
    await tester.pumpAndSettle();

    // The app never silently threw this away — it offers a real choice right here. The
    // prompt itself is shown from a postFrameCallback after an async Keychain read, so this
    // needs the same bounded polling as the "FINISH SETUP" case above.
    await _pumpUntilFound(tester, find.text('Continue your last Vink?'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('What\'s the total?'), findsOneWidget, reason: 'restored straight to the Total step, category already carried over');
    final totalField = tester.widget<TextField>(find.byType(TextField).first);
    expect(totalField.controller?.text, '55.00');
  });
}
