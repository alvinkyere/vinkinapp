# Open Questions

Questions with real product/legal tradeoffs — surfaced, not silently decided (Spec §9). When
one resolves: record the resolution in `decision-log.md`, update the affected docs, and mark
it CLOSED here with a pointer. Proposed defaults are engineering suggestions only; nothing is
built on a PROPOSED default if the answer could invalidate it.

## Existential (Milestone 0 gate; block everything downstream)

| ID | Question | Owner | Where it's framed | Status |
|---|---|---|---|---|
| G1 | Which financial provider stack? (Stripe-only / Stripe+Lithic / BaaS+FBO) | PO+ENG | `docs/provider-integration/00-provider-feasibility.md` §2 | OPEN — outreach package ready to send |
| G2 | Is the funds flow legally operable without VinkIn's own MTL licensure? | LEGAL | `docs/feasibility/counsel-questionnaire.md` §1 | OPEN |
| G3 | May a consumer organizer spend pooled funds on a platform-issued card? (program design) | PO via provider | `docs/feasibility/provider-questionnaire.md` §A | OPEN |

## Design (resolve before the milestone that builds on them)

| ID | Question | Needed by | Proposed default | Status |
|---|---|---|---|---|
| G4 | Guest token security: TTL, binding, verification factor for §31 `verify` | M4 | signed opaque token, 15-min TTL, single-slot binding; SMS OTP above amount threshold | OPEN — validation-build subset implemented as D14 (hashed opaque token, single-slot, 7-day TTL, no OTP); production questions unresolved |
| G5 | Auth: in-house OTP vs. delegated identity | M2 | in-house phone OTP + short-lived JWT / rotating refresh | OPEN |
| G6 | Realtime transport | M3 | SSE for guest web, WebSocket for Flutter, one outbox-fed stream | OPEN |
| G7 | Split rounding rule | M3 | largest-remainder; organizer absorbs residual; property-tested | OPEN |
| G8 | EXACT_FINAL slippage values (§20) | M7 | `max(100 minor units, 1%)` capped at $5, per-category override, frozen per Vink | OPEN |
| G9 | Grace timings (§14 "recommended initial") | M5 | adopt §14 numbers as config defaults (T−15s close, T+60s grace) | OPEN |
| G10 | Post-capture participant adjustment charging (§22 PARTICIPANT_PREAUTHORIZED) | M0→M8 | verify off-session charging in S10; fallback organizer-only adjustments | OPEN — tied to questionnaire §E17 |
| G11 | KYC depth + vendor for organizer verification | M2 | provider-hosted verification; follows G1/G3 | OPEN |

## Resolved

| ID | Question | Resolution |
|---|---|---|
| G12 | Notification channels for time-critical events | CLOSED → D19 (owner 2026-07-20): automatic SMS/email guest delivery is canonical (members get in-app invitations); manual Copy Link/Share/QR remain available as fallback in every case; delivery mechanism itself not yet built |
| G13 | Unspecified PV §8/§9 state-machine edges (FUNDING_REVERSAL exit; CANCELLATION_PENDING outcomes; RESOLUTION_PENDING exits; DRAFT cancellation) | CLOSED → D11 amendment (owner 2026-07-17): ratified exactly as implemented in `packages/domain`; DRAFT cancellation stays unmodeled |
| G14 | Reconcile PV vs doc 03 state vocabulary | CLOSED → D11 amendment: PV names canonical everywhere; alternate vocabulary retired; doc 03 rewritten |
