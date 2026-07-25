// Invites feature (D44) — Home's "You're invited to…" card: renders the right content, and
// "Not now" / "View" fire distinct callbacks (dismiss-only vs. navigate-to-decide).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/components/pending_invite_card.dart';

void main() {
  testWidgets('renders title, organizer, and share amount', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PendingInviteCard(
            title: 'Dinner at Luna',
            organizerDisplayName: 'Alvin',
            assignedShareMinor: 3267,
            onView: () {},
            onNotNow: () {},
          ),
        ),
      ),
    );

    expect(find.text("You're invited to Dinner at Luna"), findsOneWidget);
    expect(find.textContaining('Alvin'), findsOneWidget);
    expect(find.textContaining(r'$32.67'), findsOneWidget);
    expect(find.text('Not now'), findsOneWidget);
    expect(find.text('View'), findsOneWidget);
  });

  testWidgets('"Not now" and "View" fire distinct callbacks', (tester) async {
    var notNowTapped = false;
    var viewTapped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PendingInviteCard(
            title: 'Dinner at Luna',
            organizerDisplayName: 'Alvin',
            assignedShareMinor: 3267,
            onView: () => viewTapped = true,
            onNotNow: () => notNowTapped = true,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Not now'));
    await tester.pump();
    expect(notNowTapped, isTrue);
    expect(viewTapped, isFalse);

    await tester.tap(find.text('View'));
    await tester.pump();
    expect(viewTapped, isTrue);
  });
}
