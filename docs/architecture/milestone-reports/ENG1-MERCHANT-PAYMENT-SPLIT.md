# Milestone Report — ENG1 §7 (Organizer Merchant-Payment Pathway)

Date: 2026-07-21 · Track: engineering (owner-supplied ENG0–ENG15 plan) · Scope: verify
whether "organizer contributes personal share" and "organizer spends the completed pooled
payment" are unambiguous, distinct engineering intents, per the brief's own instruction.

## Finding: already satisfied, no code change

Three distinct, unambiguous application commands already exist and were audited against the
brief's own example names:

| Brief's example name | Existing command | What it does |
|---|---|---|
| `ApproveOrganizerContribution` | `authorizeContributionCommand` (`packages/application/src/contributions.ts`) | The organizer's own "Pay my $X" — literally the same command every participant uses, resolved by the caller's own user id (PV13's own rule: never a shortcut, never a hidden default). |
| `RequestMerchantAuthorization` | `authorizeMerchantPurchaseCommand` (`packages/application/src/purchases.ts`) | VinkIn's own §17 merchant-authorization decision. |
| `CaptureMerchantPurchase` | `settlePurchaseCommand` (`packages/application/src/purchases.ts`) | Capture/settlement, reconciling against the authorization. |

No naming collision, no shared/ambiguous code path between contribution and merchant-purchase
commands — different nouns (`Contribution` vs. `MerchantPurchase`), different tables, different
callers. Both `apps/api/src/modules/purchases/routes.ts` (simulator surface) and
`apps/api/src/modules/ops/routes.ts` (PV11 operations console) call the exact same two
merchant-side commands under the exact same names — confirmed no drift between the two
transports.

## The one real finding: a framing mismatch, not a gap

The brief's own phrasing — "organizer spends the completed pooled payment" — implies an
organizer-initiated in-app action. That doesn't match VinkIn's actual product design: the
organizer taps a **physical/virtual temporary card at a real register**; the *merchant's*
terminal is what triggers authorization and capture (in the pilot, simulated via the
operations console standing in for a real merchant terminal — see PV11's report: "the two
action routes call the exact same PV6 application commands... no new financial logic"). There
is no "spend the pool" button anywhere in the organizer app today (confirmed by reading
`apps/mobile/lib/features/vink_lobby/vink_lobby_screen.dart`'s `_CardCard` — purely
informational, no authorize/capture actions), and per the product's own physical-card-tap
model, there shouldn't be one — the app's role ends at provisioning the card and showing its
status.

This was flagged to the owner rather than resolved silently one way or the other (per the
"Spec/product changes are flagged, never made silently" hard rule): confirmed the intended
resolution is to treat the underlying engineering intents as already unambiguous — no
organizer-facing "spend" trigger needed, no wrapper command needed — and record the framing
mismatch here rather than leaving it undocumented.

## Files changed

None. This milestone is a verification finding, documented per §45's report requirement even
though no code changed.

## Exit gate

- [x] Organizer's own contribution and the merchant-payment pathway are distinct, unambiguous
      engineering intents — verified against the actual command implementations, not assumed.
- [x] No naming or code-path ambiguity found between the three intents.
- [x] The one place the brief's framing didn't match the actual architecture (organizer-
      initiated vs. merchant-initiated) was flagged and resolved with the owner, not guessed.

## Next milestone

ENG1's own list is now exhausted (§1 Connecting-hang fix, Slice 2 idempotent creation, Slice 3
setup recovery, Slice 4 retry classification + duplicate protection, timer semantics, and now
§7 merchant-payment split are all done). Per the milestone sequence in the owner's original
ENG0–ENG15 plan, next is **ENG2 — Contract Engineering** (typed API contracts, command/query
endpoint separation audit, interaction event contracts, schema validation, API versioning
policy) — an owner decision on whether to proceed there now.
