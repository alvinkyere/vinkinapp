import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/commands/command_state.dart';
import 'package:vinkin_mobile/core/errors/api_exception.dart';
import 'package:vinkin_mobile/core/errors/failure_classifier.dart';
import 'package:vinkin_mobile/core/models/user.dart';

class _FakeAuthController extends AuthController {
  int expireCount = 0;

  @override
  AuthState build() => const AuthSignedIn(
    VinkinUser(id: 'u1', username: 'org', displayName: 'Org'),
    'token',
  );

  @override
  Future<void> expireSession() async {
    expireCount += 1;
    state = const AuthSignedOut();
  }
}

/// A minimal harness exposing a `CommandRunner<int>` through the exact `setState`-shaped
/// closure a real `ConsumerStatefulWidget` would pass — proves `CommandRunner` works through
/// the real pattern it's designed for (Riverpod `WidgetRef` + `State.setState`), not a
/// simplified stand-in.
class _Harness extends ConsumerStatefulWidget {
  const _Harness({
    super.key,
    required this.action,
    this.onFailure,
    this.onSuccess,
  });

  final Future<int> Function() action;
  final Future<bool> Function(ClassifiedFailure)? onFailure;
  final Future<void> Function(int)? onSuccess;

  @override
  ConsumerState<_Harness> createState() => _HarnessState();
}

class _HarnessState extends ConsumerState<_Harness> {
  late final CommandRunner<int> command;
  int rebuildCount = 0;

  @override
  void initState() {
    super.initState();
    command = CommandRunner<int>((fn) => setState(fn), ref);
  }

  @override
  Widget build(BuildContext context) {
    rebuildCount += 1;
    return MaterialApp(
      home: Scaffold(
        body: Center(
          child: ElevatedButton(
            onPressed: () => command.run(
              widget.action,
              onFailure: widget.onFailure,
              onSuccess: widget.onSuccess,
            ),
            child: const Text('run'),
          ),
        ),
      ),
    );
  }
}

Widget _wrap(Widget child, {AuthController? authController}) => ProviderScope(
  overrides: [
    if (authController != null)
      authControllerProvider.overrideWith(() => authController),
  ],
  child: child,
);

void main() {
  testWidgets('starts idle, moves to in-progress on run, resolves to success', (
    tester,
  ) async {
    final key = GlobalKey<_HarnessState>();
    await tester.pumpWidget(
      _wrap(
        _Harness(
          key: key,
          action: () =>
              Future.delayed(const Duration(milliseconds: 50), () => 42),
        ),
      ),
    );

    expect(key.currentState!.command.state, isA<CommandIdle<int>>());

    await tester.tap(find.text('run'));
    await tester.pump(); // in-progress, before the delayed action resolves
    expect(key.currentState!.command.state, isA<CommandInProgress<int>>());

    await tester.pumpAndSettle();
    final state = key.currentState!.command.state;
    expect(state, isA<CommandSuccess<int>>());
    expect((state as CommandSuccess<int>).value, 42);
  });

  testWidgets('resolves to a classified failure on a thrown ApiException', (
    tester,
  ) async {
    final key = GlobalKey<_HarnessState>();
    await tester.pumpWidget(
      _wrap(
        _Harness(
          key: key,
          action: () async => throw const ApiException(
            statusCode: 409,
            code: 'VINK_VERSION_CONFLICT',
          ),
        ),
      ),
    );

    await tester.tap(find.text('run'));
    await tester.pumpAndSettle();

    final state = key.currentState!.command.state;
    expect(state, isA<CommandFailure<int>>());
    expect(
      (state as CommandFailure<int>).failure.category,
      FailureCategory.conflict,
    );
  });

  testWidgets(
    'a non-ApiException exception classifies as retryable, never crashes',
    (tester) async {
      final key = GlobalKey<_HarnessState>();
      await tester.pumpWidget(
        _wrap(
          _Harness(
            key: key,
            action: () async => throw Exception('socket closed'),
          ),
        ),
      );

      await tester.tap(find.text('run'));
      await tester.pumpAndSettle();

      final state = key.currentState!.command.state;
      expect(state, isA<CommandFailure<int>>());
      expect(
        (state as CommandFailure<int>).failure.category,
        FailureCategory.retryable,
      );
    },
  );

  testWidgets(
    'onFailure returning true suppresses the failure — resolves to idle, not failure',
    (tester) async {
      final key = GlobalKey<_HarnessState>();
      var onFailureCalled = false;
      await tester.pumpWidget(
        _wrap(
          _Harness(
            key: key,
            action: () async => throw const ApiException(
              statusCode: 409,
              code: 'VINK_VERSION_CONFLICT',
            ),
            onFailure: (failure) async {
              onFailureCalled = true;
              return failure.category == FailureCategory.conflict;
            },
          ),
        ),
      );

      await tester.tap(find.text('run'));
      await tester.pumpAndSettle();

      expect(onFailureCalled, isTrue);
      expect(key.currentState!.command.state, isA<CommandIdle<int>>());
    },
  );

  testWidgets(
    'an authenticationRequired failure ends the session exactly once',
    (tester) async {
      final auth = _FakeAuthController();
      final key = GlobalKey<_HarnessState>();
      await tester.pumpWidget(
        _wrap(
          _Harness(
            key: key,
            action: () async => throw const ApiException(
              statusCode: 401,
              code: 'UNAUTHENTICATED',
            ),
          ),
          authController: auth,
        ),
      );

      await tester.tap(find.text('run'));
      await tester.pumpAndSettle();

      expect(auth.expireCount, 1);
      final state = key.currentState!.command.state;
      expect(
        (state as CommandFailure<int>).failure.category,
        FailureCategory.authenticationRequired,
      );
    },
  );

  testWidgets('reset() returns an in-progress-or-resolved command to idle', (
    tester,
  ) async {
    final key = GlobalKey<_HarnessState>();
    await tester.pumpWidget(_wrap(_Harness(key: key, action: () async => 1)));

    await tester.tap(find.text('run'));
    await tester.pumpAndSettle();
    expect(key.currentState!.command.state, isA<CommandSuccess<int>>());

    key.currentState!.command.reset();
    await tester.pump();
    expect(key.currentState!.command.state, isA<CommandIdle<int>>());
  });

  testWidgets(
    'onSuccess is awaited before state becomes Success — the loading flag stays '
    'set through a follow-up side effect, matching the pre-migration finally-block timing',
    (tester) async {
      final key = GlobalKey<_HarnessState>();
      var onSuccessCompleted = false;
      await tester.pumpWidget(
        _wrap(
          _Harness(
            key: key,
            action: () async => 1,
            onSuccess: (_) async {
              await Future.delayed(const Duration(milliseconds: 50));
              onSuccessCompleted = true;
            },
          ),
        ),
      );

      await tester.tap(find.text('run'));
      await tester
          .pump(); // action resolves synchronously; onSuccess is now in flight
      expect(key.currentState!.command.state, isA<CommandInProgress<int>>());
      expect(onSuccessCompleted, isFalse);

      await tester.pumpAndSettle();
      expect(onSuccessCompleted, isTrue);
      expect(key.currentState!.command.state, isA<CommandSuccess<int>>());
    },
  );
}
