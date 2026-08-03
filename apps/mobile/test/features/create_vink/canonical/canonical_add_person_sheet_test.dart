import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/design_system/components/vink_text_field.dart';
import 'package:vinkin_mobile/features/create_vink/canonical/canonical_add_person_sheet.dart';
import 'package:vinkin_mobile/features/create_vink/person_entry.dart';

import '../../../support/fake_api_client.dart';

Widget _wrap(Widget child, FakeApiClient client) => ProviderScope(
  overrides: [apiClientProvider.overrideWithValue(client)],
  child: MaterialApp(
    home: Scaffold(body: Center(child: child)),
  ),
);

void main() {
  group('CanonicalAddPersonSheet — member lookup path (unchanged from I4)', () {
    testWidgets(
      'a known username adds directly, no delivery-mode UI is ever shown for a member',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (method == 'POST' && path == '/api/v1/vinks/vink-1/participants') {
            expect(body!['username'], 'known_member');
            return {
              'id': 'p-member',
              'displayName': 'Known Member',
              'status': 'JOINED',
            };
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: path,
          );
        });

        PersonEntry? result;
        await tester.pumpWidget(
          _wrap(
            Builder(
              builder: (context) => VinkPrimaryButton(
                label: 'open',
                onPressed: () async {
                  result = await showDialog<PersonEntry>(
                    context: context,
                    builder: (_) => Dialog(
                      child: CanonicalAddPersonSheet(vinkId: 'vink-1'),
                    ),
                  );
                },
              ),
            ),
            client,
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();

        await tester.enterText(find.byType(TextField).first, 'known_member');
        await tester.tap(find.text('Add'));
        await tester.pumpAndSettle();

        expect(result?.displayName, 'Known Member');
        expect(result?.isGuest, isFalse);
        expect(
          result?.deliveryMode,
          isNull,
          reason: 'a member is never asked to choose a delivery mode',
        );
      },
    );

    testWidgets(
      'an unknown username offers "add as guest" instead of a dead end',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          throw ApiException(
            statusCode: 404,
            code: 'USER_NOT_FOUND',
            message: 'no such user',
          );
        });

        await tester.pumpWidget(
          _wrap(CanonicalAddPersonSheet(vinkId: 'vink-1'), client),
        );
        await tester.enterText(find.byType(TextField).first, 'nobody');
        await tester.tap(find.text('Add'));
        await tester.pumpAndSettle();

        expect(find.text('No VinkIn account yet'), findsOneWidget);
        expect(find.text('Add as guest'), findsOneWidget);
      },
    );
  });

  group('CanonicalAddPersonSheet — guest details phase (Slice I5, I4B contract)', () {
    Future<void> goToGuestDetails(WidgetTester tester) async {
      await tester.enterText(find.byType(TextField).first, 'nobody');
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add as guest'));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'defaults to manual and never infers a mode from anything typed',
      (tester) async {
        final client = FakeApiClient(
          (m, p, b) async =>
              throw ApiException(statusCode: 404, code: 'USER_NOT_FOUND'),
        );
        await tester.pumpWidget(
          _wrap(CanonicalAddPersonSheet(vinkId: 'vink-1'), client),
        );
        await goToGuestDetails(tester);

        final manualChip = tester.widget<ChoiceChip>(
          find.widgetWithText(ChoiceChip, 'I\'ll share it myself'),
        );
        expect(manualChip.selected, isTrue);
        // No destination field is shown at all in manual mode.
        expect(
          find.byType(VinkTextField),
          findsOneWidget,
        ); // only the display-name field
      },
    );

    testWidgets(
      'display name field stays separate from the contact destination field',
      (tester) async {
        final client = FakeApiClient(
          (m, p, b) async =>
              throw ApiException(statusCode: 404, code: 'USER_NOT_FOUND'),
        );
        await tester.pumpWidget(
          _wrap(CanonicalAddPersonSheet(vinkId: 'vink-1'), client),
        );
        await goToGuestDetails(tester);

        await tester.enterText(find.byType(TextField).first, 'Alex Guest');
        await tester.tap(find.widgetWithText(ChoiceChip, 'Email'));
        await tester.pump();

        // Two distinct fields now exist: display name (still "Alex Guest") and a fresh, empty
        // email field — never pre-filled from the name, and vice versa.
        final textFields = tester
            .widgetList<TextField>(find.byType(TextField))
            .toList();
        expect(textFields.length, 2);
        expect(textFields[0].controller!.text, 'Alex Guest');
        expect(textFields[1].controller!.text, isEmpty);
      },
    );

    testWidgets(
      'SMS mode: Add is disabled until a validly-shaped phone is entered',
      (tester) async {
        final client = FakeApiClient(
          (m, p, b) async =>
              throw ApiException(statusCode: 404, code: 'USER_NOT_FOUND'),
        );
        await tester.pumpWidget(
          _wrap(CanonicalAddPersonSheet(vinkId: 'vink-1'), client),
        );
        await goToGuestDetails(tester);
        await tester.enterText(find.byType(TextField).first, 'Phone Guest');
        await tester.tap(find.widgetWithText(ChoiceChip, 'Text (SMS)'));
        await tester.pump();

        VinkPrimaryButton addButton() => tester.widget<VinkPrimaryButton>(
          find.widgetWithText(VinkPrimaryButton, 'Add guest'),
        );
        expect(addButton().onPressed, isNull, reason: 'no phone entered yet');

        await tester.enterText(find.byType(TextField).last, 'not-a-phone');
        await tester.pump();
        expect(addButton().onPressed, isNull, reason: 'invalid phone shape');

        await tester.enterText(find.byType(TextField).last, '+15551234567');
        await tester.pump();
        expect(
          addButton().onPressed,
          isNotNull,
          reason: 'a plausibly-shaped phone enables Add',
        );
      },
    );

    testWidgets(
      'EMAIL mode: Add is disabled until a validly-shaped email is entered',
      (tester) async {
        final client = FakeApiClient(
          (m, p, b) async =>
              throw ApiException(statusCode: 404, code: 'USER_NOT_FOUND'),
        );
        await tester.pumpWidget(
          _wrap(CanonicalAddPersonSheet(vinkId: 'vink-1'), client),
        );
        await goToGuestDetails(tester);
        await tester.enterText(find.byType(TextField).first, 'Email Guest');
        await tester.tap(find.widgetWithText(ChoiceChip, 'Email'));
        await tester.pump();

        VinkPrimaryButton addButton() => tester.widget<VinkPrimaryButton>(
          find.widgetWithText(VinkPrimaryButton, 'Add guest'),
        );

        await tester.enterText(find.byType(TextField).last, 'not-an-email');
        await tester.pump();
        expect(addButton().onPressed, isNull);

        await tester.enterText(
          find.byType(TextField).last,
          'guest@example.com',
        );
        await tester.pump();
        expect(addButton().onPressed, isNotNull);
      },
    );

    testWidgets(
      'manual guest submission sends deliveryMode: manual with no contactDestination, '
      'and still shows the QR/link phase (I4-compatible)',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (path == '/api/v1/vinks/vink-1/participants')
            throw ApiException(statusCode: 404, code: 'USER_NOT_FOUND');
          if (method == 'POST' && path == '/api/v1/vinks/vink-1/guests') {
            expect(body!['deliveryMode'], 'manual');
            expect(body.containsKey('contactDestination'), isFalse);
            return {
              'participant': {
                'id': 'p-guest',
                'displayName': 'Manual Guest',
                'status': 'JOINED',
              },
              'joinUrl': 'https://vinkin.test/g/tok123',
              'deliveryMode': 'manual',
              'deliveryStatus': 'manual',
            };
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: path,
          );
        });
        await tester.pumpWidget(
          _wrap(CanonicalAddPersonSheet(vinkId: 'vink-1'), client),
        );
        await goToGuestDetails(tester);
        await tester.enterText(find.byType(TextField).first, 'Manual Guest');
        await tester.pump();
        await tester.tap(find.text('Add guest'));
        await tester.pumpAndSettle();

        expect(find.text('Manual Guest is in'), findsOneWidget);
        expect(find.text('https://vinkin.test/g/tok123'), findsOneWidget);
      },
    );

    testWidgets(
      'SMS guest submission sends deliveryMode: sms + contactDestination, and shows '
      'ONLY a customer-safe confirmation — no link, no provider diagnostics',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (path == '/api/v1/vinks/vink-1/participants')
            throw ApiException(statusCode: 404, code: 'USER_NOT_FOUND');
          if (method == 'POST' && path == '/api/v1/vinks/vink-1/guests') {
            expect(body!['deliveryMode'], 'sms');
            expect(body['contactDestination'], '+15551234567');
            return {
              'participant': {
                'id': 'p-guest',
                'displayName': 'SMS Guest',
                'status': 'JOINED',
              },
              'deliveryMode': 'sms',
              'deliveryStatus': 'pending',
            };
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: path,
          );
        });
        await tester.pumpWidget(
          _wrap(CanonicalAddPersonSheet(vinkId: 'vink-1'), client),
        );
        await goToGuestDetails(tester);
        await tester.enterText(find.byType(TextField).first, 'SMS Guest');
        await tester.tap(find.widgetWithText(ChoiceChip, 'Text (SMS)'));
        await tester.pump();
        await tester.enterText(find.byType(TextField).last, '+15551234567');
        await tester
            .pump(); // rebuild so the (now-valid) destination actually enables Add
        await tester.tap(find.text('Add guest'));
        await tester.pumpAndSettle();

        expect(find.text('SMS Guest is in'), findsOneWidget);
        expect(
          find.text('They\'ll get a text once this Vink opens.'),
          findsOneWidget,
        );
        expect(
          find.byType(TextField),
          findsNothing,
        ); // no link field, no diagnostics
      },
    );

    testWidgets(
      'duplicate-invite (INVITE_ALREADY_SENT) closes quietly instead of erroring',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (path == '/api/v1/vinks/vink-1/participants')
            throw ApiException(statusCode: 404, code: 'USER_NOT_FOUND');
          if (method == 'POST' && path == '/api/v1/vinks/vink-1/guests') {
            throw ApiException(
              statusCode: 409,
              code: 'INVITE_ALREADY_SENT',
              message: 'already sent',
            );
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: path,
          );
        });
        PersonEntry? result = const PersonEntry(
          participantId: 'sentinel',
          displayName: 'sentinel',
          isGuest: false,
          isOrganizer: false,
        );
        await tester.pumpWidget(
          _wrap(
            Builder(
              builder: (context) => VinkPrimaryButton(
                label: 'open',
                onPressed: () async {
                  result = await showDialog<PersonEntry>(
                    context: context,
                    builder: (_) => Dialog(
                      child: CanonicalAddPersonSheet(vinkId: 'vink-1'),
                    ),
                  );
                },
              ),
            ),
            client,
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        await goToGuestDetails(tester);
        await tester.enterText(find.byType(TextField).first, 'Dup Guest');
        await tester.pump();
        await tester.tap(find.text('Add guest'));
        await tester.pumpAndSettle();

        expect(
          result,
          isNull,
          reason:
              'closes without a person to add — no error dialog, no duplicate',
        );
      },
    );
  });
}
