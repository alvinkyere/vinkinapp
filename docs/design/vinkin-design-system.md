# VinkIn Design System — sourced from vinkin.org

Every value on this page was extracted directly from the live site's compiled output, not
estimated: the Next.js/Tailwind CSS bundle (`https://www.vinkin.org/_next/static/css/
dc8cdbf831146461.css`) and the rendered HTML (`https://www.vinkin.org`), fetched and
grepped on 2026-07-20. Where a value is a judgment call for the *app* (which the marketing
site doesn't need to make — e.g. a form input style), that's called out explicitly as
**app-derived**, not sourced.

## Colors

Five named colors, all used as opacity-modified utilities (`ink/15`, `paper/60`, etc.) rather
than a large fixed palette — the whole site runs on five hues.

| Name | Value | Role on the site |
|---|---|---|
| `ink` | `#0A0A0B` | Primary text on light backgrounds; the dark-section background (hero, "spot-vink" scrollytelling section); primary shadow tint |
| `paper` | `#F7F3EB` | Page background (`body` itself); light-section background; primary text *on* dark (`ink`) sections |
| `smoke` | `#6E6A61` | Secondary/muted text — a warm gray, never a cold gray |
| `blue` | `#315CFF` | The one accent color: primary CTA fill, progress-bar fill, links, focus rings, the droplet in the logomark |
| `blue-deep` | `#2247D6` | Hover/pressed state for `blue` |
| `white` | `#FFFFFF` | Used sparingly, distinct from `paper` (paper is warm cream, white is true white) |

No gradients on brand colors as flat fills — gradients are all **ink-opacity fades**
(`from-ink/80/85/90` → `via-ink/10-50` → `to-ink/20-40`, i.e. dark-to-transparent scrims over
photography), plus one CTA glow: `shadow-[0_16px_40px_-12px_rgba(49,92,255,.6)]` (a blue,
not ink, colored shadow, used only on the primary CTA).

## Typography

- **Display font**: `Bricolage Grotesque` (variable weight 200–800). Used for *all* headings
  **and all button labels** — buttons are not set in the body font.
- **Body font**: `Inter` (variable weight 100–900). Used for paragraph copy, form labels,
  participant names.
- **Monospace**: system stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
  "Liberation Mono", "Courier New", monospace`) — used narrowly, for a pulsing `...` "still
  deciding" indicator in the hero's live-card mockup. Not a general-purpose UI font.
- Heading line-height is tight: a `.display` utility class sets `line-height: .95` wherever
  the display font is used at heading sizes.
- Letter-spacing scale actually used: `tracking-tightest` (`-0.04em`, big display numerals
  and the wordmark), `tracking-tight` (`-0.025em`), `tracking-wide` (`+0.025em`, all button
  labels, uppercase), `tracking-widest` (`+0.1em`, the mono "..." indicator). There's also a
  dedicated `.eyebrow` style (`font-size: .7rem; letter-spacing: .28em`) for small overline
  labels like "Sound familiar?" — an even wider tracking than `tracking-widest`.
- Button labels are **UPPERCASE**, `font-display`, `font-bold`.

### Type scale (Tailwind's default scale, confirmed present in the bundle)

| Token | Size / line-height |
|---|---|
| `xs` | 12px / 16px |
| `sm` | 14px / 20px |
| `base` | 16px / 24px |
| `lg` | 18px / 28px |
| `xl` | 20px / 28px |
| `2xl` | 24px / 32px |
| `3xl` | 30px / 36px |
| `4xl` | 36px / 40px |
| `5xl` | 48px / 48px (leading none) |
| `6xl` | 60px / 60px |
| `7xl` | 72px / 60px |

The hero headline itself doesn't use the fixed scale at all — it's viewport-relative
(`text-[17vw]` down to `lg:text-[7.5rem]`), which doesn't translate to a phone app; the app
should treat `4xl`/`5xl` as its own "hero" ceiling.

### Font weights present

400 (normal, body copy), 500 (medium), 600 (semibold, participant names in the demo card),
700 (bold, buttons/labels), 800 (extrabold, headings and the demo card's title/amount).

## Border radius

| Token | Value | Observed use |
|---|---|---|
| `rounded-lg` | 8px | small elements |
| `rounded-xl` | 12px | — |
| `rounded-2xl` | 16px | inline pills (e.g. the "Sound familiar?" quote chip) |
| `rounded-3xl` | 24px | — |
| `rounded-[2rem]` | 32px (arbitrary value) | the hero's live-Vink-card mockup — the single closest real reference for what a Vink "card" component should look like |
| `rounded-full` | pill | **every button**, progress-bar track and fill, avatar/status circles |

## Shadows

Two colored, soft, large-radius shadows dominate — not Material's sharp default elevation:

- Card shadow (ink-tinted): `0 40px 100px -20px rgba(10,10,11,0.55)` on the hero mockup card;
  a lighter version `0 8px 24px -12px rgba(10,10,11,0.25)` for smaller surfaces.
- CTA glow (blue-tinted): `0 16px 40px -12px rgba(49,92,255,0.6)` — used to make the primary
  action visually "lift" off the page.
- Standard Tailwind `shadow-sm` / `shadow-lg` / `shadow-2xl` also present for smaller UI.

## Buttons

Every button on the site is `rounded-full` with generous horizontal padding and uppercase,
bold, wide-tracked `font-display` label text — never the body font, never sentence case.

| Variant | Classes (translated) | Use |
|---|---|---|
| Primary | `bg-blue text-white`, hover → `bg-blue-deep`; `px-9 py-4` (large) | "Join the waitlist" — the one dominant action per screen |
| Secondary (on dark) | `bg-paper text-ink`; `px-6 py-2.5` (compact) | nav-level actions on the dark header |
| Outline (on dark) | `border border-paper/35 text-paper`, hover → `border-paper bg-paper/10` | "Watch it work" — secondary action beside a primary CTA |
| Outline (on light) | `border border-ink/15 text-ink` | "Join a Vink" — quiet action on a light section |

**App-derived**: the site never shows a disabled, loading, or destructive button — those
states are the app's own responsibility. Recommendation: keep the pill shape and uppercase
display-font label for all of them; use `ink/40` opacity for disabled, keep `blue`/`blue-deep`
for loading (with a spinner replacing the label), and add a new *not-on-the-website* red for
destructive actions only (cancel a Vink) since the site has no error/danger palette to draw
from — flagged here rather than invented silently.

## Icons

Simple **line icons**: `stroke="currentColor" stroke-width="2" stroke-linecap="round"`,
`fill="none"`, no filled/solid icon anywhere observed. Sized small and consistent (`h-7 w-7`
in the header, `h-3 w-3` for micro-marks).

## Photography / image treatment

Full-bleed lifestyle photography (people at dinners, on trips) behind the dark hero and
scrollytelling sections, always under an `ink` gradient scrim (`from-ink/80` etc.) so
`paper`-colored text stays legible on top — never a flat color block standing in for a photo,
and never text directly on unmodified photography.

## Animation

- **Entrance**: fade + slide-up. Nearly everything above the fold starts at `opacity:0;
  transform:translateY(16–60px)` and animates to `opacity:1; transform:none` — a consistent,
  restrained reveal, not bouncy or elastic.
- **Scroll-driven storytelling**: two sections are enormous (`h-[450vh]`, `h-[600vh]`) with a
  `sticky` inner viewport — pinned-scroll animation (GSAP-ScrollTrigger-style), used to walk
  through "Someone always pays first → Then waits → Then reminds everyone → Again" and the
  7-step "how it works" sequence one beat at a time. **Not directly portable to a phone app**
  (no scroll-jacking in a mobile creation flow) — the *reveal timing/easing* is the
  transferable part, not the pinned-scroll mechanism itself.
- **Micro-interaction**: buttons lift slightly on hover (`hover:-translate-y-0.5`); a live
  "still deciding" participant state uses `animate-pulse` on monospace `...`.
- Standard transition property list: `color, background-color, border-color,
  text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter,
  backdrop-filter` — nothing exotic.

## Spacing rhythm

Section vertical padding is generous and consistent: `py-28` (112px) on mobile, `py-40`
(160px) on larger screens, for every full-width content section. Cards use `p-7` (28px)
internal padding. This is a spacious, unhurried layout, not a dense dashboard.

## Logo treatment

The mark (`viewBox="0 0 48 48"`) is two shapes:

1. An angular **V-shaped vessel**, filled `paper` (`#F7F3EB`) — path
   `M5 12h9.8L24 33.6 33.2 12H43L27.6 43h-7.2L5 12Z`.
2. A **droplet** sitting just above the V's opening, filled `blue` (`#315CFF`) — path
   `M24 2.5c2.8 3.6 4.4 6 4.4 8.2a4.4 4.4 0 0 1-8.8 0c0-2.2 1.6-4.6 4.4-8.2Z`.

Read together: an ink drop falling into a vessel — the literal "everyone's contribution fills
the Vink" idea, expressed once, quietly, in the mark itself. It is **not** repeated as a
literal liquid-fill animation anywhere else on the site — the actual product-preview card
(see below) uses a plain horizontal progress bar. The ink/droplet idea lives in the logo and
in copy ("The ink fills," "Each payment becomes a drop"), not as an animated UI metaphor
forced onto every progress indicator.

Wordmark: `"Vink"` in `paper`/`ink` + `"In"` in `blue`, one word, no space —
`font-display font-extrabold tracking-tightest`.

## The closest real reference for a "Vink card" component

The hero includes a live-product mockup (not just marketing chrome) — this is the single most
important source for the app's own Vink/lobby card design, reproduced here exactly:

```text
┌─────────────────────────────────────┐  rounded-[2rem], bg-paper, p-7,
│  Friday Dinner            $186       │  shadow-[0_40px_100px_-20px_rgba(10,10,11,.55)]
│                                       │  title: font-display lg extrabold tracking-tightest
│  ▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  amount: font-display 3xl extrabold tracking-tightest
│  (h-3, rounded-full, bg-ink/10 track,│
│   bg-blue fill, 20% width here)      │
│                                       │
│  Alvin                          ✓    │  name: font-semibold text-ink (paid) /
│  Sarah                         ...   │        text-smoke/70 (not yet)
│  Chris                         ...   │  ✓ badge: 20×20 circle, bg-blue, white ✓, bold
│  Maya                          ...   │  "..." : font-mono tracking-widest;
│  Jo                            ...   │          text-blue + animate-pulse if *currently*
│                                       │          resolving, text-smoke/50 if just waiting
└─────────────────────────────────────┘
```

This is the direct blueprint for `VinkSurfaceCard` + `VinkProgressIndicator` +
`VinkParticipantRow` below.

## Tone of voice (exact copy, not paraphrased)

- Tagline: **"Everyone In. One Purchase."** (not "One Payment." — the actual site copy)
- Sub-line: "Pay together before anyone pays."
- Problem framing, one beat per line: "Someone always pays first." / "Then waits." / "Then
  reminds everyone." / "Again." / "Sound familiar?" — followed by a chorus of quoted
  complaints: *"I'll send it later." "Wait, how much?" "Who paid?" "Can you remind me?" "I
  forgot." "Can someone cover it?"*
- Process, one short line each: "Create a Vink — Name it. Set the amount." / "Share the
  code" / "Friends join" / "The ink fills" / "A card appears" / "The purchase happens" /
  "The card disappears."
- Use-case pattern, consistently "[Scenario] — Nobody [verb]s [the pain]": "Dinner — Nobody
  fronts the table." "The trip — Nobody covers the deposit." "The birthday — Nobody collects
  Venmos." "Groceries — Nobody remembers later." "Rent — Nobody becomes the lender."
  (This is the model for the app's own empty-state and completion copy.)
- The word itself gets a dictionary treatment: **"/vɪŋk/ · noun — One shared purchase. One
  temporary checkout. One payment."**
- Card technology, one word + one line each: "Temporary. — The card exists for this purchase
  only." "One-time. — It works once. Then never again." "Merchant-locked. — Spendable only
  where the group intended." "Self-expiring. — No lingering numbers. Nothing to cancel."
  "Never reused. — Every Vink gets a brand-new card." **This is the exact register to use for
  the app's pilot-simulation disclosure** — plain, confident, short declarative sentences,
  not a legal disclaimer voice.
- Register overall: short declarative sentences, second person implied rather than stated,
  warm and a little wry, never corporate or institutional, never exclamation-heavy. Nav uses
  "Moments" rather than "Use Cases" — everyday language over category-speak throughout.

## What this means for the Flutter app

- Warm cream (`paper`) backgrounds, not cold gray or pure white, with near-black (`ink`) text
  and one electric blue (`blue`) accent — that's the entire palette; resist adding more hues.
- `Bricolage Grotesque` for every heading and every button label (uppercase, bold, wide
  tracking); `Inter` for everything else.
- Pill-shaped (`rounded-full`) buttons everywhere, generous padding, soft colored shadows
  instead of flat Material elevation.
- The Vink/lobby card is the site's own hero mockup, reproduced faithfully: `paper` surface,
  large radius, title + amount header, a plain blue progress bar (not a literal liquid
  animation), a participant list with a filled-blue checkmark circle for "paid" and a muted
  monospace ellipsis for "waiting."
- Copy throughout the app should read like the site: short, warm, concrete, never raw
  backend state names, never institutional banking language.
