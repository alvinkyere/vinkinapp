# Mobbin Reference Index (R0)

Design-input checkpoint before I6, per the owner's R0 brief. This index inventories what's
available locally and where it feeds the remaining UX-track slices. **Mobbin references are
supporting evidence for hierarchy, density, and pattern comparison — they are never the source
of product truth.** Existing VinkIn decisions (`docs/spec/decision-log.md`, D19–D42) and design
contracts (`docs/design/phase-4-screen-contracts.md` onward) remain authoritative. Where a
Mobbin reference conflicts with the VinkIn plan, the VinkIn plan wins, and the conflict is
reported explicitly rather than silently resolved (see each per-slice doc's own
"Contradictions or unresolved questions" section).

## Source location and repository safety

Raw screenshots live at `~/Downloads/Mobbin UI Screens/` — **outside this repository entirely**
(not under `~/code/vinkin`), so they cannot be accidentally committed by any normal git
operation. `.gitignore:30` additionally lists `Mobbin UI Screens/` as a defensive pattern in
case a local copy or symlink ever ends up inside the repo. No raw third-party screenshot has
been or will be copied into committed documentation — every reference below is cited by
application name and local source filename (a bare number, e.g. "Monzo 115") plus a written
description. Anyone with access to the local Mobbin export can locate the exact file from the
citation; the repository itself carries no image bytes.

## Available applications

| Application | Platform/date | File count | Priority slice(s) |
|---|---|---|---|
| Cash App | iOS, Nov 2025 | 236 | I6, I9, I10 |
| Monzo | iOS, Jul 2024 | 363 | I6, I9 |
| Revolut | iOS, May 2025 | 656 | I6, I9, I11 |
| Wise | iOS, Jan 2026 | 770 | I6, I8 |
| Venmo | iOS, Oct 2023 | 166 | I6 (primarily as a documented anti-pattern source) |
| Splitwise | iOS, Jan 2026 | 178 | I6 (secondary — group/participant context only), I7 |
| Apple Wallet | iOS, Mar 2026 | 132 | I10, I11 |
| Klarna | iOS, Nov 2024 | 243 | I8 |
| N26 | iOS, Nov 2025 | 314 | I9 |
| Partiful | iOS, Oct 2025 | 234 | I7, I8, I10 |
| PayPal | iOS, Jul 2023 | 221 | I8, I11 |
| Uber Eats | iOS, Apr 2026 | 503 | I7 (group-ordering reference) |

**4,016 image files total** (4,017 including `.DS_Store`) across 12 applications. All 12 apps
named across the owner's full six-slice reference table (I6–I11) are present locally — no
collection is missing its source material, though only I6's five priority apps
(Cash App/Monzo/Revolut/Wise/Venmo, plus Splitwise as secondary) have been inspected and
cataloged so far, per this pass's own scope boundary ("stop after the I6 reference pack").

**Filenames carry no semantic information.** Every file is named `<App> <platform/date>
<sequential number>.png` (e.g. "Monzo ios Jul 2024 115.png") — not grouped by flow, screen
name, or feature. This was confirmed by direct inspection before cataloging began. Every
finding in the per-slice documents below is the result of an agent actually opening and
visually inspecting the image, never inferred from a filename.

## Flow categories used for I6 cataloging

The 16 screen/state categories used to classify I6-relevant screenshots (Home empty / Home one
active / Home multiple active / Activity list / Activity grouping / pending outcome / failed
outcome / cancelled outcome / returned outcome / completed outcome / transaction detail
hierarchy / loading / empty / offline-reconnect / partial failure / support entry point) are
defined in full, with findings per category, in `i6-home-activity-details.md`.

## Coverage by future slice

| Slice | Reference apps (owner's table) | Status |
|---|---|---|
| I6 — Home, Activity, Vink Details | Cash App, Monzo, Revolut, Wise, Venmo (Splitwise secondary) | **Done this pass** — see `i6-home-activity-details.md` |
| I7 — Live Vink and Ink Progress | Splitwise, Partiful, Uber Eats/DoorDash group ordering | Not started — source material present (Splitwise already partially inspected for I6's group-context needs; Partiful and Uber Eats not yet opened) |
| I8 — Guest Web | PayPal, Partiful, Klarna, Wise web checkout | Not started |
| I9 — Reauthentication | Revolut, Monzo, N26, Cash App | Not started |
| I10 — Motion | Apple Wallet, Cash App, Partiful | Not started |
| I11 — Ready to Pay | Apple Wallet/Apple Cash, PayPal, Revolut | Not started |

Per the owner's own instruction, later collections are prepared before their corresponding
slice, not all at once — I7–I11 are intentionally left uninspected by this pass.

## Inventory summary — I6 pack (this pass)

| App | Files in folder | Images actually opened | Strong I6 examples retained |
|---|---|---|---|
| Cash App | 236 | ~90 | 13 |
| Monzo | 363 | ~160 | 20 |
| Revolut | 656 | ~120 | 15 |
| Wise | 770 | ~160 | 19 |
| Venmo | 166 | ~102 | 12 (incl. 6 documented reject-examples) |
| Splitwise | 178 | ~70 | 13 |
| **Total** | **2,369** | **~702** | **~92 distinct references** |

Six inspection passes ran in parallel, one per application, each with app-specific guidance
(e.g. Revolut and Wise were told to skip crypto/stocks/investing entirely; Venmo was told to
treat its social feed as a documented anti-pattern rather than skip it; Splitwise was scoped
narrowly to group/participant-context screens only, per the owner's own "use Splitwise only
where group context or participant identity materially helps" instruction).

## Duplicate / unusable-reference notes

Every per-app pass reported its own duplicate/near-duplicate clusters and irrelevant-screen
counts; full detail is in `i6-home-activity-details.md`'s reference matrix. In summary:

- **Near-duplicate clusters are common** and were consolidated to one representative image per
  cluster rather than cataloged individually — e.g. Revolut's Party "Settle up" sequence
  (4 sequential states), Wise's personal-Home balance card at three slightly different mock
  amounts, Splitwise's three scroll positions of the same expense-detail screen, Monzo's
  red-balance-card Home template recurring near-identically across personal/business/dark-mode
  variants.
- **Unusable/irrelevant volume was large**, as expected for full-app design captures: roughly
  55–65% of every sampled set was onboarding/marketing carousels, KYC/identity verification,
  crypto/stocks/investing, card-ordering/design flows, budgeting, or settings/administration —
  none of it touches Home/Activity/transaction-outcome/support content and none of it was
  force-fit into the I6 categories.
- **No app supplied every one of the 16 categories.** Failed-outcome, offline/reconnect, and
  partial-failure-list states were the most commonly absent across the whole I6 pack (absent or
  only indirectly evidenced in 4–5 of the 6 apps each) — reported as genuine gaps in each
  per-app write-up, not approximated with a lookalike screen.

## Repository handling rules (binding for every future Mobbin document in this tree)

1. Never copy a raw screenshot into the repository. Cite by application name + local source
   filename (the bare sequential number) only.
2. Committed documents may contain: application names, source filenames, textual descriptions,
   pattern analysis, original diagrams, and VinkIn-specific recommendations.
3. A Mobbin reference may demonstrate hierarchy, density, progressive disclosure, and proven
   loading/empty/failure/terminal-state patterns. It may never override D19–D42, introduce a
   product feature, change financial semantics, create a social feed, add
   budgeting/banking/investing/rewards/merchant-analytics surfaces, introduce percentage
   splitting or fees, replace the Ink Progress System, determine provider-specific payment
   behavior, or result in literal copying of another product's screen.
4. Any contradiction a reference reveals between an app's pattern and an already-settled VinkIn
   decision must be reported explicitly in the relevant per-slice document, never quietly
   resolved by changing the implementation to match the reference.
