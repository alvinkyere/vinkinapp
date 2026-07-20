# PV13 Screenshots — Official VinkIn Product Screenshot Capture

**Status: complete.** All 13 required screenshots exist, were captured from the real running
product against the real local backend, and form a coherent visual story from "Create a
Vink" through "Everyone contributes" to "One payment becomes ready." The capture run itself
found and fixed four real defects and one significant, previously-undocumented product/
architecture finding (below) — this was not a mechanical screenshot exercise.

## Environment

- **Organizer app**: iOS Simulator, freshly created for this task — `iPhone 16 Pro`, iOS
  26.5, device `4BE300CC-138B-4E02-8772-E0D27862325B` (name: "iPhone 16 Pro (Screenshots)"),
  status bar overridden to a clean `9:41` / full wifi / full battery via
  `xcrun simctl status_bar ... override`. Every organizer screenshot came from this one
  device — no mixing of simulator sizes.
- **Guest-web**: Playwright's built-in `devices['iPhone 16 Pro']` descriptor (402×681 CSS,
  3x device scale factor) forced to `browserName: 'chromium'` — matches this repo's existing
  `playwright.config.ts` convention (WebKit intentionally avoided, see PV10's own report) and
  keeps the guest viewport dimensionally consistent with the organizer device.
- **Backend**: real local PostgreSQL 16 + Redis (brew services), `apps/api/src/server.ts`
  started with `VINKIN_PUBLIC_BASE_URL`/`OPERATIONS_CONSOLE_BASE_URL` set to the CORS-allowed
  local origins. Guest-web and the operations console ran as real Next.js production builds
  (`next build && next start`), not `next dev` — Turbopack's dev-mode HMR websocket is known
  broken in this environment (documented since PV10).
- No mocks, no Storybook, no fabricated UI at any point.

## Showcase data

A single deterministic Vink, created fresh via the real create-flow (organizer screens) and
again via direct API calls (guest-web capture, which needs its own independent Vink since the
organizer run's Vink reaches COMPLETED and can't be "rewound"):

- Purpose: **Groceries** (category) — not "Dinner at Luna." The domain has no freeform Vink
  name/merchant field (flagged already in `milestone-reports/PV13.md`); the only real "what's
  this for" field is the category enum, and only `GROCERY`/`RETAIL`/`ELECTRONICS` are enabled
  today (`packages/domain/src/policy.ts`). "Dinner at Luna" is aspirational website copy that
  can sit beside a screenshot; it is not text the product itself can render.
- Total: **$120.00**, Equal split, 4 people, **$30.00 each** (exact, no remainder).
- Participants: **Alvin** (organizer, "You"), **Ama** and **Jordan** (existing members, added
  by username), **Nana** (guest, added with no account via the real organizer-invite flow,
  D14 token machinery).
- Usernames are timestamp-suffixed (`alvin_<ts>`, `amak_<ts>`, …) so repeated capture runs
  never collide — never rendered on screen (participant rows show display name only).

## Screenshot automation

**Organizer app** — the exact gap flagged in `milestone-reports/PV13.md` ("`takeScreenshot()`
doesn't persist files without a driver script") is now resolved:

- `apps/mobile/test_driver/integration_test.dart` — a real driver using
  `integration_test/integration_test_driver_extended.dart`'s `integrationDriver({onScreenshot})`
  (the plain `integration_test_driver.dart` this milestone's report guessed at has no
  `onScreenshot` parameter in this SDK version — confirmed by reading the installed package
  source, not assumed). Writes each named PNG to `artifacts/product-screenshots/raw/`.
- `apps/mobile/integration_test/screenshot_test.dart` — one continuous, real lifecycle: register
  → create → add people (existing members + guest) → split → review → open → organizer pays own
  share → member/guest contributions (driven directly against the API, matching this repo's
  established convention that a participant's own UI is out of the *organizer* app's scope) →
  live FUNDED → real deadline-swept card → merchant simulation → live COMPLETED. Run via:
  ```
  flutter drive --driver=test_driver/integration_test.dart \
    --target=integration_test/screenshot_test.dart -d <iPhone 16 Pro UDID>
  ```
- Exits non-zero (via `expect()`/`exit(1)`) if any required moment isn't reached — matches the
  "fail if a screenshot is missing" requirement structurally, not just by convention.

**Guest-web** — `apps/guest-web/tests/screenshots.spec.ts`, a normal Playwright test (reuses
the existing `playwright.config.ts` production-build `webServer`), builds its own Vink via
direct API calls, then drives Nana's real redeem → approve → live-funded journey through the
browser, screenshotting at each named moment with `page.screenshot({ path })`.

**Post-processing** — `apps/guest-web/scripts/compose-screenshots.mjs` (Playwright rendering
local HTML/CSS, since no ImageMagick/ffmpeg/cwebp is installed in this environment — confirmed
by checking, not assumed): contact sheet, four device-frame compositions, the website
comparison, and AVIF exports (`sips` supports AVIF; it does **not** support WebP export in
this environment — confirmed by a direct test — so no `.webp` files exist; PNG + AVIF only).

## Generated files

```
artifacts/product-screenshots/
  raw/                                    13 files, PNG, native resolution (1206×2622 organizer,
                                           1206×2043 guest — the guest page is shorter than
                                           the viewport, Playwright's default full-page-off
                                           screenshot sizes to actual content height)
    01-organizer-home.png                 03-equal-split.png
    02-add-people.png                     04-review-vink.png
    05-live-lobby-progress.png            06-organizer-contribution.png
    07-everyone-in.png                    08-ready-to-pay.png
    09-vink-completed.png                 10-guest-join.png
    11-guest-contribution.png             12-guest-live-progress.png
    13-guest-funded.png
  web/                                    PNG + AVIF pairs for the 6 recommended homepage assets
  compositions/
    hero-live-lobby.png                   feature-equal-split.png
    feature-guest-flow.png                feature-everyone-in.png
  vinkin-screenshot-contact-sheet.png      all 13, labeled grid
  vinkin-website-product-comparison.png   live vinkin.org hero + 5 selected screenshots, side by side
```

## Recommended selections (unchanged from the brief's own recommendation, verified against
## the actual captured images — all still read well together)

- **Homepage**: `01-organizer-home`, `03-equal-split`, `05-live-lobby-progress`,
  `07-everyone-in`, `10-guest-join`, `09-vink-completed`.
- **Product walkthrough**: `02-add-people`, `03-equal-split`, `04-review-vink`,
  `05-live-lobby-progress`, `07-everyone-in`, `08-ready-to-pay`, `09-vink-completed`.
- **Guest feature set**: `10-guest-join`, `11-guest-contribution`, `12-guest-live-progress`,
  `13-guest-funded`.

## A significant product/architecture finding, not hidden

**`fundedAmountMinor` does not move as each individual contribution authorizes.**
`packages/application/src/contributions.ts`'s D5 "single resolver" rule captures every
contribution atomically, all at once, only once the *last* participant contributes
(`resolveFunding`). Individual `AUTHORIZED` contributions sit as holds; the pooled total stays
at exactly `$0` until the very last one lands, then jumps straight to the full amount.

This means the brief's own "$90 of $120, 3 of 4 paid" **progress-bar** moment — which is also
what vinkin.org's own hero mockup visually implies (a partially-filled bar next to partially-
checked names, documented in `docs/design/vinkin-design-system.md`'s "closest real reference"
section) — **does not exist as a reachable state in the product today.** What is real and was
captured honestly: each participant's own row shows a "Paid" checkmark the instant *they*
authorize (independent of the pooled total), so `05-live-lobby-progress.png` and
`12-guest-live-progress.png` show 3-of-4 (or Nana alone) with individual paid checkmarks while
the progress bar itself honestly reads `$0.00 of $120.00 funded` / `0%`. This is the real
product's real behavior — not a capture bug, and not silently smoothed over. Changing it (so
the pool total climbs incrementally) would be a settlement-semantics change, explicitly out of
this task's scope and this repo's own standing "no new settlement semantics" rule; flagged
here for the owner's own future decision, exactly as this repo's convention requires.

## Real defects this capture run found and fixed

1. **Two identically-labeled "Start a Vink" buttons** on the Home screen (the dominant CTA and
   the Active-Vinks empty-state action) — broke the very first `find.text()` lookup in the
   screenshot test and was a genuine accessibility ambiguity regardless. Fixed: the empty-state
   action now reads "Start your first Vink."
2. **A stale-response race in the live lobby's realtime refresh.** Multiple WebSocket events
   arriving in quick succession (the organizer's, a member's, and a guest's contributions all
   within milliseconds) each fire their own `_refreshSnapshot()`; overlapping REST fetches can
   complete out of order, and a slower/older response could overwrite a faster/newer one,
   leaving the lobby stuck on stale data. Fixed with a monotonic request-sequence guard in
   `apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart` — only the result of the most
   recently *issued* fetch is ever applied.
3. **A layout overflow in the guest-invite bottom sheet** (`RenderFlex overflowed by 2.0
   pixels`) on this device size — the QR code, link box, and action buttons together exceeded
   `showVinkBottomSheet`'s unbounded height. Fixed by bounding the sheet to 90% of the viewport
   and wrapping it in `SingleChildScrollView` — applies to every sheet in the app, not just
   this one.
4. **Fastify rejects a JSON-content-typed POST with a genuinely empty body** — the guest-web
   screenshot script's own `contributions/authorize` calls (no request body needed) were
   sending `content-type: application/json` with no body and got a 400
   `FST_ERR_CTP_EMPTY_JSON_BODY`. Not a product bug (the mobile app's Dio client already
   avoids this), but worth noting for anyone else scripting against this API directly: send
   `body: '{}'` explicitly on bodyless POSTs.

Two environment-only issues (not product code, noted for completeness): the local disk filled
during this pass (an unrelated runaway `find /` background command plus normal Xcode/simulator
growth) and was resolved by clearing `~/Library/Developer/Xcode/iOS DeviceSupport` and unused
default simulator devices/other-app caches — not a project artifact. Separately, the API
server had been restarted earlier in this session without its `VINKIN_PUBLIC_BASE_URL`
override, silently breaking CORS for guest-web's `127.0.0.1` origin (`localhost` ≠ `127.0.0.1`
for CORS purposes) — restarted with the correct origin env vars, documented already in
`CLAUDE.md`'s own "Machine notes."

## Website placement plan

See `docs/design/website-screenshot-plan.md` for the full detail. Headline finding: the live
site currently has **no real product screenshots at all** — only stock lifestyle photography
and one hand-coded UI mockup (not a screenshot) in the hero. The plan therefore proposes
placements using the site's own already-established visual language (`rounded-[2rem]`,
`shadow-[0_40px_100px_-20px_rgba(10,10,11,0.55)]`, `bg-paper` cards, `py-28`/`py-40` section
rhythm — all verified directly against the site's raw compiled CSS, not guessed) rather than
reverse-engineering a screenshot convention that doesn't exist yet.

## Final quality checklist

- [x] Every screenshot comes from the real running product (organizer: real iOS Simulator +
      real backend; guest: real Chromium + real production build + real backend).
- [x] Real PostgreSQL and Redis were used throughout.
- [x] Organizer screenshots use one consistent simulator (iPhone 16 Pro, one UDID, throughout).
- [x] Guest screenshots use one consistent mobile viewport (`devices['iPhone 16 Pro']`).
- [x] The same Vink and participant data (Alvin/Ama/Jordan/Nana, $120/$30 each) appear
      throughout both the organizer and guest sets.
- [x] No debug text, no raw backend state names, no `localhost` URL, no simulator chrome, no
      loading/spinner/skeleton state, no unintended keyboard visible in any final screenshot.
- [x] Currency values correct; shares sum exactly to the total ($30×4 = $120).
- [x] Organizer's own contribution is visible (`06-organizer-contribution.png`,
      `07-everyone-in.png`'s participant row, `09-vink-completed.png`'s participant row).
- [x] Guest participation clearly requires no account (`10`–`13`, plus the "Liked splitting
      the bill this way?" signup-conversion card visible in `12`/`13`).
- [x] Pilot simulation disclosed wherever mock card/money state is visible (`08`, `09`, `13`).
- [x] Master PNGs (`raw/`) and optimized web versions (`web/`, PNG+AVIF) exist.
- [x] Contact sheet exists (`vinkin-screenshot-contact-sheet.png`).
- [x] Website comparison exists (`vinkin-website-product-comparison.png`).
- [x] The strongest five/six screenshots are recommended for homepage use (above).

## What's still open

- **WebP exports were not produced** — `sips` (the only image tool available in this
  environment; no ImageMagick/cwebp/ffmpeg installed) can read WebP but cannot write it,
  confirmed by direct test. AVIF export works and was used instead. If the website pipeline
  specifically needs WebP, it needs a machine with `cwebp` (or Node's `sharp`, not installed
  here) — not something resolvable inside this task's environment.
- **The device-frame compositions are CSS-rendered, not a real device photograph or a
  purpose-built phone-bezel asset** — they reuse the site's own card radius/shadow rather than
  a literal phone silhouette, per the plan doc's own conclusion that a bezel-less treatment is
  the safer match to the site's existing (bezel-free) hero mockup. If the owner specifically
  wants a phone-bezel composition later, that's a deliberate design choice for them to make,
  not a gap in this pass.
- **The funded-progress-bar finding above** is a real product question for the owner, not an
  engineering task completed here — flagged, not fixed, per this task's own scope.
