# Product Screenshots Refresh

Owner request, outside the ENG/RM/PV/SH sequences: "I want screenshots for all the workflows
in the app." The existing set (`milestone-reports/PV13-SCREENSHOTS.md`) was 13 shots from
2026-07-20, predating the canonical two-screen create flow becoming default, the I7 progress
vessel, Invites (D44), and RM4C's real Stripe-hosted card payment — the UI they showed no
longer matches what ships today. Scoped via `AskUserQuestion` before any capture work: **core
organizer/guest journey (mobile + guest-web) + the Invites flow**, using the **real Stripe
sandbox payment UI** (not the mock instant-approve button), with an explicit follow-up
decision that when Stripe sandbox couldn't reach card-issued/completed (this account has no
Financial Account v2 access, per ENG6/RM2's own disclosed gap), the journey would **honestly
end at FUNDED** rather than fake the remainder with the mock provider.

## Result

**17 real screenshots** in `artifacts/product-screenshots/raw/`, all captured on 2026-08-05
against a real booted iOS Simulator (`apps/mobile`) and a real production Playwright build
(`apps/guest-web`), both against the real local backend (Postgres + Redis +
`apps/api/src/server.ts`) under `VINKIN_FINANCIAL_PROVIDER=stripe_sandbox` with a real
`stripe listen` process forwarding genuine Stripe webhooks — no mocks, no staged screens.

- **01–07 refreshed** (organizer journey: Home → add people → equal split → Open Vink
  confirmation sheet → live funding → the real Stripe payment-method panel → FUNDED).
- **10–13 refreshed** (guest journey: join → the real Stripe payment-method panel → live
  progress → funded).
- **08–09 deliberately NOT regenerated** — card provisioning (RM3B) cannot succeed under
  `stripe_sandbox` on this account; faking those two screens with the mock provider instead
  was explicitly rejected. They remain the PV13-era mock-mode captures, now stale relative to
  the current theme/vessel, flagged as a known gap rather than silently left looking current.
- **14–16 new** (Invites flow, D44): Home's "You're invited to…" card, the Invites tab's
  pending row, and the tab after a real Accept.
- **17 new** (guest-web only — see "Real, disclosed constraints" below): the actual Stripe
  Elements card-entry form with a real test card typed in.

`artifacts/product-screenshots/vinkin-screenshot-contact-sheet.png` and the device-frame
compositions in `artifacts/product-screenshots/compositions/` were regenerated from the new
set via the existing `apps/guest-web/scripts/compose-screenshots.mjs` (extended to include
14–17; height bumped for the extra row).

## Real, disclosed constraints found this pass

**Mobile cannot drive the real Stripe card entry at all.** `VinkPaymentPanel` calls
`Stripe.instance.presentPaymentSheet()` — a native platform view controller pushed outside
Flutter's widget tree, the same "no XCUITest-class automation exists to drive it" gap RM4C's
own report already disclosed for on-device `PaymentSheet` interaction. Screenshot 06 captures
the real sandbox banner + payment-method list (the piece that IS Flutter UI) but never taps
into the native sheet. Every mobile contribution in this run — including the organizer's own —
is instead confirmed through the exact server-side technique
`packages/providers/src/stripe/stripe.contract.test.ts` already uses (create a real RM4C
payment session, confirm it against Stripe with the documented always-succeeds test
PaymentMethod `pm_card_visa`), then picked up live by the app exactly as a real
webhook-confirmed payment would be. **guest-web's own Stripe Elements IS a normal in-page
iframe**, not a native control, so Nana's own payment in screenshot 17 is a genuinely
browser-typed test card (`4242 4242 4242 4242`), submitted through the real UI — the one part
of this pass that captures the actual card-entry interaction end to end.

**A real, previously-undiscovered guest-web UX gap, disclosed not fixed**: `SessionView.tsx`'s
own `paymentInProgress` flag is documented as "cleared only on reload" — even once the real
webhook confirms a payment server-side (proven directly: the DOM's own screen-reader-only
status word flips to "Paid" while the visible card is still showing "Processing…"), the
visible card never advances to the "You're in." success sentence on its own. Screenshot 12
captures that real, current stuck state rather than staging the success text that
`contributionStatusSentence` would otherwise produce — RM4C's own code comment already
disclosed this trade-off, this pass just found where it's externally visible. (Screenshot 13,
captured later once the whole vink reaches FUNDED, does show "You're in." — something else
downstream causes a fresh render at that point; not investigated further, out of scope for a
screenshot pass.)

## Real bugs found and fixed along the way

1. **`_tap()` hit-test-miss on the register screen.** A plain `tester.tap()` on "Create
   account" failed — the button sits below the fold once the keyboard/five fields (D19/D27's
   email+phone additions) fill a phone-sized viewport inside the `SingleChildScrollView` ENG3
   Slice 6 added. Fixed by wrapping every tap in this capture script with `ensureVisible()`
   first, not just the ones already known to need it.
2. **A genuine ordering gap between D44 (Invites) and RM4C (payment sessions), never exercised
   together before.** With `VINKIN_INVITES_ENABLED=1` (needed for the Invites-flow segment of
   this same capture), `addParticipantCommand` inserts existing members as `INVITED`, not
   `JOINED`. `createContributionPaymentSessionCommand`'s own `findOwnParticipant` correctly
   requires `JOINED` — so an invited-but-not-yet-accepted member's payment-session call is
   correctly rejected `403 FORBIDDEN`. Not a bug in either feature; a real interaction between
   two features that had never both been exercised in the same flow. Fixed by having Ama/Jordan
   accept their real invites (`POST .../participants/me/accept`) before paying, in both the
   mobile and guest-web capture scripts — matching what today's real product actually requires.
3. **RM4A's 7-minute default open window (`VINK_OPEN_DURATION_SECONDS`, was silently assumed
   24h from stale comments in the old capture script) is real and enforced.** A full real-device
   run — register, canonical two-screen create, add three people, split, open, pay four
   contributions with real network round trips — can genuinely exceed 7 minutes on a real
   simulator. Not fixed (correct product behavior); worked around by temporarily raising
   `VINK_OPEN_DURATION_SECONDS` for this capture session only, reverted after.
4. **The sweep's own automatic RM3B card provisioning races a `stripe_sandbox` capture,
   confirmed via direct DB inspection, not guessed.** The very first FUNDED capture attempt
   produced a genuinely EXPIRED, fully-refunded vink instead — the 10-second deadline sweep
   (`VINK_SWEEP_INTERVAL_SECONDS=10`) immediately attempted `provisionCardFromPoolCommand` on
   the freshly-FUNDED vink, which always fails on this Stripe account (no Financial Account v2
   access — the same wall ENG6/RM2 already documented) and correctly triggers RM4A's own
   auto-refund cascade all the way to EXPIRED, within roughly one or two sweep ticks. This is
   the exact "everything worked correctly, on purpose" version of the fully-funded-then-card-
   provisioning-fails scenario RM4C's own real-sandbox verification already proved once — this
   pass just hit it by accident, racing a screenshot instead of a deliberate test. Worked around
   by lengthening `VINK_SWEEP_INTERVAL_SECONDS` for the capture session (contribution
   resolution is webhook-driven, not sweep-gated, so this doesn't affect payment confirmation
   speed); reverted after.
5. **A byte-identical 05/07 screenshot pair**, caught by diffing MD5s rather than trusting a
   passing `_waitUntil` check. After Nana's real payment resolved server-side (confirmed via
   direct `psql` query — genuinely `FUNDED`, 4/4 `CAPTURED`), the Lobby's own realtime pickup
   sometimes never visibly reflected it following the earlier Home round-trip, leaving the
   screenshot showing stale "waiting for Nana" content despite the wait condition itself
   reporting true. Not root-caused to a specific line (out of scope for a screenshot pass) —
   worked around by forcing a fresh mount (leave the Lobby, re-enter) immediately before the
   FUNDED capture, which guarantees a fresh HTTP snapshot fetch regardless of whatever the
   realtime resubscription gap is. Flagged as a candidate follow-up for whichever ENG slice
   next touches the Lobby's realtime wiring.
6. **The exact recurring "stale server process on port 3000" class of bug this project's own
   history (ENG0, ENG1 Slice 2/4, ENG3 Slice 1) already documented, hit again this session.** A
   `pkill -f "node --watch src/server.ts"` pattern silently failed to match a process actually
   launched as `node --env-file=... --watch src/server.ts` (the extra flag breaks the substring
   match), leaving two competing server processes bound to the same config intent but different
   env snapshots — real symptom: a CORS-relevant env edit never took effect on the actually-
   listening process. Fixed by killing by PID directly and verifying via `lsof`/`curl` after
   every restart from that point on, not by process-name pattern matching.
7. **The `localhost` vs `127.0.0.1` CORS trap**, the same one ENG0/PV13/ENG3 already flagged as
   a recurring, still-unfixed footgun — hit again here (guest-web's Playwright `baseURL` is
   `127.0.0.1:3100`; `.env`'s `VINKIN_PUBLIC_BASE_URL` defaults to `localhost:3100`). Worked
   around for the capture session, reverted after — still not durably fixed, flagged again.

## Environment notes

- Disk hit 99% full (161MB free) mid-session, blocking the first `flutter build` — the same
  recurring class of issue ENG8/HOME-VISUAL-POLISH already documented. Confirmed with the
  owner via `AskUserQuestion` before freeing anything; freed via the same established remedy
  (`~/Library/Developer/Xcode/DerivedData` + unused default Simulator devices Xcode had
  installed, none in use) — reversible, no project files touched.
- A fresh `iPhone 16 Pro (Screenshots)` simulator was created (the one from PV13-SCREENSHOTS no
  longer existed — likely lost in an earlier disk-cleanup pass) and left in place for reuse by
  future capture sessions, matching the original precedent.
- Real Stripe sandbox credentials were used for the whole pass (already in `.env` from RM4C);
  temporary env changes (`VINKIN_FINANCIAL_PROVIDER=stripe_sandbox`,
  `VINKIN_STRIPE_WEBHOOKS_ENABLED=1`, `VINKIN_INVITES_ENABLED=1`,
  `VINK_SWEEP_INTERVAL_SECONDS=3600`, `VINKIN_PUBLIC_BASE_URL`/`OPERATIONS_CONSOLE_BASE_URL`
  temporarily pointed at `127.0.0.1`) were all reverted to their prior values after the capture
  completed; the server was restarted clean and re-verified back on `mock` mode.
- guest-web was built with `NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI=1` (Next.js inlines
  `NEXT_PUBLIC_*` at build time) — the D23/D24/D25-correct `SessionViewV2`, already shipped,
  off by default — since the flag-off legacy `SessionView` has no Stripe UI at all (it still
  calls the old provider-agnostic direct-authorize route). This is a build-time flag for
  capture purposes only; nothing in `apps/guest-web`'s own default build behavior changed.

## Files changed

- `apps/mobile/integration_test/screenshot_test.dart` — full rewrite for the canonical
  two-screen create flow, real Stripe sandbox payment, and the new Invites-flow segment.
- `apps/guest-web/tests/screenshots.spec.ts` — extended for the real Stripe Elements card
  entry and the D44 invite-accept requirement; `apps/mobile/test_driver/integration_test.dart`
  unchanged (already correct since PV13-SCREENSHOTS).
- `apps/guest-web/scripts/compose-screenshots.mjs` — contact sheet extended to 17 files.

## Verification

Both capture scripts pass cleanly end to end against real infrastructure — `flutter drive`
("All tests passed!") and `npx playwright test` (1 passed) — with every named screenshot
inspected visually after capture (not just "the test didn't throw"), and the 05/07
byte-identical false-positive specifically caught by diffing MD5s rather than trusting the
green run. Not run: `pnpm test`/`flutter test`/`typecheck`/`lint` — this pass touched only two
test-only capture scripts and one Node compose script, no application code.
