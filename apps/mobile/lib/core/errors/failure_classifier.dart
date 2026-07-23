import 'api_exception.dart';
import 'human_errors.dart';

/// ENG1 Slice 4: one typed vocabulary every screen's failure handling goes through — no
/// screen invents its own interpretation of an [ApiException] (or a raw network exception)
/// anymore. Each category answers the same four questions for every mutating action:
/// - is a retry offered at all;
/// - should the client refresh its state before (or instead of) showing an error;
/// - must the user sign in again;
/// - is the message a plain error, or a calm "that already happened" notice.
///
/// Deliberately absent: automatic retries. "Whether retry is automatic" is answered "never,
/// in this slice" for every category — a mutating request only ever retries because the user
/// tapped a button again. Auto-retrying a financial mutation without positive proof the
/// specific request is safe to repeat is exactly the mistake ENG1's own brief warns against;
/// building that safely (backoff, cancellation, an auditable decision per action) is bigger
/// than typed classification and stays out of scope here.
enum FailureCategory {
  /// Transient — network blip, 5xx, timeout. Safe to offer a manual retry.
  retryable,

  /// Someone else changed the resource first (optimistic concurrency). Retrying the exact
  /// same request will fail again; the client must refresh state before any retry makes sense.
  conflict,

  /// The resource/window this action needed is no longer valid (join window closed, guest
  /// session lapsed). Retrying won't help; explain, don't offer to retry as-is.
  expired,

  /// The session is provably dead (a request's own post-refresh retry already failed). The
  /// user must sign in again — this is not the same as [expired].
  authenticationRequired,

  /// The action the user just attempted had ALREADY succeeded — a duplicate-tap or a
  /// lost-response retry catching up with reality server-side. Never shown as an error;
  /// refresh state and let the UI reflect what's actually true.
  alreadyCompleted,

  /// The request itself was malformed for reasons only changing the input fixes (a bad
  /// amount, an unsupported split). Retrying the identical request will fail identically —
  /// distinct from [terminal] in that the ACTION could still succeed with different input.
  validation,

  /// Nothing about retrying — with the same or different input — will help: the user isn't
  /// the organizer, or the resource is permanently gone. Never offer to retry.
  terminal,

  /// Not enough information to classify — an unmapped code, or a non-ApiException exception
  /// (a raw network/parse failure `ApiClient` didn't wrap). Treated conservatively: a manual
  /// retry is offered, nothing is assumed safe or already done.
  unknown,
}

class ClassifiedFailure {
  const ClassifiedFailure({
    required this.category,
    required this.message,
    required this.canRetry,
    required this.shouldRefreshState,
    required this.requiresSignIn,
  });

  final FailureCategory category;

  /// Plain, human copy — reuses [humanErrorMessage]'s table; never the raw error code.
  final String message;

  /// Whether a retry affordance should be shown at all. Always user-triggered — see the
  /// class-level note on why this slice never retries automatically.
  final bool canRetry;

  /// Whether the caller should re-fetch the authoritative state before (or instead of)
  /// showing this as an error — true for [conflict] and [alreadyCompleted], where the
  /// client's local view is what's actually stale, not the request that "failed."
  final bool shouldRefreshState;

  /// Whether the caller should end the local session (`AuthController.expireSession()`) —
  /// true only for [authenticationRequired].
  final bool requiresSignIn;
}

const _alreadyCompletedCodes = {'PARTICIPANT_ALREADY_ADDED', 'INVITE_ALREADY_SENT'};
// ILLEGAL_TRANSITION (packages/domain's state machine, e.g. a double-tapped Open/Cancel on a
// Vink that already moved on) doesn't distinguish "you're late, it's already done" from "this
// can genuinely never happen" the way ApiException is shaped today — refreshing state is the
// right response either way, so this conservatively classifies as conflict, not a guess at
// which of the two it was.
const _conflictCodes = {'VINK_VERSION_CONFLICT', 'ILLEGAL_TRANSITION'};
const _expiredCodes = {'VINK_NOT_JOINABLE', 'PARTICIPANT_EXITED', 'GUEST_UNAUTHENTICATED'};
const _terminalCodes = {
  'VINK_NOT_FOUND',
  'PARTICIPANT_NOT_FOUND',
  'USER_NOT_FOUND',
  'FORBIDDEN',
  // ENG3 ("app-version enforcement", 426 Upgrade Required): retrying — with the same or
  // different input — can never succeed until the app itself is updated, the exact shape
  // `terminal` already exists for. No new FailureCategory needed.
  'APP_VERSION_UNSUPPORTED',
};
const _validationCodes = {
  'INVALID_SPLIT',
  'UNSUPPORTED_SPLIT_METHOD',
  'VALIDATION_FAILED',
  'INVALID_AMOUNT',
};

/// Classifies any failure a mutating (or read) request can throw. [error] is typically
/// whatever an `on Object catch (error)` block caught — most commonly an [ApiException], but
/// this never assumes that; a raw exception `ApiClient` didn't wrap (a genuine network
/// failure, a JSON parse error) classifies as [FailureCategory.retryable] rather than
/// crashing the classifier itself.
ClassifiedFailure classifyFailure(Object error) {
  if (error is! ApiException) {
    return const ClassifiedFailure(
      category: FailureCategory.retryable,
      message: "Couldn't reach VinkIn. Check your connection and try again.",
      canRetry: true,
      shouldRefreshState: false,
      requiresSignIn: false,
    );
  }

  final message = humanErrorMessage(error);

  if (error.isAuthError) {
    return ClassifiedFailure(
      category: FailureCategory.authenticationRequired,
      message: message,
      canRetry: false,
      shouldRefreshState: false,
      requiresSignIn: true,
    );
  }
  if (_alreadyCompletedCodes.contains(error.code)) {
    return ClassifiedFailure(
      category: FailureCategory.alreadyCompleted,
      message: message,
      canRetry: false,
      shouldRefreshState: true,
      requiresSignIn: false,
    );
  }
  if (_conflictCodes.contains(error.code)) {
    return ClassifiedFailure(
      category: FailureCategory.conflict,
      message: message,
      canRetry: true,
      shouldRefreshState: true,
      requiresSignIn: false,
    );
  }
  if (_expiredCodes.contains(error.code)) {
    return ClassifiedFailure(
      category: FailureCategory.expired,
      message: message,
      canRetry: false,
      shouldRefreshState: true,
      requiresSignIn: false,
    );
  }
  if (_terminalCodes.contains(error.code)) {
    return ClassifiedFailure(
      category: FailureCategory.terminal,
      message: message,
      canRetry: false,
      shouldRefreshState: false,
      requiresSignIn: false,
    );
  }
  if (_validationCodes.contains(error.code)) {
    return ClassifiedFailure(
      category: FailureCategory.validation,
      message: message,
      canRetry: false,
      shouldRefreshState: false,
      requiresSignIn: false,
    );
  }
  if (error.code == 'RATE_LIMITED' || error.code == 'NETWORK_ERROR' || error.statusCode >= 500) {
    return ClassifiedFailure(
      category: FailureCategory.retryable,
      message: message,
      canRetry: true,
      shouldRefreshState: false,
      requiresSignIn: false,
    );
  }
  // AUTHORIZATION_DECLINED and any other unmapped code: unknown, but still offer a manual
  // retry — the conservative default when the classifier genuinely can't tell more.
  return ClassifiedFailure(
    category: FailureCategory.unknown,
    message: message,
    canRetry: true,
    shouldRefreshState: false,
    requiresSignIn: false,
  );
}
