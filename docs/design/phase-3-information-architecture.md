# Phase 3 — Information Architecture

_UI/UX Engineering Plan, Phase 3 output: exactly where information belongs, per section, plus
a final navigation and screen inventory. Any unjustified screen is removed; any unjustified
new screen is flagged, not silently added. Source of truth: `docs/design/phase-0-product-behavior.md`,
`docs/design/phase-1-screen-audit.md`, `docs/design/phase-2-journey-architecture.md`,
`docs/spec/decision-log.md` (D1–D27)._

**Status:** DRAFT. **Documentation only — no application code was modified.** Two facts were
verified directly against source during this phase (cited inline) because Phase 2's own text
turned out to understate one gap: Home's data source and the guest-web countdown.

---

## Method

Each section below states: what belongs there (grounded in real data/behavior or an explicit
decision), what's justified-but-not-built (with the dependency), and what's explicitly
deferred (with the reason — not silently added, not silently dropped). Two facts corrected
mid-phase and already fixed in `phase-2-journey-architecture.md`:

- **Home lists organizer-owned Vinks only.** `GET /api/v1/vinks` → `listMyVinks` →
  `listVinksByOrganizer` (`packages/application/src/queries.ts:137-139`). There is no query
  returning Vinks a user merely participates in. A member has **no in-app discovery path at
  all** today, not even passive.
- **Guest-web never renders `submissionDeadline`**, even though `GuestVinkView` carries it
  (`apps/guest-web/lib/types.ts:13`) — confirmed by grep, zero references in
  `JoinForm.tsx`/`SessionView.tsx`. Mobile's Lobby does show a live "time remaining" label
  while `OPEN` (`vink_lobby_screen.dart:270,340,346`). This is a real parity gap, not
  previously listed in Phase 1's audit.

---

## 1. Home

**Data-model decision (new, this phase):** Home's query must expand from
`listVinksByOrganizer` to a union of organizer-owned **and** participant Vinks (a new
`listVinksForParticipant`-shaped read, additive only — a user's own participations, no
privacy boundary crossed, no ledger/financial semantics touched). Without this, nothing else
in this section works for anyone but organizers.

| Belongs on Home | Status | Notes |
|---|---|---|
| "Start a Vink" | Built | Unchanged. |
| Vinks requiring **my** attention | **Redesign** | Today: one flat "Active Vinks" list, organizer-owned only, with `RESTRICTED` **filtered out entirely** (`home_providers.dart:13` — a confirmed dead end, Phase 1 §D.3). Target: a distinct group — unpaid own-share, `RESTRICTED` (organizer), anything needing this user's action as organizer *or* participant. |
| Vinks waiting on others | **Redesign** | Second distinct group — `OPEN`/`PROCESSING_GRACE`/`CARD_PROVISIONING`/etc. where this user's own part is done and they're just watching. Progress shown via `contributionProgress` (D20/D24), never `fundedAmountMinor` (Phase 1 §C.8). |
| Route to Activity | Built | Unchanged (existing tab). |
| Recently completed/closed | **Keep, deprioritized** | Today's Home mixes a "recent-activity preview" into the same screen (Phase 1 inventory) — that content belongs in Activity, not duplicated on Home; Home should link to Activity, not re-render its feed. |

**Justification for the new participant-Vinks query:** every member/guest journey in Phase 2
(§4) depends on it — without it, D19/D27's automatic delivery is the *only* way back into a
Vink a member didn't organize, which fails the moment a text/email is lost or dismissed.

---

## 2. Create

**Canonical target flow (D30, corrects this section's original draft):** two input screens
plus a transient confirmation, not a five-step wizard:

1. **Purpose and total** — entered together, one screen.
2. **People and split** — adding/editing participants and choosing Equal/Custom (D22)
   together, one screen.
3. **Open Vink confirmation** — a bottom sheet, dialog, or equivalent transient safeguard,
   showing the full allocation summary (what a standalone "Review" screen used to show) —
   **not a destination screen of its own.**
4. **Live Vink** — the flow's actual endpoint (§3).

The current five-step wizard (`create_vink_screen.dart`: Purpose → Total → Add people →
Split → Review) remains accurate **current-capability** documentation — it is what's built
today — but is no longer the canonical target this document designs toward.

| Belongs in Create | Status | Notes |
|---|---|---|
| Purpose, total (screen 1) | **Redesign (merge)** | Today two separate wizard steps; canonical target combines them into one screen. |
| People, split (screen 2) | **Redesign (merge)** | Today three separate wizard steps (Add people, Split, and the naming/delivery split from Phase 2 §H); canonical target combines people-management and split into one screen. A failed username lookup must inline-offer "add as guest instead" (Phase 2 §1), not dead-end. |
| Guest contact method | **New, justified by D19/D23/D27** | Per-guest choice at add-time: automatic (default, needs phone/email — not collected today) or "share manually instead" (explicit opt-out, D19). This is the field the original brief's Phase 3 outline names but nothing in the current build backs yet — flagged as a data-model dependency (contact capture), not built. |
| Split — Equal / Custom only | Built, and this is the decided scope | D22 — Percentage stays hidden. Not a gap. |
| Open Vink confirmation (transient) | **Redesign (D30)** | Replaces the standalone Review screen — same summary content (purpose, total, every share, delivery method), shown as a dismissible sheet/dialog, not a page in the step sequence. Single "Open Vink" action inside it (no duplicate CTA, confirmed fixed post-PV13). |
| Fee line anywhere in this flow | **Explicitly excluded** | D21 — no fee model exists; nothing here may display, calculate, or hard-code one. |

---

## 3. Live Vink (Lobby / guest Session)

This is one information architecture serving two surfaces (organizer/member Lobby,
`vink_lobby_screen.dart`; guest `SessionView.tsx`) — deliberately kept in parity, since
Phase 1 confirmed both already share identical state-label copy byte-for-byte and Phase 2's
journeys treat them as the same underlying moment for different viewers.

| Belongs on Live Vink | Status | Notes |
|---|---|---|
| Purpose, total | Built | Unchanged, both surfaces. |
| Human progress | **Redesign** | Driven by `contributionProgress` (D20/D24) on both surfaces — replaces `fundedAmountMinor` everywhere it's read today (Phase 1 §C.8: mobile Lobby, mobile Home card, guest `ProgressBar`). This is the Ink Progress System's actual data source. |
| Participants | **Redesign (organizer/member surface only)** | Organizer's own share folds into the same list row, no separate duplicate card (Phase 2 §H/Phase 1 §F.1). Guest surface shows **only aggregate counts**, never other participants' individual status (Phase 0 §2 privacy boundary, reaffirmed by D24). |
| Time remaining | **Parity gap** | Built on mobile (`_timeRemainingLabel`, OPEN only); **missing entirely on guest-web** — confirmed by grep this phase. Must be added to `SessionView.tsx`, same OPEN-only gating. |
| Organizer's current action | Built | "Pay my share" via the shared endpoint (Phase 0 §3) — unchanged. |
| Invite controls | **Redesign** | Shown only while the Vink is `OPEN` and not everyone has confirmed — automatic delivery (D19) is the default expectation once built; "Share manually instead" is an explicit secondary control (Phase 2 §6), not the only button (Phase 1 §C.7). Controls retire once `FUNDED` — there's nothing left to invite anyone to. |
| Guest's own `contributionStatus` | **New, D24/D25** | Guest surface only — drives whether the contribute action is offered at all (never re-offered once `confirmed`, D25) and which terminal message shows (§10 of Phase 2). |
| Card details | Built, organizer/member only | Guest never sees the card (Phase 1 §D.4) — flagged there as a scope question, not resolved by this phase; carried forward, not silently decided either way here. |
| Pre-open ("not open yet") state | **New, D23** | Guest surface only — replaces any DRAFT-stage rendering; no contribution action, purpose/organizer/amount may or may not be shown depending on what D23's backend gate actually returns (see Phase 2 §D.3 — response shape not yet designed in detail, a Phase 4 screen-contract item). |

---

## 4. Activity

| Belongs in Activity | Status | Notes |
|---|---|---|
| Completed / expired / cancelled entries | Built | `activity_copy.dart` already covers these Vink-level outcomes in calm language. |
| Returned payments | **Partially built** | Refund events exist in the underlying activity stream conceptually (Phase 0 §11), but Activity's current copy doesn't distinguish "returned" as its own labeled outcome the way D25 now requires for guests — worth the same vocabulary alignment on the organizer side for consistency, not just guest-web. |
| Historical detail — **"Vink details"** (D31, never "receipt") | **New, decided (D29/D31)** | Today's Activity list is flat and non-interactive (confirmed this phase: no `onTap`/navigation on any entry, `activity_screen.dart`). D29: each entry becomes tappable, opening a **Vink details** view built entirely from data already recorded (settlement, ledger, participant records, state history) — payment and outcome detail, never labeled or implied as merchant-issued documentation (D31). No new financial concept, presentation-only. Not yet built. |
| Scope | **Same expansion as Home** | Activity today is organizer-scoped only (same `listVinksByOrganizer`-adjacent limitation as Home) — a member should be able to see their own contribution history too, once the participant-Vinks read (§1) exists. |

---

## 5. Profile

| Belongs in Profile | Status | Notes |
|---|---|---|
| Identity (name, username) | Built | Unchanged. |
| Contact info (phone/email) | **New, justified** | Directly required by D19/D27 — automatic delivery cannot exist without capturing it somewhere, and Profile is the natural place for a user to set/edit it (registration doesn't collect it today — `register_screen.dart`, Phase 1 audit). This subsumes what the original brief called "notifications" — the only notification-relevant setting this build actually needs is *where* to send automatic invitations, plus the existing per-Vink "share manually instead" override (D19) which stays in Create/Lobby, not Profile. |
| Sign out | Built | Unchanged. |
| Change password | **New, justified, minimal** | Basic account-safety hygiene, independent of any provider/financial integration — no evidence this exists today; flagged as reasonable minimal new scope, not built. |
| Payment methods | **Explicitly deferred** | Nothing in the domain today models an organizer's own funding-source-for-refunds/recovery as something a user manages in-app (Phase 0 §11 — recovery charges happen off-session against whatever the provider already has on file; there's no "manage cards" concept anywhere in `packages/domain`). Building this UI now would be designing for the still-open M0 gate's eventual provider, which the project's own hard rules say not to guess at (`docs/architecture/06-milestone-0-gate.md`, D15's reasoning). Deferred, not added. |
| Security (beyond password) | **Explicitly deferred** | No 2FA/device-management concept exists anywhere in the build; same reasoning as payment methods — don't design for a provider-dependent or unscoped future requirement. |
| Support | **New, decided (D28)** | A minimal "Contact support" affordance (email/link to whoever staffs the PV12 pilot) — low-risk, low-effort, real value for real users. Mobile only; guest-web has no account/Profile surface, so guest-side support contact is a residual, unscoped question (not decided by D28). |
| Legal (terms/privacy) | **Explicitly deferred (D28)** | Legal content needs actual counsel review, not a UX decision — stays deferred until legal is engaged (ties to G2, still open). Not designing placeholder legal copy. |

---

## 6. Guest web

| Belongs on the guest page | Status | Notes |
|---|---|---|
| Organizer, purpose, exact guest amount | Built | Unchanged, accurate today (Phase 0 §5). |
| Fee disclosure | **Explicitly excluded from real content** | D21 — an optional, currently-empty API-driven slot may exist in the component, but no number or copy is shown while no fee model exists. |
| Expiry / time remaining | **Not built — real gap, confirmed this phase** | `submissionDeadline` is in the type, never rendered. Needs the same "Closes in X" treatment mobile already has, gated to states where a countdown is meaningful (`OPEN`), replaced by the D25 terminal-state copy once the Vink leaves `OPEN`. |
| Payment action | Built | "Approve $X" — unchanged, correctly gated already (Phase 1 §C.5). |
| Financial outcome | **Redesign — highest-priority item across all three phases so far** | The full D25 vocabulary (completed / expired / cancelled / return pending / returned / recovery-required) replaces today's single flat "no longer accepting contributions" message (Phase 1 §C.11). Requires the `contributionStatus` API addition (D24) — this is a backend dependency, not a copy-only fix. |
| Pre-open state | **New, D23** | "This Vink isn't open yet," no action, auto-transitions on open. |
| Card / merchant confirmation | **Deferred, same as §3** | Guest never sees the card today; not resolved by this phase. |

---

## 7. Cross-cutting (not tied to one section)

- **In-place re-auth prompt (D26):** an app-shell-level overlay, not a screen belonging to
  any one section — must be invocable from any authenticated organizer/member screen,
  requires the Create wizard and Lobby specifically to preserve in-progress local state
  across the interruption (Phase 2 §I.6).
- **Simulation banner:** stays exactly where it is today (shown wherever simulated
  money/card state is visible, Phase 0 §12) — no IA change; explicitly not something to
  quietly remove or relocate, since it's the one piece of honest disclosure the current
  product already gets right.
- **State-name-hiding rule:** applies to every section above uniformly — restated here only
  to note it's not a per-section concern, it's a global constraint Phase 4's screen contracts
  must honor everywhere, especially the new D23 pre-open state and D25 terminal states, which
  are new enough that it would be easy to accidentally leak a raw name while designing them.

---

## 8. Final navigation map

```
Organizer/member app (apps/mobile)
├── Unauthenticated: Welcome → Login | Register
└── Authenticated (bottom-tab shell, unchanged — 3 tabs remain justified)
    ├── Home (tab) — organizer-owned + participant Vinks (new query), needs-attention /
    │                waiting groupings, "Start a Vink"
    │     └── Create Vink (canonical: Purpose+Total → People+Split → Open Vink confirmation
    │          [transient sheet/dialog] → Live Vink; five-step wizard is current capability
    │          only, D30)
    ├── Live Vink (pushed from Home or a resumed link, not a tab — unchanged)
    ├── Activity (tab) — organizer-owned + participant history (same query expansion)
    │     └── Vink details (per-entry, D29/D31 — never "receipt")
    └── Profile (tab) — identity, contact info (new), change password (new), sign out
    [cross-cutting] in-place re-auth prompt, invocable from anywhere (D26)

Guest web (apps/guest-web) — no auth, no nav shell, single-purpose per link
└── /join/:publicCode
    ├── not-open-yet (new, D23)
    ├── join form
    ├── session view (live progress, own status, pre-open/terminal states)
    └── /g/:token → redeems into the above
```

No new top-level navigation surface is added (no notifications tab/inbox — D27 uses external
delivery, not an in-app inbox, per the owner's own resolution of that gap).

---

## 9. Final screen inventory

| Screen | Verdict | Reason |
|---|---|---|
| Welcome, Login, Register | Keep | Match the actual auth model (Phase 0 §1); no change. |
| Home | Keep, redesign | Query expansion + regrouping (§1). |
| Create Vink | Keep, redesign | Canonical target is two input screens + a transient Open Vink confirmation, not a five-step wizard (D30, §2). Current five-step wizard remains accurate current-capability documentation. |
| Live Vink / Lobby | Keep, redesign | Progress source, participant list consolidation, invite-control gating (§3). |
| Activity | Keep, redesign | Query expansion; Vink details view decided and in scope (D29/D31). |
| Profile | Keep, redesign | Add contact info + change password; explicitly do not add payment methods/security/support/legal without further decisions. |
| Guest: not-open-yet | **New** | D23. |
| Guest: join form | Keep | Accurate today. |
| Guest: session view | Keep, redesign | Countdown addition, full D25 terminal-state set. |
| Guest: token-redeem page | Keep | Unchanged. |
| Activity: Vink details (per-entry) | **New** | D29/D31 — "Vink details," never "receipt." |
| **Removed** | — | **None.** Every screen in both apps maps to a real, still-needed journey step (confirmed in Phase 2 §H and reconfirmed here) — there is no unjustified screen to cut. |
| **Deferred (not built, not designed further this phase)** | — | Payment methods, security (2FA/devices), legal content — see §5. Card visibility for guests — see §3/§6. Support is now in scope (D28), not deferred. |

---

## 10. Dependencies Phase 4 must not contradict

1. Home and Activity's data source is a **participant-inclusive** query, not
   organizer-only — Phase 4 screen contracts must design for both an organizer's own Vinks
   and Vinks they merely participate in appearing in the same lists, distinguished by role
   where relevant (e.g., only an organizer sees "needs attention" for `RESTRICTED`).
2. Guest-web's countdown and full terminal-state vocabulary are **both** backend-dependent
   (the countdown is a pure rendering gap and can be built now; the terminal states need
   `contributionStatus` per D24) — Phase 4 must not design guest-web's terminal screens as if
   the data already exists.
3. Profile's payment methods and security-beyond-password sections are **not** in scope for
   this phase's screen contracts — Phase 4 should not invent content for them. Legal content
   stays deferred (D28) — Phase 4 must not draft placeholder terms/privacy copy.
4. No fee UI, no percentage-split UI, no card UI for guests, no in-app notification
   inbox — all remain excluded per D21/D22 and this phase's own findings.
5. Activity's per-entry **Vink details** view (D29/D31 — never "receipt"/"View receipt") and
   Profile's support contact (D28) are now **decided and in scope** for Phase 4's screen
   contracts — both should be specified, not skipped, even though neither is built yet.
6. Create's canonical target is the D30 two-screen-plus-transient-confirmation flow — Phase 4
   contracts should specify that as the target, while still accurately documenting the
   current five-step wizard as current capability, not silently dropping either.

---

## 11. Acceptance criteria for moving to Phase 4

- [x] Owner resolved both previously flagged items: Activity gains a per-entry **Vink
      details** view (D29/D31 — never "receipt"); Profile gains a minimal support-contact
      affordance, legal content stays deferred (D28).
- [x] Owner corrected Create's canonical flow to two input screens plus a transient Open Vink
      confirmation, not a five-step wizard (D30); the current five-step wizard remains
      documented as current capability only.
- [ ] Owner confirms the deferred Profile sections (payment methods, security beyond
      password) stay deferred — no objection expected, listed for completeness since the
      original plan's outline named them.
- [ ] The participant-inclusive Home/Activity query is accepted as a required backend
      addition before those two screens' Phase 4 contracts can be written accurately.
- [x] No item in this document contradicts D1–D29 or the Phase 0/1/2 findings.

Next: Phase 4 (Screen Contracts) — the exact route/state/copy/behavior specification for
every screen listed in §9, including the two new guest states (D23 pre-open, D25 terminal
set) and the redesigned Home/Activity/Profile/Lobby content from §1–§5.
