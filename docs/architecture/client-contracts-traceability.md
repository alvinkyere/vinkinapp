# Client Contracts Traceability Map

_ENG2 (Contract Engineering), remaining scope: typed screen/view-model contracts and typed
interaction-event contracts. Source of truth for every row below:
`docs/design/phase-4-screen-contracts.md` ("Phase 4") and
`docs/design/phase-5-button-interaction-contracts.md` ("Phase 5"). Every row is also asserted
by `packages/client-contracts/src/traceability.test.ts` — this document and that test are kept
in sync mechanically (the test reads this file and fails if a screen source string or event
name it expects is missing), not by convention alone._

**Scope note:** this document and the `@vinkin/client-contracts` package it describes define
and verify types. Neither rewires `apps/mobile` or `apps/guest-web` to consume them — that is
implementation work, out of scope for this ENG2 slice (see the milestone report,
`milestone-reports/ENG2-CLOSURE-TYPED-CONTRACTS.md`, for the exact boundary and why).

---

## 1. Screen / view-model contracts (17 canonical surfaces)

Phase 4 numbers 14 sections (§1–§14); §5 is expanded into its own three sub-screens (§5a/§5b/
§5c — §5d is explicitly "not canonical" per Phase 4's own text and has no contract), and §6's
title ("Live Vink — Lobby, organizer/member") covers two distinct backend reads today
(organizer-only `VinkSnapshot` vs. the member-only `ParticipantVinkView` Slice I2B added) — so
17 typed contracts in total.

| Contract (`packages/client-contracts/src/screens.ts`) | Phase 4 source | Reuses | Status |
|---|---|---|---|
| `WelcomeScreenContract` | Phase 4 §1 Welcome | new | Built |
| `LoginFormState` / `LoginRequest` / `LoginResult` | Phase 4 §2 Login | new | Built |
| `RegisterFormState` / `RegisterRequest` / `RegisterResult` | Phase 4 §3 Register | new | Built (core fields) + New (contact info, D19/D27) |
| `HomeScreenViewModel` / `HomeVinkCardViewModel` | Phase 4 §4 Home | `RoleAnnotatedVink` | Built (vink/role) + New (progress/attention bucketing) |
| `CreateVinkPurposeAndTotalState` | Phase 4 §5a Create Vink — Purpose and total | new | Built |
| `CreateVinkPeopleAndSplitState` / `CreateVinkParticipantRow` | Phase 4 §5b Create Vink — People and split | new | Built (Equal/Custom) + New (automatic delivery choice, D19/D27) |
| `OpenVinkConfirmationViewModel` | Phase 4 §5c Create Vink — Open Vink confirmation | new | Redesign (D30) |
| `LobbyScreenViewModel` | Phase 4 §6 Live Vink — Lobby (organizer branch) | `VinkSnapshot` | Built |
| `GuestNotOpenYetViewModel` | Phase 4 §7 Live Vink — Guest: Not Open Yet (D23) | `NotOpenYetView` | Built |
| `GuestJoinFormViewModel` | Phase 4 §8 Live Vink — Guest: Join Form | `EnrichedPublicVinkSummary` | Built (vink) + New (pre-join share) |
| `GuestSessionViewModel` | Phase 4 §9 Live Vink — Guest: Session View | `GuestVinkViewResult` | Built |
| `ParticipantSessionViewModel` | Phase 4 §6 Live Vink — Lobby (member branch, Phase 3 §1 Slice I2B) | `ParticipantVinkView` | Built |
| `ActivityListViewModel` / `ActivityListEntryViewModel` | Phase 4 §10 Activity (list) | new | New — designed, not built |
| `ActivityVinkDetailsViewModel` | Phase 4 §11 Activity — Vink details (D29/D31) | new | New — designed, not built |
| `ProfileViewModel` | Phase 4 §12 Profile | new | Built (identity) + New (contact/support, D19/D27/D28) |
| `GuestTokenRedeemState` | Phase 4 §13 Guest token-redeem page | new | Built |
| `ReauthOverlayViewModel` | Phase 4 §14 Cross-cutting: In-place re-auth prompt (D26) | new | New — designed, not built |

Four of these types are declared as a bare type alias to a real, already-shipped
application-layer type (`export type X = <real type>`), not a hand-copied shadow —
`packages/client-contracts/src/screens.test.ts` asserts this at compile time
(`Expect<Equal<LobbyScreenViewModel, VinkSnapshot>>` and three siblings), so a future change to
`VinkSnapshot`/`GuestVinkViewResult`/`NotOpenYetView`/`ParticipantVinkView` that isn't reflected
here fails `tsc --noEmit`, not silently drifts.

**Known gap, flagged not invented:** `HomeVinkCardViewModel.purposeLabel`,
`LobbyScreenViewModel`'s (via `VinkSnapshot.vink`) implied purpose display,
`ActivityListEntryViewModel.purposeLabel`, and `ActivityVinkDetailsViewModel.purposeLabel` all
type a "purpose" concept Phase 4 requires visibly on every one of those screens — but the
domain `Vink` entity (`packages/domain/src/entities.ts`) has **no freeform purpose/name field
at all**. This is the same gap `milestone-reports/PV13.md` already flagged to the owner. This
document types those fields as `PurchaseCategory` (the one real field that exists today) with
an explicit doc comment, not as an invented `purpose: string` pointing at nothing.

---

## 2. Interaction-event contracts (46 distinct event names, 31 of 45 Phase 5 contracts)

31 of the 45 Phase 5 interaction contracts (C1–C45) carry an `Analytics:` line; the other 14
(C6, C7, C11–C14, C28, C29, C38–C43) are pure state-driven visuals, disabled/no-op states, or
passive screens and emit nothing — listed in full in §3 below. Two name-sharing pairs mean 31
contracts still produce 46 distinct event names: C23/C24 share all 3 of their names verbatim
("Identical contract to C23 — same endpoint, same UI," Phase 5's own text), and C17/C19 share
`invitation_fallback_opened` (same sheet, two ways to reach it — `reason: 'delivery_failed'`
vs. `reason: 'manual'`).

| Event name | Payload | Phase 5 id(s) |
|---|---|---|
| `welcome_login_tapped` | none | C1 |
| `welcome_register_tapped` | none | C2 |
| `login_attempted` | none | C3 |
| `login_failed` | `{ code }` | C3 |
| `registration_attempted` | none | C4 |
| `registration_failed` | `{ code }` | C4 |
| `create_started` | none | C5 |
| `participant_add_attempted` | none | C8 |
| `participant_added` | `{ role }` | C8 |
| `participant_edited` | none | C9 |
| `participant_removed` | none | C10 |
| `vink_open_attempted` | none | C15 |
| `vink_opened` | none | C15 |
| `vink_open_failed` | `{ code }` | C15 |
| `invitation_dispatch_attempted` | `{ count }` | C16 |
| `invitation_delivered` | `{ participantId }` | C16 |
| `invitation_delivery_failed` | `{ participantId }` | C16 |
| `invitation_fallback_opened` | `{ participantId, reason }` | C17, C19 |
| `invitation_resend_attempted` | `{ participantId }` | C18 |
| `invite_link_copied` | none | C20 |
| `invite_share_sheet_opened` | none | C21 |
| `invite_qr_shown` | none | C22 |
| `contribution_attempted` | none | C23, C24 |
| `contribution_confirmed` | none | C23, C24 |
| `contribution_declined` | none | C23, C24 |
| `guest_contribution_attempted` | none | C25 |
| `guest_contribution_confirmed` | none | C25 |
| `guest_contribution_declined` | none | C25 |
| `contribution_retry_attempted` | none | C26 |
| `vink_cancel_attempted` | none | C27 |
| `vink_cancelled` | none | C27 |
| `card_provisioning_started` | none | C30 |
| `pay_now_entered` | none | C31 |
| `vink_completed` | none | C32 |
| `activity_row_opened` | none (envelope `vinkId`) | C33 |
| `vink_details_opened` | none (envelope `vinkId`) | C34 |
| `contact_info_updated` | none | C35 |
| `password_change_attempted` | none | C36 |
| `password_changed` | none | C36 |
| `support_contact_opened` | `{ source }` | C37 |
| `reauth_prompted` | none | C44 |
| `reauth_succeeded` | none | C44 |
| `reauth_cancelled` | none | C44 |
| `offline_detected` | none | C45 |
| `reconnected` | none | C45 |
| `generic_error_shown` | `{ context }` | C45 |

`activity_row_opened{vinkId}` and `vink_details_opened{vinkId}` are documented in Phase 5 with
`vinkId` in their payload braces, but this package's envelope
(`VinkinAnalyticsEventEnvelope`, mirroring the real, already-shipped
`apps/api/src/modules/analytics/routes.ts` Zod schema) already carries `vinkId` as a top-level,
optional field on every event — so these two events' `properties` are typed empty and `vinkId`
is carried once, on the envelope, never duplicated inside `properties`.

---

## 3. Interactions with no analytics event (14 of 45)

C6, C7, C11, C12, C13, C14, C28, C29, C38, C39, C40, C41, C42, C43 — pure state-driven visuals
(the ink vessel, split-method toggles, guest terminal states), form fields with no discrete
tap event, or contracts whose entire behavior is "no action exists" by definition (e.g. C38
"Guest not-open-yet behavior," C43 "Guest recovery-required behavior"). Absent from
`packages/client-contracts/src/events.ts` on purpose — `traceability.test.ts` asserts this set
plus the 31 analytics-covered ids together equal exactly C1–C45, with no gaps and no double
counting.

---

## 4. Known drift from currently-shipped analytics event names (flagged, not silently fixed)

Real, already-shipped code emits ad hoc event names from PV9/PV12-prep that predate Phase 5 and
do not match its approved vocabulary:

| Shipped today | Where | Closest Phase 5 name |
|---|---|---|
| `organizer_registered` | `apps/mobile/lib/core/auth/auth_controller.dart` | `registration_attempted` (Phase 5 has no direct "success" event for C4; only `_attempted`/`_failed{code}` are named) |
| `organizer_logged_in` | same | not named in Phase 5 at all — C3 names `login_attempted`/`login_failed{code}` only |
| `organizer_logged_out` | same | not named in Phase 5 — no logout contract exists in C1–C45 |
| `create_vink_submitted` | `apps/mobile/lib/features/create_vink/create_vink_screen.dart` | `vink_open_attempted` (C15) — different name, adjacent meaning |
| `split_applied` / `split_failed` | same | not named in Phase 5 — C12/C13/C14 (split selection/editing) name no `Analytics:` line at all |
| `guest_join_page_viewed` / `guest_join_succeeded` / `guest_join_failed` / `guest_join_lookup_failed` | `apps/guest-web/features/join/*.tsx` | not named in Phase 5 — the Join Form (§8) contract carries no `Analytics:` line in C1–C45 |
| `guest_contribution_approved` / `guest_contribution_failed` | `apps/guest-web/features/join/SessionView.tsx` | `guest_contribution_confirmed` / `guest_contribution_declined` (C25) — different names, same meaning |

**This is a finding, not a fix.** Reconciling shipped analytics code to Phase 5's vocabulary is
a product/telemetry change — it would touch `apps/mobile` and `apps/guest-web` directly, and
PV12-prep's own funnel dashboard (`apps/operations-console`'s `/analytics` page,
`milestone-reports/PV12-prep-analytics.md`) queries some of the shipped names by string, so a
silent rename risks silently breaking that dashboard's thresholds. Per the Spec's own rule
(§9: "Spec/product changes are flagged to the owner, never made silently"), this table exists
to make the drift visible and enumerated; actually reconciling it is implementation work for a
later milestone (ENG3+), not this ENG2 slice.
