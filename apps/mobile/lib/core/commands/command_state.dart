import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../errors/failure_classifier.dart';
import '../errors/failure_handling.dart';

/// ENG3 ("command state separate from view state"): one mutating action's own in-flight/
/// result state, kept apart from a screen's broader view state (the fetched snapshot, the
/// participant list, etc.). Every command starts idle, moves to in-progress when `run()` is
/// called, and resolves to success or a [ClassifiedFailure] — the same three-phase shape
/// `failure_classifier.dart` already assumes every mutating action has, formalized as one
/// reusable type instead of each screen inventing its own `bool _busy` + `String? _error`
/// pair (three separate ad hoc pairs existed on `vink_lobby_screen.dart` alone before this).
sealed class CommandState<T> {
  const CommandState();

  bool get isInProgress => this is CommandInProgress<T>;
}

final class CommandIdle<T> extends CommandState<T> {
  const CommandIdle();
}

final class CommandInProgress<T> extends CommandState<T> {
  const CommandInProgress();
}

final class CommandSuccess<T> extends CommandState<T> {
  const CommandSuccess(this.value);
  final T value;
}

final class CommandFailure<T> extends CommandState<T> {
  const CommandFailure(this.failure);
  final ClassifiedFailure failure;
}

/// Runs one action through the standard command lifecycle, writing the result via the
/// [setState]-shaped closure a screen already has — this does not introduce a new state-
/// management framework or replace `ConsumerStatefulWidget`'s existing pattern, it only
/// replaces N screens' own ad hoc bool+String pairs with one typed, testable, reusable shape.
///
/// Deliberately catches `Object`, not just `ApiException` — broader than some of the ad hoc
/// call sites this replaces, and deliberately so: `classifyFailure` (`failure_classifier.dart`)
/// already documents that it handles a raw, un-wrapped exception gracefully (classifies as
/// `retryable` rather than crashing), so narrowing the catch to `ApiException` only, as a
/// couple of the original call sites did, left a latent gap where an unexpected exception type
/// would propagate uncaught instead of showing a calm "check your connection" message. This is
/// the one intentional behavior change in this migration — every other aspect preserves the
/// original per-call-site behavior exactly (see `onFailure`'s suppress return value below,
/// which exists specifically to reproduce `vink_lobby_screen.dart`'s pre-existing
/// refresh-and-suppress-on-conflict cancel behavior without hard-coding it into this generic
/// runner).
class CommandRunner<T> {
  CommandRunner(this._setState, this._ref);

  final void Function(void Function()) _setState;
  final WidgetRef _ref;

  // Not `const CommandIdle<T>()` etc.: `const` requires every type argument to be known at
  // compile time, which a class's own generic parameter `T` never is from inside the class
  // body — these are cheap, non-const allocations instead (every subclass here is a plain
  // immutable value holder, so this costs nothing observable).
  CommandState<T> state = CommandIdle<T>();

  /// [onFailure], if provided, runs after the failure is classified and before [state] is
  /// updated — for side effects like `vink_lobby_screen.dart`'s cancel command refreshing the
  /// snapshot on a conflict. Returning `true` suppresses the failure from ever reaching
  /// [state] at all (resolves to idle instead) — reproduces the exact "don't show an error for
  /// something that may well have already succeeded" rule the original cancel handler had.
  /// [onSuccess], if provided, is awaited *before* [state] becomes [CommandSuccess] — several
  /// migrated call sites (e.g. the Lobby's "Pay my share") originally kept their loading flag
  /// set through a follow-up refetch, in a `finally` block that ran after that refetch
  /// completed; making [onSuccess] synchronous instead would flip the loading state off before
  /// that side effect finishes, a real (if subtle) behavior change this preserves against.
  Future<void> run(
    Future<T> Function() action, {
    Future<void> Function(T value)? onSuccess,
    Future<bool> Function(ClassifiedFailure failure)? onFailure,
  }) async {
    _setState(() => state = CommandInProgress<T>());
    try {
      final value = await action();
      if (onSuccess != null) await onSuccess(value);
      _setState(() => state = CommandSuccess<T>(value));
    } on Object catch (error) {
      final failure = presentFailure(_ref, error);
      final suppress = onFailure != null ? await onFailure(failure) : false;
      _setState(
        () => state = suppress ? CommandIdle<T>() : CommandFailure<T>(failure),
      );
    }
  }

  void reset() => _setState(() => state = CommandIdle<T>());
}
