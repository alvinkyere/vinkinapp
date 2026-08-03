# Website screenshot placement plan

Source: `https://www.vinkin.org/` fetched directly (raw HTML + inline Tailwind classes), not
summarized — same discipline as `docs/design/vinkin-design-system.md`.

## Finding: the live site has no real product screenshots today

This matters for the whole plan. `vinkin.org` currently shows exactly two kinds of visuals:

1. **Stock lifestyle photography** — `next/image` fills (`restaurant-table.jpg`,
   `airport-checkin.jpg`, `birthdays-candles.jpg`, `groceries-aisle.jpg`, `kitchen-dark.jpg`),
   full-bleed with `object-cover`, used as section backgrounds for the "moments" list.
2. **One hand-coded UI mockup**, not a screenshot — a static HTML/CSS reproduction of a Vink
   card (`rounded-[2rem] bg-paper p-7 shadow-[0_40px_100px_-20px_rgba(10,10,11,0.55)]`,
   documented exactly in `vinkin-design-system.md`'s "closest real reference" section) sitting
   in the hero. A second, smaller card (`w-80 rounded-[2rem] bg-paper p-8 shadow-2xl`) appears
   near the "A card built to disappear" section, about the temporary card concept.

There is no existing device-frame convention, no phone-mockup composition pattern, and no
screenshot gallery to match. This plan therefore **proposes** placements using the site's own
already-established visual language (colors, radius, shadow, spacing, section rhythm) rather
than reverse-engineering a convention that doesn't exist yet. Nothing here changes the live
site — these are asset specs for screenshots the owner can drop in later.

## Established visual language to match (verified in the raw CSS/HTML, not guessed)

- Card radius: `rounded-[2rem]` (32px) for the one real "product" card on the page; `rounded-2xl`
  (16px) for smaller UI chips.
- Card shadow: `shadow-[0_40px_100px_-20px_rgba(10,10,11,0.55)]` — a soft, deep, ink-tinted
  shadow, not a generic drop shadow. Reuse this exact value for any screenshot card, and for
  device-frame compositions.
- Card surface: `bg-paper` (`#F7F3EB`), even when the surrounding section is `bg-ink` — the
  card is always a warm cream "island," never white, never the page's own background color.
- Section rhythm: `py-28` mobile / `py-40` desktop vertical padding — screenshots placed in a
  feature section should sit inside that same generous whitespace, not edge-to-edge.
- No glossy 3D tilts, no reflections, no glassmorphism anywhere on the existing site — matches
  this milestone's own instruction not to use "stereotypical AI-generated fintech design."

## Screenshot treatment by placement

| Placement | Treatment | Desktop | Mobile | Aspect ratio | Device frame later? | Safe space needed |
|---|---|---|---|---|---|---|
| Hero device screenshot | Standalone rounded image, no phone bezel (matches the site's own bezel-less card mockup) | ~420px wide, right-aligned next to headline | Full-width below headline, ~85vw | 9:19.5 (iPhone native, ~1206:2622 at 3x) | Optional — a subtle frame is acceptable since the hero already reads as "product," but the bezel-less card treatment is the safer default match | Top 15% clear (status bar area) so a frame edge or headline overlap never covers content |
| "See VinkIn in action" feature section | `rounded-[2rem]`, `shadow-[0_40px_100px_-20px_rgba(10,10,11,0.55)]`, `bg-paper` padding around the screenshot if the screenshot itself doesn't already fill to those edges | Single large screenshot, ~560px wide, centered or left of supporting copy | Full-width, same radius/shadow | 9:19.5 | No — bare rounded image only, exactly like the existing hero mockup | None required; screenshot is self-contained |
| Split feature ("Know exactly who pays what") | Same rounded-card treatment as above, paired with a one-line supporting message to its side (desktop) or below (mobile) | ~480px wide | Full-width | 9:19.5 | No | Bottom 10% clear if a caption overlaps |
| Guest-flow feature ("No app required") | Two-up: organizer phone (small) + guest-web card (smaller, browser-frame-free) side by side, echoing the site's own two-card layout near "A card built to disappear" | Two cards, organizer ~360px / guest ~320px, offset vertically like the site's rotated chip stack | Stacked, organizer first | Organizer 9:19.5, guest 9:16 (browser viewport, not a phone) | No | Overlap margin between the two cards should not cover either card's primary content (top third) |
| Homepage hero composition (primary + secondary phone) | Primary phone dominant, secondary phone partially behind/beside it, small web card floating near the bottom edge — matches the site's own layered-chip composition near "A card built to disappear," not a generic marketing "phone fan" | Primary ~440px, secondary ~340px offset -60px, web card ~240px | Primary only; drop the secondary phone and web card on narrow viewports | Primary/secondary 9:19.5, web card 9:16 | Yes, for this composition only — subtle, no tilt beyond what the site's own rotated chips already use (±1–2°) | Primary phone's key content (progress bar + participant rows) must stay fully unobstructed by the secondary phone |
| Contact sheet / internal comparison | Flat grid, no frames, no shadows — documentation artifact, not a website asset | N/A | N/A | Grid of masters at native aspect | No | N/A |

## Aspect ratios actually captured

- **Organizer (iPhone 16 Pro simulator, native resolution)**: 1206×2622 px (3x), i.e. 9:19.55.
  Website crops should preserve this ratio; do not letterbox or pad the master PNGs.
- **Guest-web (mobile viewport)**: 393×852 CSS px (iPhone-16-Pro-equivalent viewport),
  captured at 3x device-scale-factor where the tooling supports it → 1179×2556 px, 9:19.55 —
  matched to the organizer ratio deliberately so both slot into the same device-frame width in
  a composition without a visible seam.

## What this plan does not do

It does not change any file under `apps/guest-web` (marketing site is out of scope — the
website itself is `vinkin.org`, a separate property this repo does not contain). It only
specifies how the captured product screenshots (this repo's own deliverable) should be sized,
shaped, and composed so they drop into the site's existing visual language without the owner
needing to redesign anything.
