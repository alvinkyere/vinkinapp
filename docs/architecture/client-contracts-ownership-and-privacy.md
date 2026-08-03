# Client Contracts — Event Payload Ownership and Privacy Rules

_ENG2 (Contract Engineering), remaining scope. Governs
`packages/client-contracts/src/{screens,events}.ts` — the typed screen/view-model and
interaction-event contracts grounded in `docs/design/phase-4-screen-contracts.md` /
`docs/design/phase-5-button-interaction-contracts.md`. Companion to
`docs/architecture/client-contracts-traceability.md` (what exists) and
`docs/architecture/client-contracts-versioning-policy.md` (how it may change)._

---

## 1. Envelope field ownership

Every event travels inside `VinkinAnalyticsEventEnvelope` / `VinkinAnalyticsBatchRequest`
(`packages/client-contracts/src/events.ts`), which mirrors the real, already-shipped wire
schema (`apps/api/src/modules/analytics/routes.ts`, `batchSchema`/`eventSchema`). Field
ownership:

| Field | Set by | Rule |
|---|---|---|
| `clientId` | The client runtime, once per install/session — `apps/guest-web/lib/analytics.ts` persists a `crypto.randomUUID()` in `localStorage`; `apps/mobile`'s `HttpAnalytics` generates one per process. | Never a user identifier (username, userId, guestIdentityId) — it identifies a *device/browser instance*, not a person. Never sent to, or derivable by, anyone but the ingestion endpoint itself. |
| `app` | Fixed per client — `'organizer_mobile'` for `apps/mobile`, `'guest_web'` for `apps/guest-web`. | A client never emits under the other app's value. There is no third value (e.g. for `apps/operations-console`) — the real Zod `z.enum([...])` this mirrors has exactly two, and this document does not invent a third. |
| `vinkId` | Whichever surface is scoped to a specific Vink at the moment of the event. Absent for auth/profile/global events (C1–C4, C35–C37, C44–C45) that have no Vink context. | An organizer/member event's `vinkId` is that user's own Vink (they can only ever be scoped to Vinks they organize or participate in). A guest event's `vinkId` is the one Vink their token is bound to (D14's single-slot token binding) — structurally, a guest client cannot even construct an event for a different `vinkId`. |
| `properties` | Per-event payload, typed exactly per `docs/architecture/client-contracts-traceability.md` §2 — never a catch-all for arbitrary additional data (see §3 below). | |
| `occurredAt` | The client's own clock, at the moment the interaction happened — not when the batch is flushed or received. | Mirrors the Spec §28 discipline ("decide by provider `occurred_at`, never arrival time") applied to client events: a funnel analysis must order by `occurredAt`, never by ingestion order, for the same reason webhook processing does. |

---

## 2. Who may emit which event (surface ownership)

Every event in `docs/architecture/client-contracts-traceability.md` §2 belongs to exactly one
Phase 4 screen family, and that screen family belongs to exactly one client app — this
document does not introduce a new cross-app event, it restates the boundary Phase 4/5 already
draw:

- **`organizer_mobile`-only**: every Group A/B/C/F/H event tied to a screen only an
  authenticated organizer/member ever reaches — Welcome/Login/Register (C1–C4), Create
  (C5, C8–C10, C15), invitation delivery/fallback (C16–C22, fired from the organizer's own
  Lobby/Create screens), Cancel Vink (C27), Preparing/Pay-now/Completion (C30–C32),
  Activity/Profile (C33–C37), and the reauth/offline cross-cutting events (C44–C45, which can
  also legitimately fire from `guest_web` — see below).
- **`guest_web`-only**: `guest_contribution_attempted` / `_confirmed` / `_declined` (C25) —
  structurally impossible from `organizer_mobile`, since only a guest session ever reaches the
  Guest Session View contract these events are attached to.
- **Either app**: `contribution_attempted` / `_confirmed` / `_declined` (C23/C24, "no
  role-based shortcut," Phase 0 §3 — an organizer's own contribution goes through the exact
  same command as any member's, so the event is legitimately emitted by `organizer_mobile` for
  both cases) and `offline_detected` / `reconnected` / `generic_error_shown` (C45, a genuinely
  global pattern, Phase 5's own framing: "not one screen").

A contract test enforcing this app/event pairing at the wire level does not exist yet — the
real Zod schema deliberately does not couple `eventName` to `app` (`eventName` is just
`z.string()`), so nothing today would reject a structurally-wrong pairing (e.g. `guest_web`
emitting `password_changed`, a Profile-only event no guest session can reach). This is
flagged, not fixed, here: enforcing it would mean either a discriminated schema per `app` value
(a real, if minor, wire-schema change subject to
`docs/architecture/api-versioning-policy.md`) or a client-side-only lint, and deciding between
those is implementation work for whichever milestone actually wires a client to these types.

---

## 3. Privacy rules

These rules are not new privacy inventions — they are the existing, already-enforced privacy
boundary (`packages/application/src/guest.ts`'s own doc comments: a guest "never sees other
participants' individual status," Phase 4 §0's aggregate-only guest vessel) restated as a
constraint on what an analytics payload is allowed to contain, since a payload is a second,
easy-to-overlook place the same boundary could leak through.

1. **No event payload carries another participant's identity.** `participantId` appears in
   four payloads (`invitation_delivered`, `invitation_delivery_failed`,
   `invitation_fallback_opened`, `invitation_resend_attempted`) — all four are organizer-side
   events (C16–C19, fired from the organizer's own Lobby/Create screen managing their own
   Vink's invitations), never guest-side, and `participantId` is an opaque UUID
   (`packages/domain/src/ids.ts`), never a `displayName` or contact destination. A guest client
   has no code path that could even construct one of these four events, since the Guest Session
   contract (§9) never receives another participant's `participantId` in the first place
   (`GuestVinkView.participant` is the guest's own row only).
2. **No event payload carries a contact destination (phone/email) or free-text display name.**
   `contact_info_updated` (C35) intentionally carries no payload at all beyond the envelope —
   the fact that contact info changed is the signal; the new value is never sent to analytics.
3. **No event payload carries a money amount.** Every amount-bearing screen (Lobby, Create,
   Activity details) has amount data on its *view-model* (`screens.ts`), but none of the C1–C45
   `Analytics:` lines list an amount field, and this file does not add one — funnel analysis
   answers "did a contribution happen," not "how much," by design (matches the existing
   `analytics_events` table's own scope, `milestone-reports/PV12-prep-analytics.md`: funnel
   presence/absence, not financial reporting).
4. **`code` fields (`login_failed`, `registration_failed`, `vink_open_failed`) carry an
   application error code, never a rendered message.** Error codes
   (`packages/application/src/errors.ts`'s `ApplicationError.code`) are a fixed, small,
   non-user-authored vocabulary; a rendered message could echo user input (e.g. a validation
   message quoting what the user typed) back into analytics storage, which these three payloads
   deliberately avoid by typing `code: string` (the code) and never `message: string`.
5. **`generic_error_shown{context}` (C45) is a fixed UI-location label, never free text.**
   `context` identifies *where* a generic error banner appeared (e.g. `'lobby_load'`), not
   *what* the error said — the same reasoning as rule 4, generalized to the one catch-all event
   in this vocabulary. A future implementer wiring C45 must pass a fixed string constant per
   call site, never an interpolated error message or user input.
6. **Guest-web must never batch a guest event and an organizer event through the same
   `clientId`.** This falls directly out of §1's table (one `app` value per client, one
   `clientId` per client instance) and is stated here explicitly because it is the property
   that keeps a guest's funnel activity from ever being joinable to an organizer's account by
   analytics `clientId` alone — the two id spaces never intersect by construction, not by a
   filter someone could forget to apply.

---

## 4. System-driven (non-tap) events — a data-quality caveat, flagged not resolved

`invitation_dispatch_attempted`/`invitation_delivered`/`invitation_delivery_failed` (C16),
`card_provisioning_started` (C30), and `vink_completed` (C32) are system-driven, not
user-tap-driven — Phase 5 marks each "no user tap," fired when a client *observes* a state
transition (over the realtime channel, per Phase 4 §6's "every state transition ... pushes
live"). Because both the organizer's `organizer_mobile` client and any joined guest's
`guest_web` client can observe the same transition independently, **a naive count of
`vink_completed` events is a count of client-observations, not a count of completed Vinks** —
an organizer and every joined guest watching the same Lobby/Session at settlement time could
each fire their own copy. This is not a bug to fix in this contract (each client's own event is
individually true), but a caveat this document states explicitly for whoever eventually builds
the dashboard query: dedupe by `(eventName, vinkId, occurredAt bucket)` when counting *Vinks*,
not `(eventName)` alone, when counting *observations* is not the intent.
