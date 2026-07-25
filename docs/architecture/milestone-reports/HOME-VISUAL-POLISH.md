# Home / category visual polish (Slice 3 of the mockup-gap plan)

**Brief:** the third and final slice of the owner-directed mockup-gap plan, per the plan's own
scoping: "small, independent, low-risk" items — participant avatar circles on Home's active-
Vink card (the `VinkAvatar` component already exists and is used elsewhere, just never wired
into Home), category icons (Material icons, no new assets), and a guard grep for any
wallet/balance-adjacent copy per the earlier "relabel, don't build a wallet" decision.

## What shipped

- **Participant avatar circles**, organizer-role cards only. `ActiveVink` (`home_providers.dart`)
  gained `participantNames: List<String>` — real display names for an organizer-role entry
  (already-fetched via `getSnapshot`), deliberately **empty** for a participant-role entry.
  This isn't an oversight: `ParticipantVinkView` never carries another participant's identity
  (D24/D25), so there is nothing privacy-safe to show for that role — the card falls back to
  its existing plain "N people" icon+text instead of inventing data it doesn't have. New
  `_ParticipantAvatarStack` (private to `home_screen.dart`) shows up to 3 overlapping
  `VinkAvatar` initials circles plus a "+N" overflow chip, reusing the existing avatar
  component (already used on Create Vink, Lobby, Profile) rather than building a new one.
- **Category icons**: new `purchaseCategoryIcon()` in `purchase_category.dart` (Material icons
  only — `local_grocery_store_outlined`/`storefront_outlined`/`devices_outlined`, generic
  fallback for anything else), rendered in a small tinted circle before the title on Home's
  active-Vink card. Cosmetic only, same "wire value is still the raw enum" discipline
  `purchaseCategoryLabel` already established.
- **Wallet/balance copy guard**: a repo-wide grep for wallet/balance-adjacent phrasing across
  `apps/mobile/lib` and `apps/guest-web`'s app/features directories. Clean — no such copy
  exists anywhere, confirming this really was a forward-looking guard (per the owner's
  "relabel, don't build a wallet" decision from earlier in this session), not a fix to
  anything that had shipped.

## Tests

- `test/features/home/home_screen_test.dart`: two new tests — an organizer-role card with
  real participant names renders `VinkAvatar` widgets (not the plain people icon); a
  participant-role card (empty `participantNames`) falls back to the plain icon, never an
  avatar standing in for someone else's identity.
- `test/features/create_vink/purchase_category_test.dart`: every supported category has its
  own distinct icon; an unrecognized category falls back to a generic icon rather than
  throwing.
- Full `flutter test`: **237/237** green (up from 233). `flutter analyze` clean at the
  documented 11-issue baseline.

## Real-device note

Covered by the dedicated real-device runs already performed for Invites and I7 in this same
session (both of which render Home's active-Vink card, now carrying Slice 3's avatar/icon
changes, without incident). A combined all-three-flags real-device run was attempted but hit
two forms of pre-existing, unrelated noise rather than a Slice 3 defect: `e1_test.dart`'s own
hardcoded assertion text (written for the old `VinkProgressIndicator` label, never updated for
`INK_PROGRESS_VESSEL` — expected, since that test's purpose is the flag-*off* rollback
baseline, not a new-flag combination), and a long-session-accumulated Postgres/mock-provider ID
collision (`idx_purchase_auth_provider`, the same class of dev-environment cruft this
project's own prior milestone reports have already documented recurring). Neither is a defect
in this slice's own code; both are noted here rather than silently worked around. Given Slice 3
is pure, additive visual polish reusing already real-device-proven components (`VinkAvatar`,
static Material icons) with solid widget-test coverage, further real-device chasing here was
judged low-value against the noise encountered.

## Is this slice fully closed?

Yes. All three named items (avatars, category icons, the copy guard) are done, tested, and
validated. This closes out the full three-slice mockup-gap plan (Invites → I7 → this slice).
