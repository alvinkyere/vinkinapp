// Slice I5 (D30) — the feature-flag rollback contract itself: `buildRouter`'s optional
// `canonicalCreateFlow` parameter lets a test exercise both the flag-on and flag-off route
// builders without recompiling with a different --dart-define (the real
// `FeatureFlags.canonicalCreateFlow` const is exercised separately, by
// `feature_flags_test.dart`'s default-off assertion).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:vinkin_mobile/app/router.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/core/models/user.dart';
import 'package:vinkin_mobile/features/create_vink/canonical/canonical_create_vink_screen.dart';
import 'package:vinkin_mobile/features/create_vink/create_vink_screen.dart';

import '../support/fake_api_client.dart';

class _FakeAuthController extends AuthController {
  @override
  AuthState build() => const AuthSignedIn(
    VinkinUser(id: 'u1', username: 'org', displayName: 'Org'),
    'token',
  );
}

final _testRouterProvider = Provider.family<GoRouter, bool?>(
  (ref, canonicalCreateFlow) => buildRouter(ref, canonicalCreateFlow: canonicalCreateFlow),
);

/// Both screens' `resumeVinkId != null` constructor path fires a real `GET
/// /api/v1/vinks/:id` from `initState` — this stub keeps the resume-route tests below from
/// ever touching the network, whichever screen the flag selects.
FakeApiClient _resumeStubClient() => FakeApiClient((method, path, body) async {
  if (method == 'GET' && path.startsWith('/api/v1/vinks/')) {
    return {
      'vink': {
        'id': 'vink-1',
        'publicCode': 'CODE1234567',
        'purchaseCategory': 'GROCERY',
        'state': 'DRAFT',
        'requiredAmount': {'amountMinor': 5000},
        'fundedAmount': {'amountMinor': 0},
        'version': 1,
        'organizerUserId': 'u1',
      },
      'participants': [
        {
          'id': 'org-1',
          'displayName': 'Org',
          'role': 'ORGANIZER',
          'status': 'JOINED',
          'allocatedAmount': {'amountMinor': 0},
        },
      ],
      'unallocatedAmountMinor': 5000,
      'allowedActions': const [],
      'card': null,
      'contributionProgress': {
        'confirmedAmountMinor': 0,
        'totalAmountMinor': 5000,
        'confirmedParticipantCount': 0,
        'totalParticipantCount': 1,
      },
    };
  }
  throw ApiException(statusCode: 404, code: 'UNEXPECTED_CALL', message: '$method $path');
});

Future<GoRouter> _pumpRouter(WidgetTester tester, {required bool? canonicalCreateFlow, required String location}) async {
  final container = ProviderContainer(
    overrides: [
      authControllerProvider.overrideWith(_FakeAuthController.new),
      apiClientProvider.overrideWithValue(_resumeStubClient()),
    ],
  );
  addTearDown(container.dispose);
  final router = container.read(_testRouterProvider(canonicalCreateFlow));
  router.go(location);
  await tester.pumpWidget(
    UncontrolledProviderScope(container: container, child: MaterialApp.router(routerConfig: router)),
  );
  await tester.pumpAndSettle();
  return router;
}

void main() {
  testWidgets('flag off: /create-vink builds the five-step wizard, unchanged (rollback contract)', (tester) async {
    await _pumpRouter(tester, canonicalCreateFlow: false, location: '/create-vink');
    expect(find.byType(CreateVinkScreen), findsOneWidget);
    expect(find.byType(CanonicalCreateVinkScreen), findsNothing);
  });

  testWidgets('flag on: /create-vink builds the canonical two-screen flow', (tester) async {
    await _pumpRouter(tester, canonicalCreateFlow: true, location: '/create-vink');
    expect(find.byType(CanonicalCreateVinkScreen), findsOneWidget);
    expect(find.byType(CreateVinkScreen), findsNothing);
  });

  testWidgets('flag off: the resume route also builds the five-step wizard', (tester) async {
    await _pumpRouter(tester, canonicalCreateFlow: false, location: '/create-vink/resume/vink-1');
    final widget = tester.widget<CreateVinkScreen>(find.byType(CreateVinkScreen));
    expect(widget.resumeVinkId, 'vink-1');
  });

  testWidgets('flag on: the resume route builds the canonical flow with the same vinkId', (tester) async {
    await _pumpRouter(tester, canonicalCreateFlow: true, location: '/create-vink/resume/vink-1');
    final widget = tester.widget<CanonicalCreateVinkScreen>(find.byType(CanonicalCreateVinkScreen));
    expect(widget.resumeVinkId, 'vink-1');
  });
}
