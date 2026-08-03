import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:vinkin_mobile/core/analytics/analytics.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/core/models/user.dart';
import 'package:vinkin_mobile/design_system/components/vink_buttons.dart';
import 'package:vinkin_mobile/features/create_vink/canonical/canonical_create_vink_screen.dart';

import '../../../support/fake_api_client.dart';

class _FakeAuthController extends AuthController {
  @override
  AuthState build() => const AuthSignedIn(
    VinkinUser(id: 'organizer-1', username: 'org', displayName: 'Organizer'),
    'token',
  );
}

class _CapturedNav {
  String? vinkId;
}

Map<String, dynamic> _participant({
  required String id,
  required String name,
  required String role,
  int allocatedAmountMinor = 0,
  String? guestIdentityId,
}) => {
  'id': id,
  'displayName': name,
  'role': role,
  'status': 'JOINED',
  'allocatedAmount': {'amountMinor': allocatedAmountMinor},
  'guestIdentityId': guestIdentityId,
};

Map<String, dynamic> _snapshot({
  required String vinkId,
  required int requiredAmountMinor,
  required List<Map<String, dynamic>> participants,
  String state = 'DRAFT',
}) => {
  'vink': {
    'id': vinkId,
    'publicCode': 'CODE1234567',
    'purchaseCategory': 'GROCERY',
    'state': state,
    'requiredAmount': {'amountMinor': requiredAmountMinor},
    'fundedAmount': {'amountMinor': 0},
    'version': 1,
    'organizerUserId': 'organizer-1',
  },
  'participants': participants,
  'unallocatedAmountMinor': 0,
  'allowedActions': const [],
  'card': null,
  'contributionProgress': {
    'confirmedAmountMinor': 0,
    'totalAmountMinor': requiredAmountMinor,
    'confirmedParticipantCount': 0,
    'totalParticipantCount': participants.length,
  },
};

Widget _wrap({
  required FakeApiClient client,
  required String initialLocation,
  required _CapturedNav captured,
}) {
  final router = GoRouter(
    initialLocation: initialLocation,
    routes: [
      GoRoute(
        path: '/create-vink',
        builder: (context, state) => const CanonicalCreateVinkScreen(),
      ),
      GoRoute(
        path: '/create-vink/resume/:vinkId',
        builder: (context, state) => CanonicalCreateVinkScreen(
          resumeVinkId: state.pathParameters['vinkId'],
        ),
      ),
      GoRoute(
        path: '/vinks/:vinkId',
        builder: (context, state) {
          captured.vinkId = state.pathParameters['vinkId'];
          return const SizedBox();
        },
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      authControllerProvider.overrideWith(_FakeAuthController.new),
      apiClientProvider.overrideWithValue(client),
      analyticsProvider.overrideWithValue(DebugAnalytics()),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  group('Separate Purpose and Total steps', () {
    testWidgets(
      'purpose is required before Continue proceeds — no server call without one',
      (tester) async {
        final client = FakeApiClient(
          (m, p, b) async =>
              throw ApiException(statusCode: 500, code: 'UNEXPECTED'),
        );
        await tester.pumpWidget(
          _wrap(
            client: client,
            initialLocation: '/create-vink',
            captured: _CapturedNav(),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();

        expect(
          find.text('Tell everyone what this Vink is for.'),
          findsOneWidget,
        );
        expect(
          client.calls,
          isEmpty,
          reason: 'never call the server without a purpose',
        );
      },
    );

    testWidgets(
      'total field uses the numeric keyboard and Continue is disabled at zero',
      (tester) async {
        final client = FakeApiClient(
          (m, p, b) async =>
              throw ApiException(statusCode: 500, code: 'UNEXPECTED'),
        );
        await tester.pumpWidget(
          _wrap(
            client: client,
            initialLocation: '/create-vink',
            captured: _CapturedNav(),
          ),
        );
        await tester.pumpAndSettle();

        await tester.enterText(find.byType(TextField).first, 'Team lunch');
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();

        final moneyField = tester.widget<TextField>(
          find.byType(TextField).last,
        );
        expect(
          moneyField.keyboardType,
          const TextInputType.numberWithOptions(decimal: true),
        );

        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
        expect(find.text('Enter an amount greater than zero.'), findsOneWidget);
        expect(
          client.calls,
          isEmpty,
          reason: 'never call the server for an invalid amount',
        );
      },
    );

    testWidgets(
      'currency accuracy: \$50.50 becomes exactly subtotalMinor 5050, purpose sent separately from category',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (method == 'POST' && path == '/api/v1/vinks') {
            expect(body!['subtotalMinor'], 5050);
            expect(body['purchaseCategory'], 'GROCERY');
            expect(body['purpose'], 'Team lunch');
            return {
              'vink': {'id': 'vink-1'},
              'participants': [
                _participant(id: 'org-1', name: 'Organizer', role: 'ORGANIZER'),
              ],
            };
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: path,
          );
        });
        await tester.pumpWidget(
          _wrap(
            client: client,
            initialLocation: '/create-vink',
            captured: _CapturedNav(),
          ),
        );
        await tester.pumpAndSettle();

        await tester.enterText(find.byType(TextField).first, 'Team lunch');
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField).last, '50.50');
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();

        // Organizer default inclusion, proven from the very next screen: alone, their own
        // equal-preview share is the full amount.
        expect(find.text('Organizer · You'), findsOneWidget);
        expect(find.text('\$50.50'), findsWidgets);
      },
    );
  });

  group(
    'People+Split (Slice I5 screen 2) — via resume, to seed multiple participants directly',
    () {
      testWidgets(
        'organizer included by default; Equal recalculates once a second person exists',
        (tester) async {
          final client = FakeApiClient((method, path, body) async {
            if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
              return _snapshot(
                vinkId: 'vink-1',
                requiredAmountMinor: 10000,
                participants: [
                  _participant(
                    id: 'org-1',
                    name: 'Organizer',
                    role: 'ORGANIZER',
                  ),
                  _participant(id: 'mem-1', name: 'Member One', role: 'MEMBER'),
                ],
              );
            }
            throw ApiException(
              statusCode: 404,
              code: 'UNEXPECTED_CALL',
              message: path,
            );
          });
          await tester.pumpWidget(
            _wrap(
              client: client,
              initialLocation: '/create-vink/resume/vink-1',
              captured: _CapturedNav(),
            ),
          );
          await tester.pumpAndSettle();

          expect(find.text('Organizer · You'), findsOneWidget);
          expect(find.text('Member One'), findsOneWidget);
          // $100.00 / 2 = $50.00 each, largest-remainder-exact.
          expect(find.text('\$50.00'), findsNWidgets(2));
        },
      );

      testWidgets(
        'Custom mode: under-assignment blocks Continue and explains without jargon',
        (tester) async {
          final client = FakeApiClient((method, path, body) async {
            if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
              return _snapshot(
                vinkId: 'vink-1',
                requiredAmountMinor: 10000,
                participants: [
                  _participant(
                    id: 'org-1',
                    name: 'Organizer',
                    role: 'ORGANIZER',
                  ),
                  _participant(id: 'mem-1', name: 'Member One', role: 'MEMBER'),
                ],
              );
            }
            throw ApiException(
              statusCode: 404,
              code: 'UNEXPECTED_CALL',
              message: path,
            );
          });
          await tester.pumpWidget(
            _wrap(
              client: client,
              initialLocation: '/create-vink/resume/vink-1',
              captured: _CapturedNav(),
            ),
          );
          await tester.pumpAndSettle();

          await tester.tap(find.text('Custom'));
          await tester.pumpAndSettle();

          final fields = find.byType(TextField);
          await tester.enterText(fields.at(0), '30.00');
          await tester.enterText(fields.at(1), '30.00');
          await tester.pump();

          expect(
            find.textContaining('still needs to be assigned'),
            findsOneWidget,
          );
          final continueButton = tester.widget<VinkPrimaryButton>(
            find.widgetWithText(VinkPrimaryButton, 'Continue'),
          );
          expect(continueButton.onPressed, isNull);
        },
      );

      testWidgets(
        'Custom mode: over-assignment is explained without jargon, and blocks Continue',
        (tester) async {
          final client = FakeApiClient((method, path, body) async {
            if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
              return _snapshot(
                vinkId: 'vink-1',
                requiredAmountMinor: 10000,
                participants: [
                  _participant(
                    id: 'org-1',
                    name: 'Organizer',
                    role: 'ORGANIZER',
                  ),
                  _participant(id: 'mem-1', name: 'Member One', role: 'MEMBER'),
                ],
              );
            }
            throw ApiException(
              statusCode: 404,
              code: 'UNEXPECTED_CALL',
              message: path,
            );
          });
          await tester.pumpWidget(
            _wrap(
              client: client,
              initialLocation: '/create-vink/resume/vink-1',
              captured: _CapturedNav(),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Custom'));
          await tester.pumpAndSettle();

          final fields = find.byType(TextField);
          await tester.enterText(fields.at(0), '80.00');
          await tester.enterText(fields.at(1), '80.00');
          await tester.pump();

          expect(find.textContaining('more than the total'), findsOneWidget);
          final continueButton = tester.widget<VinkPrimaryButton>(
            find.widgetWithText(VinkPrimaryButton, 'Continue'),
          );
          expect(continueButton.onPressed, isNull);
        },
      );

      testWidgets(
        'exact Custom reconciliation enables Continue; organizer can edit/zero their own row '
        '(share "removal") the same way as any other participant',
        (tester) async {
          final client = FakeApiClient((method, path, body) async {
            if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
              return _snapshot(
                vinkId: 'vink-1',
                requiredAmountMinor: 10000,
                participants: [
                  _participant(
                    id: 'org-1',
                    name: 'Organizer',
                    role: 'ORGANIZER',
                  ),
                  _participant(id: 'mem-1', name: 'Member One', role: 'MEMBER'),
                ],
              );
            }
            if (method == 'PUT' && path == '/api/v1/vinks/vink-1/split') {
              final amounts = (body!['amounts'] as List)
                  .cast<Map<String, dynamic>>();
              final byId = {
                for (final a in amounts)
                  a['participantId'] as String: a['amountMinor'] as int,
              };
              expect(byId['org-1'], 0);
              expect(byId['mem-1'], 10000);
              return {};
            }
            throw ApiException(
              statusCode: 404,
              code: 'UNEXPECTED_CALL',
              message: path,
            );
          });
          await tester.pumpWidget(
            _wrap(
              client: client,
              initialLocation: '/create-vink/resume/vink-1',
              captured: _CapturedNav(),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Custom'));
          await tester.pumpAndSettle();

          final fields = find.byType(TextField);
          await tester.enterText(
            fields.at(0),
            '0.00',
          ); // organizer "removes" their own share
          await tester.enterText(fields.at(1), '100.00');
          await tester.pump();

          final continueButton = tester.widget<VinkPrimaryButton>(
            find.widgetWithText(VinkPrimaryButton, 'Continue'),
          );
          expect(continueButton.onPressed, isNotNull);
        },
      );
    },
  );

  group('Slice I5B (D40) — draft-only participant editing and removal', () {
    testWidgets('the organizer row has no edit or remove affordance at all', (
      tester,
    ) async {
      final client = FakeApiClient((method, path, body) async {
        if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
          return _snapshot(
            vinkId: 'vink-1',
            requiredAmountMinor: 10000,
            participants: [
              _participant(id: 'org-1', name: 'Organizer', role: 'ORGANIZER'),
              _participant(id: 'mem-1', name: 'Member One', role: 'MEMBER'),
            ],
          );
        }
        throw ApiException(
          statusCode: 404,
          code: 'UNEXPECTED_CALL',
          message: path,
        );
      });
      await tester.pumpWidget(
        _wrap(
          client: client,
          initialLocation: '/create-vink/resume/vink-1',
          captured: _CapturedNav(),
        ),
      );
      await tester.pumpAndSettle();

      // Exactly one remove icon exists (the member's) — the organizer row contributes none.
      expect(find.byIcon(Icons.delete_outline_rounded), findsOneWidget);
      expect(
        find.byIcon(Icons.edit_outlined),
        findsNothing,
      ); // a member has nothing editable either
    });

    testWidgets(
      'editing a guest updates the row and its delivery caption in place',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
            return _snapshot(
              vinkId: 'vink-1',
              requiredAmountMinor: 10000,
              participants: [
                _participant(id: 'org-1', name: 'Organizer', role: 'ORGANIZER'),
                _participant(
                  id: 'guest-1',
                  name: 'Sam',
                  role: 'MEMBER',
                  guestIdentityId: 'g-1',
                ),
              ],
            );
          }
          if (method == 'PATCH' &&
              path == '/api/v1/vinks/vink-1/participants/guest-1/guest') {
            expect(body!['deliveryMode'], 'email');
            return {
              'participant': {
                'id': 'guest-1',
                'displayName': 'Sam',
                'status': 'JOINED',
              },
              'deliveryMode': 'email',
            };
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: '$method $path',
          );
        });
        await tester.pumpWidget(
          _wrap(
            client: client,
            initialLocation: '/create-vink/resume/vink-1',
            captured: _CapturedNav(),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.byIcon(Icons.edit_outlined));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(ChoiceChip, 'Email'));
        await tester.pump();
        await tester.enterText(find.byType(TextField).last, 'sam@example.com');
        await tester.pump();
        await tester.tap(find.text('Save'));
        await tester.pumpAndSettle();

        expect(find.text('Will be emailed'), findsOneWidget);
      },
    );

    testWidgets(
      'removing a guest calls DELETE and recalculates Equal immediately',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
            return _snapshot(
              vinkId: 'vink-1',
              requiredAmountMinor: 9000,
              participants: [
                _participant(id: 'org-1', name: 'Organizer', role: 'ORGANIZER'),
                _participant(id: 'mem-1', name: 'Member One', role: 'MEMBER'),
                _participant(
                  id: 'guest-1',
                  name: 'Guest One',
                  role: 'MEMBER',
                  guestIdentityId: 'g-1',
                ),
              ],
            );
          }
          if (method == 'DELETE' &&
              path == '/api/v1/vinks/vink-1/participants/guest-1') {
            return {'id': 'guest-1', 'status': 'REMOVED'};
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: '$method $path',
          );
        });
        await tester.pumpWidget(
          _wrap(
            client: client,
            initialLocation: '/create-vink/resume/vink-1',
            captured: _CapturedNav(),
          ),
        );
        await tester.pumpAndSettle();

        // Before removal: $9000 / 3 = $30.00 each.
        expect(find.text('\$30.00'), findsNWidgets(3));

        await tester.tap(
          find.byIcon(Icons.delete_outline_rounded).last,
        ); // Guest One's row
        await tester.pumpAndSettle();
        await tester.tap(find.text('Remove'));
        await tester.pumpAndSettle();

        expect(find.text('Guest One'), findsNothing);
        // After removal: $9000 / 2 = $45.00 each, recalculated with no extra action.
        expect(find.text('\$45.00'), findsNWidgets(2));
        expect(
          client.calls.where((c) => c.method == 'DELETE'),
          hasLength(1),
          reason: 'exactly the member removal — the guest untouched',
        );
      },
    );

    testWidgets(
      'removing a participant leaves Custom mode unreconciled — Continue disables again',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
            return _snapshot(
              vinkId: 'vink-1',
              requiredAmountMinor: 9000,
              participants: [
                _participant(id: 'org-1', name: 'Organizer', role: 'ORGANIZER'),
                _participant(id: 'mem-1', name: 'Member One', role: 'MEMBER'),
                _participant(id: 'mem-2', name: 'Member Two', role: 'MEMBER'),
              ],
            );
          }
          if (method == 'DELETE') return {'id': 'mem-2', 'status': 'REMOVED'};
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: '$method $path',
          );
        });
        await tester.pumpWidget(
          _wrap(
            client: client,
            initialLocation: '/create-vink/resume/vink-1',
            captured: _CapturedNav(),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Custom'));
        await tester.pumpAndSettle();

        final fields = find.byType(TextField);
        await tester.enterText(fields.at(0), '30.00');
        await tester.enterText(fields.at(1), '30.00');
        await tester.enterText(fields.at(2), '30.00');
        await tester.pump();
        expect(
          tester
              .widget<VinkPrimaryButton>(
                find.widgetWithText(VinkPrimaryButton, 'Continue'),
              )
              .onPressed,
          isNotNull,
          reason: 'fully reconciled at \$90.00 == \$90.00 before any removal',
        );

        await tester.tap(
          find.byIcon(Icons.delete_outline_rounded).last,
        ); // Member Two's row
        await tester.pumpAndSettle();
        await tester.tap(find.text('Remove'));
        await tester.pumpAndSettle();

        expect(
          tester
              .widget<VinkPrimaryButton>(
                find.widgetWithText(VinkPrimaryButton, 'Continue'),
              )
              .onPressed,
          isNull,
          reason:
              'the removed row\'s \$30.00 is gone from the total assigned — no longer reconciled',
        );
      },
    );
  });

  group(
    'Open Vink confirmation — transience, dismissal, duplicate-tap, failure handling',
    () {
      Future<void> reachConfirmation(
        WidgetTester tester,
        FakeApiClient client, {
        String vinkId = 'vink-1',
      }) async {
        await tester.pumpWidget(
          _wrap(
            client: client,
            initialLocation: '/create-vink/resume/$vinkId',
            captured: _CapturedNav(),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
      }

      FakeApiClient clientForConfirmation({
        required Future<Map<String, dynamic>> Function() onOpen,
      }) {
        var openCalls = 0;
        return FakeApiClient((method, path, body) async {
          if (method == 'GET' &&
              path == '/api/v1/vinks/vink-1' &&
              openCalls == 0) {
            return _snapshot(
              vinkId: 'vink-1',
              requiredAmountMinor: 10000,
              participants: [
                _participant(
                  id: 'org-1',
                  name: 'Organizer',
                  role: 'ORGANIZER',
                  allocatedAmountMinor: 5000,
                ),
                _participant(
                  id: 'mem-1',
                  name: 'Member One',
                  role: 'MEMBER',
                  allocatedAmountMinor: 5000,
                ),
              ],
            );
          }
          if (method == 'PUT' && path == '/api/v1/vinks/vink-1/split')
            return {};
          if (method == 'GET' &&
              path == '/api/v1/vinks/vink-1' &&
              openCalls > 0) {
            // The post-conflict re-fetch, only reachable once openCalls > 0.
            return _snapshot(
              vinkId: 'vink-1',
              requiredAmountMinor: 10000,
              participants: [
                _participant(
                  id: 'org-1',
                  name: 'Organizer',
                  role: 'ORGANIZER',
                  allocatedAmountMinor: 5000,
                ),
                _participant(
                  id: 'mem-1',
                  name: 'Member One',
                  role: 'MEMBER',
                  allocatedAmountMinor: 5000,
                ),
              ],
              state: 'OPEN',
            );
          }
          if (method == 'POST' && path == '/api/v1/vinks/vink-1/open') {
            openCalls++;
            return onOpen();
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: '$method $path',
          );
        });
      }

      testWidgets(
        'dismissing the confirmation (background tap) returns to People+Split with all data intact',
        (tester) async {
          final client = clientForConfirmation(onOpen: () async => {});
          await reachConfirmation(tester, client);

          // The sheet's own title heading and its primary button both read "Open Vink" now that
          // the button label is no longer forced uppercase.
          expect(find.text('Open Vink'), findsWidgets);
          expect(find.text('\$100.00'), findsWidgets);

          // Tap the barrier (top-left corner, outside the sheet's own content) to dismiss.
          await tester.tapAt(const Offset(20, 20));
          await tester.pumpAndSettle();

          expect(find.text('Organizer · You'), findsOneWidget);
          expect(find.text('Member One'), findsOneWidget);
          expect(
            client.calls.where(
              (c) => c.method == 'POST' && c.path.endsWith('/open'),
            ),
            isEmpty,
          );
        },
      );

      testWidgets(
        'successful opening navigates to Live Vink only after the server confirms',
        (tester) async {
          final captured = _CapturedNav();
          final client = clientForConfirmation(
            onOpen: () async => {'id': 'vink-1', 'state': 'OPEN'},
          );
          await tester.pumpWidget(
            _wrap(
              client: client,
              initialLocation: '/create-vink/resume/vink-1',
              captured: captured,
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Continue'));
          await tester.pumpAndSettle();

          expect(
            captured.vinkId,
            isNull,
            reason: 'not navigated yet — still inside the confirmation sheet',
          );
          await tester.tap(find.widgetWithText(VinkPrimaryButton, 'Open Vink'));
          await tester.pumpAndSettle();

          expect(captured.vinkId, 'vink-1');
        },
      );

      testWidgets(
        'a duplicate/rapid second tap while submitting never queues a second /open call',
        (tester) async {
          final client = clientForConfirmation(
            onOpen: () async {
              await Future<void>.delayed(const Duration(milliseconds: 50));
              return {'id': 'vink-1', 'state': 'OPEN'};
            },
          );
          await reachConfirmation(tester, client);

          final openVinkButton = find.widgetWithText(
            VinkPrimaryButton,
            'Open Vink',
          );
          await tester.tap(openVinkButton);
          await tester
              .pump(); // let submitting: true take effect, don't wait for the request
          await tester.tap(
            openVinkButton,
            warnIfMissed: false,
          ); // a "duplicate" tap
          await tester.pumpAndSettle();

          final openCalls = client.calls.where(
            (c) => c.method == 'POST' && c.path.endsWith('/open'),
          );
          expect(openCalls.length, 1);
        },
      );

      testWidgets(
        'opening failure (retryable) returns safely — sheet stays open, error shown, button re-enabled, '
        'no navigation, no silent auto-retry',
        (tester) async {
          final captured = _CapturedNav();
          final client = clientForConfirmation(
            onOpen: () async => throw ApiException(
              statusCode: 503,
              code: 'RATE_LIMITED',
              message: 'try later',
            ),
          );
          await tester.pumpWidget(
            _wrap(
              client: client,
              initialLocation: '/create-vink/resume/vink-1',
              captured: captured,
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Continue'));
          await tester.pumpAndSettle();

          await tester.tap(find.widgetWithText(VinkPrimaryButton, 'Open Vink'));
          await tester.pumpAndSettle();

          expect(captured.vinkId, isNull, reason: 'never navigates on failure');
          expect(
            find.text('Open Vink'),
            findsWidgets,
            reason: 'sheet is still open, not dismissed',
          );
          final button = tester.widget<VinkPrimaryButton>(
            find.widgetWithText(VinkPrimaryButton, 'Open Vink'),
          );
          expect(
            button.onPressed,
            isNotNull,
            reason: 'a fresh, deliberate tap must be possible again',
          );

          final openCalls = client.calls.where(
            (c) => c.method == 'POST' && c.path.endsWith('/open'),
          );
          expect(
            openCalls.length,
            1,
            reason: 'no automatic retry happened on its own',
          );
        },
      );

      testWidgets(
        'a duplicate-tap-that-already-succeeded (VINK_VERSION_CONFLICT) is treated as success, '
        'not an error — proceeds to Live Vink',
        (tester) async {
          final captured = _CapturedNav();
          final client = clientForConfirmation(
            onOpen: () async => throw ApiException(
              statusCode: 409,
              code: 'VINK_VERSION_CONFLICT',
              message: 'conflict',
            ),
          );
          await tester.pumpWidget(
            _wrap(
              client: client,
              initialLocation: '/create-vink/resume/vink-1',
              captured: captured,
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Continue'));
          await tester.pumpAndSettle();

          await tester.tap(find.widgetWithText(VinkPrimaryButton, 'Open Vink'));
          await tester.pumpAndSettle();

          expect(
            captured.vinkId,
            'vink-1',
            reason: 'the vink was already OPEN — proceed, do not show an error',
          );
        },
      );
    },
  );

  group('Interrupted draft restoration (Slice I5)', () {
    testWidgets(
      'resuming a persisted DRAFT lands directly on People+Split, never auto-opens the '
      'confirmation sheet even though the split is already fully allocated',
      (tester) async {
        final client = FakeApiClient((method, path, body) async {
          if (method == 'GET' && path == '/api/v1/vinks/vink-1') {
            return _snapshot(
              vinkId: 'vink-1',
              requiredAmountMinor: 10000,
              participants: [
                _participant(
                  id: 'org-1',
                  name: 'Organizer',
                  role: 'ORGANIZER',
                  allocatedAmountMinor: 5000,
                ),
                _participant(
                  id: 'mem-1',
                  name: 'Member One',
                  role: 'MEMBER',
                  allocatedAmountMinor: 5000,
                ),
              ],
            );
          }
          throw ApiException(
            statusCode: 404,
            code: 'UNEXPECTED_CALL',
            message: path,
          );
        });
        await tester.pumpWidget(
          _wrap(
            client: client,
            initialLocation: '/create-vink/resume/vink-1',
            captured: _CapturedNav(),
          ),
        );
        await tester.pumpAndSettle();

        expect(
          find.text('Who\'s in, and how should everyone pay?'),
          findsOneWidget,
        );
        expect(
          find.text('Open Vink'),
          findsNothing,
          reason: 'never auto-replays opening on restoration',
        );
      },
    );
  });
}
