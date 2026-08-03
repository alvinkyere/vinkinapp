import 'api_exception.dart';

/// Maps backend error codes (packages/application/src/errors.ts, apps/api/src/modules/*)
/// to the plain, actionable copy the design correction requires — "we couldn't find that
/// username," never `PARTICIPANT_NOT_FOUND`. Codes not in this table fall back to a
/// generic-but-still-human message, never the raw code.
String humanErrorMessage(ApiException error) {
  return switch (error.code) {
    'USER_NOT_FOUND' => "We couldn't find that VinkIn username.",
    'VINK_NOT_FOUND' =>
      "We couldn't find that Vink. The link may be out of date.",
    'VINK_NOT_JOINABLE' => "This Vink is no longer accepting new participants.",
    'VINK_VERSION_CONFLICT' =>
      "Someone else just changed this Vink. Refreshing…",
    'PARTICIPANT_NOT_FOUND' => "We couldn't find that participant.",
    'PARTICIPANT_EXITED' => "That person already left this Vink.",
    'PARTICIPANT_ALREADY_ADDED' => "They're already in this Vink.",
    'INVITE_ALREADY_SENT' => "That invite already went out.",
    'INVALID_SPLIT' => "Your shares don't add up to the total yet.",
    'UNSUPPORTED_SPLIT_METHOD' => "That split method isn't available yet.",
    'AUTHORIZATION_DECLINED' =>
      "We couldn't confirm your contribution. Nothing was charged. Try again.",
    'FORBIDDEN' => "You don't have permission to do that.",
    'VALIDATION_FAILED' => "Please check the details and try again.",
    'RATE_LIMITED' => "That's a lot of tries — wait a moment and try again.",
    'GUEST_UNAUTHENTICATED' =>
      "Your session expired. Open the link again to continue.",
    'INVALID_AMOUNT' => 'Enter an amount greater than zero.',
    'APP_VERSION_UNSUPPORTED' =>
      'This version of VinkIn is no longer supported. Please update the app.',
    // ENG3 Slice 6 — moved here verbatim from login_screen.dart/register_screen.dart's own
    // ad hoc `error.code == '...' ? '...' : '...'` checks; same exact text, now the one
    // shared table every screen's failure handling reads from.
    'INVALID_CREDENTIALS' => 'Incorrect username or password.',
    'USERNAME_TAKEN' => 'That username is already taken.',
    _ => "Something went wrong. Nothing was charged — try again.",
  };
}
