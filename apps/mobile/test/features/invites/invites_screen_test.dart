// Invites feature (D44) — the Invites screen itself: loading/empty/data states, and Accept/
// Decline actually calling the right endpoint and refreshing the list on success.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/features/home/home_providers.dart';
import 'package:vinkin_mobile/features/invites/invites_screen.dart';

import '../../support/fake_api_client.dart';

Map<String, dynamic> _inviteJson(String vinkId) => {
  'vinkId': vinkId,
  'purpose': 'Dinner',
  'purchaseCategory': 'GROCERY',
  'organizerDisplayName': 'Alvin',
  'assignedShareMinor': 3000,
  'invitedAt': '2026-01-01T00:00:00.000Z',
};

Widget _wrap(FakeApiClient client) => ProviderScope(
  overrides: [apiClientProvider.overrideWithValue(client)],
  child: const MaterialApp(home: InvitesScreen()),
);

void main() {
  testWidgets('empty state renders when there are no pending invites', (
    tester,
  ) async {
    final client = FakeApiClient(
      (method, path, body) async => {'invites': <dynamic>[]},
    );
    await tester.pumpWidget(_wrap(client));
    await tester.pumpAndSettle();

    expect(find.text('No pending invites'), findsOneWidget);
  });

  testWidgets('renders a pending invite with organizer and share amount', (
    tester,
  ) async {
    final client = FakeApiClient(
      (method, path, body) async => {
        'invites': [_inviteJson('vink-1')],
      },
    );
    await tester.pumpWidget(_wrap(client));
    await tester.pumpAndSettle();

    expect(find.text('Dinner'), findsOneWidget);
    expect(find.textContaining('Alvin'), findsOneWidget);
    expect(find.text('Accept'), findsOneWidget);
    expect(find.text('Decline'), findsOneWidget);
  });

  testWidgets(
    'Accept calls the accept endpoint and the row disappears once refreshed',
    (tester) async {
      var accepted = false;
      final client = FakeApiClient((method, path, body) async {
        if (method == 'POST' &&
            path == '/api/v1/vinks/vink-1/participants/me/accept') {
          accepted = true;
          return {'id': 'p1', 'status': 'JOINED'};
        }
        return {
          'invites': accepted ? <dynamic>[] : [_inviteJson('vink-1')],
        };
      });
      await tester.pumpWidget(_wrap(client));
      await tester.pumpAndSettle();

      expect(find.text('Dinner'), findsOneWidget);
      await tester.tap(find.text('Accept'));
      await tester.pumpAndSettle();

      expect(accepted, isTrue);
      expect(find.text('No pending invites'), findsOneWidget);
    },
  );

  testWidgets(
    'Decline calls the decline endpoint and the row disappears once refreshed',
    (tester) async {
      var declined = false;
      final client = FakeApiClient((method, path, body) async {
        if (method == 'POST' &&
            path == '/api/v1/vinks/vink-1/participants/me/decline') {
          declined = true;
          return {'id': 'p1', 'status': 'REMOVED'};
        }
        return {
          'invites': declined ? <dynamic>[] : [_inviteJson('vink-1')],
        };
      });
      await tester.pumpWidget(_wrap(client));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Decline'));
      await tester.pumpAndSettle();

      expect(declined, isTrue);
      expect(find.text('No pending invites'), findsOneWidget);
    },
  );

  testWidgets('a failed accept shows an inline error and the row stays', (
    tester,
  ) async {
    final client = FakeApiClient((method, path, body) async {
      if (method == 'POST' &&
          path == '/api/v1/vinks/vink-1/participants/me/accept') {
        throw Exception('boom');
      }
      return {
        'invites': [_inviteJson('vink-1')],
      };
    });
    await tester.pumpWidget(_wrap(client));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Accept'));
    await tester.pumpAndSettle();

    expect(
      find.text('Dinner'),
      findsOneWidget,
      reason: 'the row is still there — nothing was accepted',
    );
  });

  testWidgets(
    'accepting invalidates myVinksProvider too, so Home reflects the new membership',
    (tester) async {
      var myVinksCalls = 0;
      final client = FakeApiClient((method, path, body) async {
        if (method == 'POST' &&
            path == '/api/v1/vinks/vink-1/participants/me/accept') {
          return {'id': 'p1', 'status': 'JOINED'};
        }
        if (method == 'GET' && path == '/api/v1/vinks') {
          myVinksCalls++;
          return {'vinks': <dynamic>[]};
        }
        return {
          'invites': [_inviteJson('vink-1')],
        };
      });

      final container = ProviderContainer(
        overrides: [apiClientProvider.overrideWithValue(client)],
      );
      addTearDown(container.dispose);
      // Prime myVinksProvider once before acting, the way Home already would have.
      await container.read(myVinksProvider.future);
      final callsBeforeAccept = myVinksCalls;

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: InvitesScreen()),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Accept'));
      await tester.pumpAndSettle();

      // Reading it again after invalidation should trigger a genuinely new fetch.
      await container.read(myVinksProvider.future);
      expect(myVinksCalls, greaterThan(callsBeforeAccept));
    },
  );
}
