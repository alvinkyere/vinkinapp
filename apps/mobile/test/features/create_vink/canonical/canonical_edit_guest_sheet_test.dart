import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/features/create_vink/canonical/canonical_edit_guest_sheet.dart';
import 'package:vinkin_mobile/features/create_vink/person_entry.dart';

import '../../../support/fake_api_client.dart';

const _smsGuest = PersonEntry(
  participantId: 'guest-1',
  displayName: 'Original Name',
  isGuest: true,
  isOrganizer: false,
  deliveryMode: 'SMS',
  contactDestination: '+15551234567',
);

Widget _wrap(Widget child, FakeApiClient client) => ProviderScope(
  overrides: [apiClientProvider.overrideWithValue(client)],
  child: MaterialApp(home: Scaffold(body: Center(child: child))),
);

void main() {
  testWidgets('pre-fills the current display name, mode, and destination', (tester) async {
    final client = FakeApiClient((m, p, b) async => throw ApiException(statusCode: 404, code: 'UNEXPECTED'));
    await tester.pumpWidget(_wrap(const CanonicalEditGuestSheet(vinkId: 'vink-1', person: _smsGuest), client));

    final nameField = tester.widget<TextField>(find.byType(TextField).first);
    expect(nameField.controller!.text, 'Original Name');
    final destinationField = tester.widget<TextField>(find.byType(TextField).last);
    expect(destinationField.controller!.text, '+15551234567');
    final smsChip = tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Text (SMS)'));
    expect(smsChip.selected, isTrue);
  });

  testWidgets('edits the display name and PATCHes with the resulting full state', (tester) async {
    final client = FakeApiClient((method, path, body) async {
      expect(method, 'PATCH');
      expect(path, '/api/v1/vinks/vink-1/participants/guest-1/guest');
      expect(body!['displayName'], 'Renamed');
      expect(body['deliveryMode'], 'sms');
      expect(body['contactDestination'], '+15551234567');
      return {
        'participant': {'id': 'guest-1', 'displayName': 'Renamed', 'status': 'JOINED'},
        'deliveryMode': 'sms',
      };
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
                builder: (_) => const Dialog(child: CanonicalEditGuestSheet(vinkId: 'vink-1', person: _smsGuest)),
              );
            },
          ),
        ),
        client,
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'Renamed');
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(result?.displayName, 'Renamed');
    expect(result?.deliveryMode, 'SMS');
  });

  testWidgets('edits the SMS destination', (tester) async {
    final client = FakeApiClient((method, path, body) async {
      expect(body!['contactDestination'], '+19998887777');
      return {
        'participant': {'id': 'guest-1', 'displayName': 'Original Name', 'status': 'JOINED'},
        'deliveryMode': 'sms',
      };
    });
    await tester.pumpWidget(_wrap(const CanonicalEditGuestSheet(vinkId: 'vink-1', person: _smsGuest), client));

    await tester.enterText(find.byType(TextField).last, '+19998887777');
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(client.calls, hasLength(1));
  });

  testWidgets('edits to an email destination', (tester) async {
    const emailGuest = PersonEntry(
      participantId: 'guest-2',
      displayName: 'Email Guest',
      isGuest: true,
      isOrganizer: false,
      deliveryMode: 'EMAIL',
      contactDestination: 'old@example.com',
    );
    final client = FakeApiClient((method, path, body) async {
      expect(body!['deliveryMode'], 'email');
      expect(body['contactDestination'], 'new@example.com');
      return {
        'participant': {'id': 'guest-2', 'displayName': 'Email Guest', 'status': 'JOINED'},
        'deliveryMode': 'email',
      };
    });
    await tester.pumpWidget(_wrap(const CanonicalEditGuestSheet(vinkId: 'vink-1', person: emailGuest), client));

    await tester.enterText(find.byType(TextField).last, 'new@example.com');
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(client.calls, hasLength(1));
  });

  testWidgets('changes delivery mode SMS -> MANUAL', (tester) async {
    final client = FakeApiClient((method, path, body) async {
      expect(body!['deliveryMode'], 'manual');
      expect(body.containsKey('contactDestination'), isFalse);
      return {
        'participant': {'id': 'guest-1', 'displayName': 'Original Name', 'status': 'JOINED'},
        'deliveryMode': 'manual',
        'guestToken': 'vgt_fresh',
        'joinUrl': 'https://vinkin.test/g/vgt_fresh',
      };
    });
    await tester.pumpWidget(_wrap(const CanonicalEditGuestSheet(vinkId: 'vink-1', person: _smsGuest), client));

    await tester.tap(find.widgetWithText(ChoiceChip, 'I\'ll share it myself'));
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(client.calls, hasLength(1));
  });

  testWidgets('an invalid edited destination disables Save rather than submitting', (tester) async {
    final client = FakeApiClient((m, p, b) async => throw ApiException(statusCode: 404, code: 'UNEXPECTED'));
    await tester.pumpWidget(_wrap(const CanonicalEditGuestSheet(vinkId: 'vink-1', person: _smsGuest), client));

    await tester.enterText(find.byType(TextField).last, 'not-a-phone');
    await tester.pump();

    final saveButton = tester.widget<VinkPrimaryButton>(find.widgetWithText(VinkPrimaryButton, 'Save'));
    expect(saveButton.onPressed, isNull);
    expect(client.calls, isEmpty);
  });
}
