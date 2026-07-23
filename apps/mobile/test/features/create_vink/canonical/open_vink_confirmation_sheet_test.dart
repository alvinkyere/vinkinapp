import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/features/create_vink/canonical/open_vink_confirmation_sheet.dart';
import 'package:vinkin_mobile/features/create_vink/person_entry.dart';

const _organizer = PersonEntry(
  participantId: 'org-1',
  displayName: 'Org',
  isGuest: false,
  isOrganizer: true,
);
const _smsGuest = PersonEntry(
  participantId: 'guest-1',
  displayName: 'Sam',
  isGuest: true,
  isOrganizer: false,
  deliveryMode: 'SMS',
);

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: Center(child: child)));

void main() {
  testWidgets('shows purpose, total, participant count, and no fee line anywhere (D21)', (tester) async {
    await tester.pumpWidget(
      _wrap(
        OpenVinkConfirmationSheet(
          category: 'GROCERY',
          requiredAmountMinor: 12000,
          participants: const [_organizer, _smsGuest],
          amountsMinorByParticipantId: const {'org-1': 6000, 'guest-1': 6000},
          submitting: false,
          onOpen: () {},
        ),
      ),
    );

    expect(find.text('Groceries'), findsOneWidget);
    expect(find.text('\$120.00'), findsOneWidget);
    expect(find.text('2 people'), findsOneWidget);
    expect(find.textContaining('fee', findRichText: true), findsNothing);
  });

  testWidgets('shows the customer-safe delivery expectation per guest, never provider diagnostics', (tester) async {
    await tester.pumpWidget(
      _wrap(
        OpenVinkConfirmationSheet(
          category: 'GROCERY',
          requiredAmountMinor: 12000,
          participants: const [_organizer, _smsGuest],
          amountsMinorByParticipantId: const {'org-1': 6000, 'guest-1': 6000},
          submitting: false,
          onOpen: () {},
        ),
      ),
    );

    expect(find.text('Will be texted'), findsOneWidget);
    expect(find.textContaining('accepted'), findsNothing);
    expect(find.textContaining('provider'), findsNothing);
  });

  testWidgets('a single primary action; disabled (hard lockout) while submitting — loading-button stability', (
    tester,
  ) async {
    var tapCount = 0;
    await tester.pumpWidget(
      _wrap(
        OpenVinkConfirmationSheet(
          category: 'GROCERY',
          requiredAmountMinor: 12000,
          participants: const [_organizer],
          amountsMinorByParticipantId: const {'org-1': 12000},
          submitting: false,
          onOpen: () => tapCount++,
        ),
      ),
    );
    expect(find.byType(VinkPrimaryButton), findsOneWidget);
    await tester.tap(find.text('OPEN VINK'));
    expect(tapCount, 1);

    // Re-pump with submitting: true (the caller's own setState after the tap) — the button
    // must now be disabled, and a second tap must never fire a second call.
    await tester.pumpWidget(
      _wrap(
        OpenVinkConfirmationSheet(
          category: 'GROCERY',
          requiredAmountMinor: 12000,
          participants: const [_organizer],
          amountsMinorByParticipantId: const {'org-1': 12000},
          submitting: true,
          onOpen: () => tapCount++,
        ),
      ),
    );
    final button = tester.widget<VinkPrimaryButton>(find.byType(VinkPrimaryButton));
    expect(button.onPressed, isNull, reason: 'submitting must hard-disable the button, not just show a spinner');
    expect(button.loading, isTrue);

    // Attempting to tap a disabled button is a no-op regardless.
    await tester.tap(find.byType(VinkPrimaryButton), warnIfMissed: false);
    expect(tapCount, 1, reason: 'no second call was ever queued');
  });

  testWidgets('an inline error message renders without hiding the summary', (tester) async {
    await tester.pumpWidget(
      _wrap(
        OpenVinkConfirmationSheet(
          category: 'GROCERY',
          requiredAmountMinor: 12000,
          participants: const [_organizer],
          amountsMinorByParticipantId: const {'org-1': 12000},
          submitting: false,
          errorMessage: 'Something went wrong. Try again.',
          onOpen: () {},
        ),
      ),
    );
    expect(find.text('Something went wrong. Try again.'), findsOneWidget);
    expect(find.text('Groceries'), findsOneWidget); // summary still visible
  });
}
