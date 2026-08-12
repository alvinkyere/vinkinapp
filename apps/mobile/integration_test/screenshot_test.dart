// Official VinkIn product screenshot capture (website use). Runs on a REAL iOS Simulator
// (iPhone 16 Pro) against the REAL local backend (Postgres + Redis + apps/api/src/server.ts)
// — no mocks, no Storybook, no fabricated UI. Refresh pass (2026-08-05): the original 13-shot
// PV13 set predates the canonical two-screen create flow, the I7 progress vessel, Invites
// (D44), and RM4C's real Stripe-hosted card payment — this run recaptures 01-07 against
// today's real UI/UX and real `stripe_sandbox` provider, and adds new Invites-flow shots.
//
// Run via (server must already be booted with VINKIN_FINANCIAL_PROVIDER=stripe_sandbox,
// VINKIN_STRIPE_WEBHOOKS_ENABLED=1, VINKIN_INVITES_ENABLED=1, and a live `stripe listen
// --forward-to http://127.0.0.1:3000/webhooks/stripe/sandbox` process running):
//   flutter drive --driver=test_driver/integration_test.dart \
//     --target=integration_test/screenshot_test.dart -d <iPhone 16 Pro UDID> \
//     --dart-define=STRIPE_SECRET_KEY=sk_test_...
// `test_driver/integration_test.dart`'s `onScreenshot` persists each named PNG to
// `artifacts/product-screenshots/raw/`.
//
// Real, disclosed constraint (see milestone-reports/ for the full writeup): mobile's own
// Stripe payment goes through `Stripe.instance.presentPaymentSheet()`, a native platform
// view controller pushed outside Flutter's widget tree — the same "no XCUITest-class
// automation exists to drive it" gap RM4C's own report disclosed. This run captures the real
// payment-method-selection panel (the piece that IS Flutter UI, sandbox banner + method list)
// but never taps into the native sheet; every contribution in this run — including the
// organizer's own — is confirmed through the exact same server-side API + Stripe test
// PaymentMethod technique the payment-provider-contract-tests use
// (`packages/providers/src/stripe/stripe.contract.test.ts`), then picked up live by the app
// exactly the way a real webhook-confirmed payment would be. Per an explicit owner decision
// this pass, the journey stops at FUNDED — card provisioning (08-ready-to-pay) and purchase
// completion (09-vink-completed) are NOT regenerated here: this Stripe sandbox account has no
// Financial Account v2 access (see milestone-reports/RM2-CARD-PROVISIONING-LIFECYCLE.md and
// ENG6-SLICE-3-STRIPE-SANDBOX-ADAPTER.md), so RM3B's card-pool provisioning would genuinely
// fail and auto-refund under this provider — faking those two screens with the mock provider
// instead was deliberately rejected rather than silently mixing providers mid-capture.

import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:vinkin_mobile/app/app.dart';
import 'package:vinkin_mobile/core/auth/auth_controller.dart';
import 'package:vinkin_mobile/core/networking/api_config.dart';
import 'package:vinkin_mobile/core/storage/secure_token_store.dart';

const _stripeSecretKey = String.fromEnvironment('STRIPE_SECRET_KEY');

Future<String> _register(
  Dio dio,
  String username,
  String displayName,
  String password,
) async {
  final response = await dio.post(
    '/api/v1/auth/register',
    data: {
      'username': username,
      'displayName': displayName,
      'password': password,
    },
  );
  return response.data['accessToken'] as String;
}

/// Confirms a Stripe PaymentIntent server-side using Stripe's own documented always-succeeds
/// test PaymentMethod (https://docs.stripe.com/testing) — exactly the technique
/// `stripe.contract.test.ts`'s `confirmContributionPaymentIntent` hook uses to prove a
/// client-confirmed flow from a backend test, since mobile's real native PaymentSheet can't be
/// driven by touch injection. `clientSecret` is `pi_..._secret_...`; the PaymentIntent id is
/// everything before `_secret_`, Stripe's own documented client-secret shape.
Future<void> _confirmStripePaymentIntent(Dio stripeDio, String clientSecret) async {
  final intentId = clientSecret.split('_secret_').first;
  await stripeDio.post(
    '/v1/payment_intents/$intentId/confirm',
    data: 'payment_method=pm_card_visa',
    options: Options(contentType: Headers.formUrlEncodedContentType),
  );
}

/// Creates a real RM4C payment session (the same route the real Stripe-hosted card form
/// would call) then confirms it server-side. `bearerToken` is either a member/organizer JWT
/// (hits the vinkId-scoped route) or a guest `vgt_` token (hits the guest route) — mutually
/// exclusive via [isGuest].
Future<void> _payViaStripeSandbox({
  required Dio backend,
  required Dio stripeDio,
  required String vinkId,
  required String bearerToken,
  required bool isGuest,
}) async {
  final path = isGuest
      ? '/api/v1/guest/contributions/payment-session'
      : '/api/v1/vinks/$vinkId/contributions/payment-session';
  final response = await backend.post(
    path,
    options: Options(headers: {'Authorization': 'Bearer $bearerToken'}),
  );
  final clientSecret = response.data['clientSecret'] as String?;
  // null means an in-flight session was replayed instead of a fresh one — nothing new to
  // confirm (matches the real client's own handling of this case).
  if (clientSecret == null) return;
  await _confirmStripePaymentIntent(stripeDio, clientSecret);
}

/// A plain `tester.tap()` can hit-test-miss a button pushed off the visible viewport by a
/// `SingleChildScrollView` (real bug caught this run: the register screen's "Create account"
/// button, below the fold once the keyboard/five fields fill the screen) — `ensureVisible`
/// scrolls it into view first. Applied to every tap in this file, not just the ones known to
/// need it, since a widget's on-screen position depends on real device/keyboard layout that
/// isn't worth re-verifying tap by tap.
Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

/// A soft version of `expect(x, isTrue)` for a `_waitUntil` result that gates only a
/// screenshot's freshness, never the rest of the journey — a slow realtime/render tick
/// shouldn't cost every screenshot after it. Prints a warning and keeps going instead of
/// aborting the whole run.
void _softCheck(bool condition, String reason) {
  if (!condition) {
    // ignore: avoid_print
    print('WARNING: $reason — capturing whatever is on screen anyway.');
  }
}

/// Wall-clock bounded (not iteration-count bounded) — `flutter drive`'s VM-service round trip
/// adds real per-pump overhead a fixed iteration count doesn't reliably absorb.
Future<bool> _waitUntil(
  WidgetTester tester,
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 20),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (condition()) return true;
  }
  return condition();
}

/// Polls the real backend (not the widget tree) until [count] contributions on this Vink are
/// `CAPTURED` — RM3A's capture-immediately terminal-ish status, reached only once a real
/// signed Stripe webhook (or, as a fallback, the deadline sweep's own periodic
/// `retrievePaymentStatus` re-check) resolves it. Separate from the UI's own live pickup,
/// which is polled afterward via [_waitUntil] against the widget tree.
Future<void> _waitForCapturedCount(
  Dio backend,
  String vinkId,
  String organizerToken,
  int count, {
  Duration timeout = const Duration(seconds: 60),
}) async {
  final deadline = DateTime.now().add(timeout);
  var capturedCount = 0;
  while (DateTime.now().isBefore(deadline) && capturedCount < count) {
    final snapshot = await backend.get(
      '/api/v1/vinks/$vinkId',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final contributions = (snapshot.data as Map)['contributions'] as List;
    capturedCount = contributions
        .where((c) => (c as Map)['status'] == 'CAPTURED')
        .length;
    if (capturedCount < count) {
      await Future<void>.delayed(const Duration(milliseconds: 750));
    }
  }
  expect(
    capturedCount,
    count,
    reason: 'expected $count real Stripe-captured contributions server-side',
  );
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('capture the refreshed VinkIn product screenshots', (
    tester,
  ) async {
    expect(
      _stripeSecretKey,
      isNotEmpty,
      reason:
          'pass --dart-define=STRIPE_SECRET_KEY=sk_test_... — needed to confirm PaymentIntents '
          'server-side since the native PaymentSheet cannot be driven by touch injection',
    );
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final backend = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));
    final stripeDio = Dio(
      BaseOptions(
        baseUrl: 'https://api.stripe.com',
        headers: {
          'Authorization':
              'Basic ${base64Encode(utf8.encode('$_stripeSecretKey:'))}',
        },
      ),
    );

    // Existing members Ama, Jordan, and Riley are seeded ahead of time via the API — realistic
    // display names, timestamp-suffixed usernames so repeated capture runs never collide.
    // Riley is used only in the Invites-flow segment at the end (never rendered on screen
    // during the main journey). Never rendered on screen as a raw username anywhere — participant
    // rows show displayName only.
    final amaToken = await _register(backend, 'amak_$stamp', 'Ama', 'showcase-password-1');
    final jordanToken = await _register(
      backend,
      'jordank_$stamp',
      'Jordan',
      'showcase-password-1',
    );
    await _register(backend, 'rileyk_$stamp', 'Riley', 'showcase-password-1');

    await SecureTokenStore().clear();
    await tester.pumpWidget(const ProviderScope(child: VinkinApp()));
    await tester.pumpAndSettle();

    // --- Organizer registers as "Alvin" — through the real UI -----------------------
    await _tap(tester, find.text('Create an account'));
    final registerFields = find.byType(TextField);
    await tester.enterText(registerFields.at(0), 'Alvin'); // Your name
    await tester.enterText(registerFields.at(1), 'alvin_$stamp'); // Username
    // index 2 (Email) and 3 (Phone) are optional — left blank, matching the real product's
    // own account-with-no-contact-info path.
    await tester.enterText(registerFields.at(4), 'showcase-password-1'); // Password
    await _tap(tester, find.text('Create account'));
    final onHome = await _waitUntil(
      tester,
      () => find.text('Start a Vink').evaluate().isNotEmpty,
    );
    expect(onHome, isTrue, reason: 'registration should land on Home');

    // --- Create the showcase Vink: canonical two-screen flow (Purpose+Total) --------
    await _tap(tester, find.text('Start a Vink'));
    // GROCERY is already the default selection (purchase_category.dart) — the closest
    // backend-supported category to a shared grocery run (see file header note).
    await tester.enterText(find.byType(TextField).first, 'Groceries for movie night');
    await _tap(tester, find.text('Continue'));
    await tester.enterText(find.byType(TextField).first, '120.00');
    await _tap(tester, find.text('Continue'));

    // --- Add people: Ama, Jordan (existing), Nana (guest) ----------------------------
    await _tap(tester, find.text('Add someone'));
    await tester.enterText(find.byType(TextField).first, 'amak_$stamp');
    await _tap(tester, find.text('Add'));

    await _tap(tester, find.text('Add someone'));
    await tester.enterText(find.byType(TextField).first, 'jordank_$stamp');
    await _tap(tester, find.text('Add'));

    await _tap(tester, find.text('Add someone'));
    await tester.enterText(find.byType(TextField).first, 'nana_unknown_$stamp');
    await _tap(tester, find.text('Add'));
    await _tap(tester, find.text('Add as guest'));
    await tester.enterText(find.byType(TextField).first, 'Nana'); // Display name
    await _tap(tester, find.text('Add guest'));
    final linkText = tester
        .widgetList<Text>(
          find.byWidgetPredicate(
            (w) => w is Text && (w.data?.contains('/g/') ?? false),
          ),
        )
        .first
        .data!;
    final guestToken = Uri.parse(linkText).pathSegments.last;
    await _tap(tester, find.text('Done'));

    expect(find.text('Ama'), findsOneWidget);
    expect(find.text('Jordan'), findsOneWidget);
    expect(find.text('Nana'), findsOneWidget);
    await binding.takeScreenshot('02-add-people');

    // --- Equal split preview: $120 / 4 = exactly $30.00 each, still on People+Split ----
    expect(find.text('\$30.00'), findsNWidgets(4));
    await binding.takeScreenshot('03-equal-split');

    await _tap(tester, find.text('Continue'));

    // --- Open Vink confirmation sheet (replaces the old standalone Review page) --------
    expect(find.text('Open Vink'), findsAtLeastNWidgets(1));
    await binding.takeScreenshot('04-review-vink');

    await _tap(tester, find.text('Open Vink').last);

    // --- Live lobby, freshly opened ----------------------------------------------------
    final container = ProviderScope.containerOf(
      tester.element(find.byType(VinkinApp)),
    );
    final organizerToken =
        (container.read(authControllerProvider) as AuthSignedIn).accessToken;
    final myVinks = await backend.get(
      '/api/v1/vinks',
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final vinkId =
        ((myVinks.data as Map)['vinks'] as List).first['id'] as String;

    // --- RM4C: the real Stripe sandbox payment-method panel, before any card is entered.
    // Sandbox banner + method list (Card available; Apple Pay/Venmo/Cash App Pay truthfully
    // unavailable) — the panel replaces the old plain "Pay my $X" button under stripe_sandbox.
    // Never taps "Debit or credit card" — that opens the real native PaymentSheet, which no
    // touch-injection automation can drive (see file header).
    final panelSeen = await _waitUntil(
      tester,
      () => find.text('Debit or credit card').evaluate().isNotEmpty,
      timeout: const Duration(seconds: 15),
    );
    _softCheck(panelSeen, 'the Stripe payment-method panel should load');
    await binding.takeScreenshot('06-organizer-contribution');

    // --- D44/Invites: with VINKIN_INVITES_ENABLED=1 (needed for the Invites-flow segment
    // below), `addParticipantCommand` inserts Ama and Jordan as INVITED, not JOINED — a real
    // interaction this run caught: `createContributionPaymentSessionCommand`'s own
    // `findOwnParticipant` requires JOINED, so an INVITED member's payment-session call is
    // correctly rejected `403 FORBIDDEN`, not a bug. Ama and Jordan accept their real invites
    // first, exactly as today's real product requires (guests are unaffected — D44 is scoped
    // to existing-member `addParticipantCommand` only, never `inviteGuestCommand`).
    await backend.post(
      '/api/v1/vinks/$vinkId/participants/me/accept',
      options: Options(headers: {'Authorization': 'Bearer $amaToken'}),
    );
    await backend.post(
      '/api/v1/vinks/$vinkId/participants/me/accept',
      options: Options(headers: {'Authorization': 'Bearer $jordanToken'}),
    );

    // --- Every contribution — including the organizer's own — is confirmed the same real
    // way: create a real RM4C payment session, confirm it server-side against Stripe with a
    // documented test PaymentMethod, then let the app's own realtime pipeline pick up the
    // real webhook-confirmed (or sweep-confirmed) result live, exactly as a real user's
    // completed native PaymentSheet would. Alvin, Ama, and Jordan first (3 of 4) — Nana (the
    // guest) held back deliberately so 05 can show a genuine "waiting on one more" moment.
    await _payViaStripeSandbox(
      backend: backend,
      stripeDio: stripeDio,
      vinkId: vinkId,
      bearerToken: organizerToken,
      isGuest: false,
    );
    await _payViaStripeSandbox(
      backend: backend,
      stripeDio: stripeDio,
      vinkId: vinkId,
      bearerToken: amaToken,
      isGuest: false,
    );
    await _payViaStripeSandbox(
      backend: backend,
      stripeDio: stripeDio,
      vinkId: vinkId,
      bearerToken: jordanToken,
      isGuest: false,
    );
    await _waitForCapturedCount(backend, vinkId, organizerToken, 3);
    // Let the realtime pipeline catch up to the server truth (confirmed ~250ms delivery in
    // PV13-SCREENSHOTS.md's own investigation of this exact pipeline).
    for (var i = 0; i < 12; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    await binding.takeScreenshot('05-live-lobby-progress');

    // --- Home, same moment: the Active Vink card shows the identical live state. The lobby
    // (`/vinks/:id`) is a top-level route outside the Home/Activity/Invites/Profile tab shell
    // (app/router.dart) — no "Home" tab label is on screen here, only the back arrow.
    await _tap(tester, find.byIcon(Icons.arrow_back_rounded));
    final homeShowsVink = await _waitUntil(
      tester,
      () => find.text('Groceries for movie night').evaluate().isNotEmpty,
      timeout: const Duration(seconds: 15),
    );
    _softCheck(homeShowsVink, 'Home should show the active Vink card live');
    await binding.takeScreenshot('01-organizer-home');

    // Back into the lobby to finish the journey to FUNDED.
    await _tap(tester, find.text('Groceries for movie night'));

    // --- Nana (the guest) pays her own share, the same real way ------------------------
    await _payViaStripeSandbox(
      backend: backend,
      stripeDio: stripeDio,
      vinkId: vinkId,
      bearerToken: guestToken,
      isGuest: true,
    );
    await _waitForCapturedCount(backend, vinkId, organizerToken, 4);

    // A real bug this run caught: after the earlier Home round trip, the lobby's live-update
    // pipeline sometimes never visibly reflects Nana's own real-time push (byte-identical
    // 05/07 screenshots in a prior capture, despite the backend genuinely showing FUNDED,
    // 4/4 CAPTURED). Forcing a fresh mount (leave, re-enter) sidesteps whatever the realtime
    // resubscription gap is by guaranteeing a fresh HTTP snapshot fetch — the same fallback
    // ENG3 Slice 1 already relies on for the Lobby's own first paint.
    await _tap(tester, find.byIcon(Icons.arrow_back_rounded));
    await _tap(tester, find.text('Groceries for movie night'));

    final fundedSeen = await _waitUntil(
      tester,
      () => find.text("Everyone's in!").evaluate().isNotEmpty,
      timeout: const Duration(seconds: 30),
    );
    _softCheck(fundedSeen, 'lobby should show FUNDED live, no reload');
    // Let the render fully settle before capturing, same discipline as 05's own settle loop.
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    await binding.takeScreenshot('07-everyone-in');

    // --- Deliberately stops here. Card provisioning (RM3B) genuinely cannot succeed under
    // stripe_sandbox on this account (no Financial Account v2 access — see file header) —
    // 08-ready-to-pay/09-vink-completed are not regenerated this pass, an explicit owner
    // decision, not an oversight.

    // ==================================================================================
    // Invites flow (D44) — a second, throwaway Vink where Riley is added as an existing
    // member (VINKIN_INVITES_ENABLED=1 makes this an INVITED row, not an auto-join), created
    // entirely via the API — Riley's own invite is what's captured, not this creation.
    // ==================================================================================
    final invitesVink = await backend.post(
      '/api/v1/vinks',
      data: {
        'purpose': 'Coffee run',
        'purchaseCategory': 'RETAIL',
        'subtotalMinor': 2000,
        'tipMinor': 0,
        'organizerDisplayName': 'Alvin',
      },
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    final invitesVinkId = (invitesVink.data as Map)['vink']['id'] as String;
    await backend.post(
      '/api/v1/vinks/$invitesVinkId/participants',
      data: {'username': 'rileyk_$stamp'},
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    await backend.put(
      '/api/v1/vinks/$invitesVinkId/split',
      data: {'method': 'EQUAL'},
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );
    await backend.post(
      '/api/v1/vinks/$invitesVinkId/open',
      data: <String, dynamic>{},
      options: Options(headers: {'Authorization': 'Bearer $organizerToken'}),
    );

    // --- Back to the tab shell (the Lobby is a top-level route outside it) before reaching
    // for a bottom-nav tab — sign out of Alvin's account, sign in as Riley -----------------
    await _tap(tester, find.byIcon(Icons.arrow_back_rounded));
    await _tap(tester, find.text('Me'));
    await _tap(tester, find.text('Sign out'));
    await _tap(tester, find.text('I already have an account'));
    final loginFields = find.byType(TextField);
    await tester.enterText(loginFields.at(0), 'rileyk_$stamp');
    await tester.enterText(loginFields.at(1), 'showcase-password-1');
    // Two matches for "Log in": the screen's own VinkStepHeader title and the submit button —
    // the button paints last.
    await _tap(tester, find.text('Log in').last);

    // --- Home's "You're invited to…" card ----------------------------------------------
    final inviteCardSeen = await _waitUntil(
      tester,
      () => find.textContaining("You're invited to").evaluate().isNotEmpty,
      timeout: const Duration(seconds: 20),
    );
    _softCheck(inviteCardSeen, "Home should show Riley's pending invite card");
    await binding.takeScreenshot('14-invites-home-card');

    // --- Invites tab, reached via the card's own "View" affordance --------------------
    await _tap(tester, find.text('View'));
    expect(find.text('Coffee run'), findsOneWidget);
    await binding.takeScreenshot('15-invites-tab-pending');

    // --- Accept — the real INVITED -> JOINED transition, through the real UI ----------
    await _tap(tester, find.text('Accept'));
    final accepted = await _waitUntil(
      tester,
      () => find.text('No pending invites').evaluate().isNotEmpty,
      timeout: const Duration(seconds: 15),
    );
    _softCheck(accepted, 'accepting should clear the pending invite live');
    await binding.takeScreenshot('16-invites-tab-accepted');
  });
}
