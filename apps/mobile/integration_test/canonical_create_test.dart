// Slice I5 (D30) — real-device proof of the canonical two-screen create flow, run with
// --dart-define=CANONICAL_CREATE_FLOW=true against a REAL local backend (Postgres + Redis +
// apps/api/src/server.ts), no mocks. Deliberately narrower than e1_test.dart: this test's
// only job is proving the NEW UI (Purpose+Total, People+Split with inline delivery-mode
// capture, the transient Open Vink confirmation sheet) genuinely works end-to-end through
// VINK_OPENED — funding/settlement/completion are the OLD flow's already-proven territory
// (e1_test.dart, unmodified, and still exercised by default since the flag defaults off).
//
// Slice I5B extension (D39/D40) — this same run now also proves, against the real backend:
// the required purpose field is genuinely persisted (not just accepted client-side), and
// draft-only guest editing + participant removal round-trip through the real PATCH/DELETE
// endpoints with real Equal recalculation, before the Vink is ever opened.

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

  testWidgets(
    'I5: the canonical two-screen flow creates and opens a Vink on a real device',
    (tester) async {
      final stamp = DateTime.now().millisecondsSinceEpoch;
      final username = 'i5_organizer_$stamp';
      final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

      await SecureTokenStore().clear();

      await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
      await tester.pumpAndSettle();

      // --- Welcome → Register --------------------------------------------------------
      await tester.tap(find.text('CREATE AN ACCOUNT'));
      await tester.pumpAndSettle();
      // Field order (register_screen.dart): displayName, username, email, phone, password —
      // both optional contact fields sit between username and password (Slice I4/I4B contact
      // capture), left blank here since this test doesn't need automatic member-path delivery.
      final registerFields = find.byType(TextField);
      await tester.enterText(registerFields.at(0), 'I5 Organizer');
      await tester.enterText(registerFields.at(1), username);
      await tester.enterText(
        registerFields.at(4),
        'integration-test-password-1',
      );
      await tester.tap(find.text('CREATE ACCOUNT'));
      await tester.pumpAndSettle();
      expect(
        find.text('Hi, I5'),
        findsOneWidget,
      ); // Home shows only the first name

      // --- Screen 1: Purpose + Total, merged (Slice I5) -------------------------------
      await tester.tap(find.text('START A VINK'));
      await tester.pumpAndSettle();
      expect(
        find.text('What are you paying for, and how much?'),
        findsOneWidget,
        reason:
            'the canonical flag is on — this must be the merged screen, not the five-step wizard',
      );
      await tester.tap(find.text('Groceries'));
      await tester.pumpAndSettle();
      // Slice I5B (D39): purpose is now a required first field on this same screen — the total
      // field shifted from TextField.first to TextField.last.
      await tester.enterText(
        find.byType(TextField).first,
        'Weekly grocery run',
      );
      await tester.enterText(find.byType(TextField).last, '90.00');
      await binding.takeScreenshot('i5-01-purpose-and-total');
      await tester.tap(find.text('CONTINUE'));
      await tester.pumpAndSettle();

      // --- Screen 2: People + Split, merged --------------------------------------------
      expect(
        find.text('Who\'s in, and how should everyone pay?'),
        findsOneWidget,
      );
      expect(
        find.text('I5 Organizer · You'),
        findsOneWidget,
        reason: 'organizer included by default',
      );
      await binding.takeScreenshot('i5-02-people-and-split-organizer-only');

      // A known member, added the same way as the old flow (unchanged member-lookup path).
      await tester.tap(find.text('ADD SOMEONE'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'demo_member_1');
      await tester.tap(find.text('ADD'));
      await tester.pumpAndSettle();
      expect(find.text('Demo Member One'), findsOneWidget);

      // A guest with automatic SMS delivery — the actual I4B/I5 contract under test: display
      // name stays separate from the destination, and the destination itself is captured here.
      await tester.tap(find.text('ADD SOMEONE'));
      await tester.pumpAndSettle();
      final unknownUsername = 'i5_nobody_$stamp';
      await tester.enterText(find.byType(TextField).first, unknownUsername);
      await tester.tap(find.text('ADD'));
      await tester.pumpAndSettle();
      expect(find.text('No VinkIn account yet'), findsOneWidget);
      await tester.tap(find.text('ADD AS GUEST'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'SMS Guest');
      await tester.pump();
      await tester.tap(find.widgetWithText(ChoiceChip, 'Text (SMS)'));
      await tester.pump();
      await tester.enterText(find.byType(TextField).last, '+15555551234');
      await tester.pump();
      await binding.takeScreenshot('i5-03-guest-delivery-mode');
      await tester.tap(find.text('ADD GUEST'));
      await tester.pumpAndSettle();
      // I4B contract: no join link/QR is shown for automatic delivery — customer-safe
      // expectation only, and the token isn't even minted until VINK_OPENED.
      expect(find.text('SMS Guest is in'), findsOneWidget);
      expect(find.textContaining('/g/'), findsNothing);
      await tester.tap(find.text('DONE'));
      await tester.pumpAndSettle();

      expect(find.text('Demo Member One'), findsOneWidget);
      expect(find.text('SMS Guest'), findsOneWidget);
      expect(find.text('Will be texted'), findsOneWidget);
      // $90.00 / 3 = exactly $30.00 each.
      expect(find.text('\$30.00'), findsNWidgets(3));
      await binding.takeScreenshot('i5-04-equal-split-three-way');

      // --- Slice I5B (D40): edit the guest's display name in place, real PATCH round-trip ---
      await tester.tap(find.byIcon(Icons.edit_outlined));
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(ChoiceChip, 'Text (SMS)'),
        findsOneWidget,
        reason: 'pre-filled from the real snapshot',
      );
      await tester.enterText(find.byType(TextField).first, 'Edited SMS Guest');
      await tester.pump();
      await tester.tap(find.text('SAVE'));
      await tester.pumpAndSettle();
      expect(find.text('Edited SMS Guest'), findsOneWidget);
      expect(find.text('SMS Guest'), findsNothing);
      await binding.takeScreenshot('i5-04b-guest-edited');

      // --- Slice I5B (D40): remove the member — real DELETE, Equal recalculates live -------
      await tester.tap(
        find.byIcon(Icons.delete_outline_rounded).first,
      ); // Demo Member One's row
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove'));
      await tester.pumpAndSettle();
      expect(find.text('Demo Member One'), findsNothing);
      // $90.00 / 2 = exactly $45.00 each, recalculated with no extra action.
      expect(find.text('\$45.00'), findsNWidgets(2));
      await binding.takeScreenshot('i5-04c-member-removed-equal-recalculated');

      await tester.tap(find.text('CONTINUE'));
      await tester.pumpAndSettle();

      // --- The transient Open Vink confirmation (not a standalone Review page) ----------
      expect(find.text('Open Vink'), findsOneWidget);
      expect(find.text('Groceries'), findsOneWidget);
      expect(find.text('2 people'), findsOneWidget);
      expect(find.textContaining('fee'), findsNothing);
      await binding.takeScreenshot('i5-05-open-vink-confirmation');

      await tester.tap(find.text('OPEN VINK'));
      await tester.pumpAndSettle();

      // --- Live Vink Lobby — confirms the real POST /open round-trip actually happened --
      expect(find.text('\$0.00 of \$90.00 funded'), findsOneWidget);
      await binding.takeScreenshot('i5-06-live-lobby');

      // Confirm server-side state directly: the vink is genuinely OPEN, not just locally
      // believed to be — the same "never trust the client's own optimism" discipline e1_test
      // applies at its own equivalent step.
      final container = ProviderScope.containerOf(
        tester.element(find.byType(VinkinApp)),
      );
      final organizerToken =
          (container.read(authControllerProvider) as AuthSignedIn).accessToken;
      final myVinks = await backend.get(
        '/api/v1/vinks',
        options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
      );
      final vink = ((myVinks.data as Map)['vinks'] as List).first as Map;
      expect(vink['state'], 'OPEN');
      // Slice I5B (D39): the purpose typed on screen 1 was genuinely persisted server-side, not
      // just held client-side.
      expect(vink['purpose'], 'Weekly grocery run');

      // Slice I5B (D40): confirm the removal and edit genuinely round-tripped through the real
      // backend, not just this screen's own local state.
      final vinkId = vink['id'] as String;
      final detail = await backend.get(
        '/api/v1/vinks/$vinkId',
        options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
      );
      final participants = (detail.data as Map)['participants'] as List;
      final activeNames = participants
          .where((p) => (p as Map)['status'] != 'REMOVED')
          .map((p) => (p as Map)['displayName'])
          .toList();
      expect(activeNames, containsAll(['I5 Organizer', 'Edited SMS Guest']));
      expect(activeNames, isNot(contains('Demo Member One')));
    },
  );
}
