/**
 * ENG2 — typed screen/view-model contracts for every canonical consumer surface named in
 * `docs/design/phase-4-screen-contracts.md` ("Phase 4"). One export per numbered Phase 4
 * section (§1–§14, with §5 split into its three sub-screens §5a/§5b/§5c per that section's
 * own structure — §5d is explicitly "not canonical," so it has no contract here, see
 * `screens.ts`'s own §5 comment below).
 *
 * Grounding discipline (binding for this whole file): every field on every type below is
 * traceable to a specific Phase 4 "Exact visible information" / "Entry condition" / "Exit
 * condition" line. Nothing here invents a field, a screen, or a route Phase 4 does not
 * already name. Where a screen's data already has a real, shipped application-layer type
 * (`packages/application/src/{queries,guest}.ts`), this file reuses that type directly
 * (`export type X = <real type>`) rather than redeclaring a shadow copy that could drift —
 * see `docs/architecture/client-contracts-traceability.md` for which contracts are reused
 * vs. newly declared here.
 *
 * Status vocabulary matches Phase 5's own three-way distinction, restated per screen:
 * **Built** (the view-model is exactly what a real query already returns today), **Redesign**
 * (a real query exists but Phase 4 asks for a presentation change, not a data change), or
 * **New — designed, not built** (no query producing this shape exists yet; the interface
 * documents the target, per Phase 4 §15 rule 3: "designed, not built").
 */

import type {
  GuestVinkViewResult,
  NotOpenYetView,
  EnrichedPublicVinkSummary,
  ParticipantVinkView,
  RoleAnnotatedVink,
  VinkSnapshot,
  AllowedAction,
} from '../../application/src/index.ts';
import type { ParticipantId, PurchaseCategory, VinkId } from '../../domain/src/index.ts';

// ---------------------------------------------------------------------------
// §1 Welcome — no data view-model; a static, unauthenticated landing screen.
// ---------------------------------------------------------------------------

/** Phase 4 §1. Built. No server dependency — entry/exit are pure client auth-state checks. */
export interface WelcomeScreenContract {
  /** Phase 4 §1 "Entry condition": no valid stored session. */
  readonly entryCondition: 'AuthSignedOut';
}

// ---------------------------------------------------------------------------
// §2 Login
// ---------------------------------------------------------------------------

/** Phase 4 §2 "Exact visible information": username field, password field. Built. */
export interface LoginFormState {
  username: string;
  password: string;
}

/** The `POST /auth/login` request shape C3 submits (Phase 5 C3). Built. */
export type LoginRequest = LoginFormState;

/** Phase 4 §2 "Error behavior": a wrong-credentials failure is inline, specific, calm —
 * never a raw backend code. `code` is the raw application error code the UI maps to that
 * calm message; the mapping itself is a Phase 7 (copy) concern, not typed here. Built. */
export interface LoginFailure {
  readonly outcome: 'failure';
  readonly code: string;
}

export interface LoginSuccess {
  readonly outcome: 'success';
}

export type LoginResult = LoginSuccess | LoginFailure;

// ---------------------------------------------------------------------------
// §3 Register
// ---------------------------------------------------------------------------

/** Phase 4 §3 "Exact visible information": display name, username, password, **contact
 * info (new — phone or email, D19/D27 prerequisite)**. `contactDestination`/`contactMethod`
 * are typed as present (Phase 4 requires them visibly) but flagged per §3's own
 * "Implementation dependency" note: `register_screen.dart` collects no email/phone today
 * (Phase 1 audit), so these two fields are **New — designed, not built** even though the
 * rest of this form is Built. */
export interface RegisterFormState {
  displayName: string;
  username: string;
  password: string;
  /** New — designed, not built (D19/D27 prerequisite, Phase 4 §3). */
  contactMethod: 'phone' | 'email';
  /** New — designed, not built (D19/D27 prerequisite, Phase 4 §3). */
  contactDestination: string;
}

export type RegisterRequest = RegisterFormState;

export interface RegisterFailure {
  readonly outcome: 'failure';
  readonly code: string;
}

export interface RegisterSuccess {
  readonly outcome: 'success';
}

export type RegisterResult = RegisterSuccess | RegisterFailure;

// ---------------------------------------------------------------------------
// §4 Home
// ---------------------------------------------------------------------------

/** Phase 4 §4 "Exact visible information (per Vink card)": purpose/category icon,
 * organizer name (if not self), compact ink-fill preview, one-line status, next action if
 * any. Built on `RoleAnnotatedVink` (`packages/application/src/queries.ts`,
 * `listMyVinksWithRole`) for `vink`/`role`; **Redesign** for the presentation-only fields
 * below, which Phase 4 requires visibly but the domain doesn't (yet, or ever) model as a
 * server-computed field.
 *
 * `purposeLabel` is flagged, not invented: the domain `Vink` entity
 * (`packages/domain/src/entities.ts`) has **no freeform purpose/name field at all** — this
 * is the same known gap `milestone-reports/PV13.md` already flagged to the owner
 * ("no freeform Vink name/merchant field exists anywhere in the domain"). Phase 4 §4/§6/§8/
 * §10/§11 all visually require a "purpose" line; until a real field exists, this contract
 * types `purposeLabel` as derived from the one field that does exist today
 * (`vink.purchaseCategory`) and documents that derivation explicitly rather than pretending
 * a `purpose` string is real data. */
export interface HomeVinkCardViewModel {
  readonly vink: RoleAnnotatedVink['vink'];
  readonly role: RoleAnnotatedVink['role'];
  /** Derived, not stored — see this interface's own doc comment. Redesign, not New: the
   * underlying `purchaseCategory` is real data today; only the "purpose" framing is not. */
  readonly purposeLabel: PurchaseCategory;
  /** Phase 4 §0's compact-vessel screen-reader pattern: "$X of $Y ready", no waiting clause.
   * New — designed, not built (depends on `contributionProgress`, D24) at the Home-list
   * level; the per-Vink `VinkSnapshot.contributionProgress` this would read from is already
   * Built for the Lobby (§6), just not yet plumbed into the Home list query. */
  readonly compactProgressLabel: string | null;
  /** Phase 4 §4 element order: "Needs your attention" vs. "Waiting on others" bucketing.
   * New — designed, not built: no query computes this classification today (Home's own
   * UI-layer classification, per `RoleAnnotatedVink`'s own doc comment in queries.ts). */
  readonly attentionBucket: 'needs_attention' | 'waiting_on_others';
}

export interface HomeScreenViewModel {
  readonly cards: readonly HomeVinkCardViewModel[];
}

// ---------------------------------------------------------------------------
// §5 Create Vink (canonical target, D30) — §5a/§5b/§5c only. §5d ("current-capability note")
// is explicitly not canonical per Phase 4's own text and has no contract here; the five-step
// wizard's current field-level shapes already coincide with §5a/§5b's Built fields below.
// ---------------------------------------------------------------------------

/** Phase 4 §5a. Built (C6/C7 today, as fields on the current step 1/2 of the five-step
 * wizard; Redesign only in that the canonical target merges Purpose+Total into one screen). */
export interface CreateVinkPurposeAndTotalState {
  purpose: string;
  /** Phase 4 §5a: "only policy-supported categories" — never RESTAURANT/HOTEL/FUEL/
   * CAR_RENTAL (`packages/domain/src/policy.ts` `PurchaseCategory`, policy-rejected per
   * PV13's own finding). */
  category: Exclude<PurchaseCategory, 'RESTAURANT' | 'HOTEL' | 'FUEL' | 'CAR_RENTAL'>;
  subtotalMinor: number;
}

/** Phase 4 §5b per-participant row, including the D19 delivery choice. `role` and
 * `deliveryChoice` are typed together because Phase 4 §5b requires the choice visible
 * inline per row, never hidden in a second screen. `deliveryChoice` is New — designed, not
 * built beyond `'manual'`: "Send automatically" cannot be offered as selectable until D19/
 * D27's contact-capture and send-provider dependency exists (Phase 4 §5b's own
 * Implementation dependency note). */
export interface CreateVinkParticipantRow {
  readonly participantId: ParticipantId | null; // null until the person is actually added
  readonly displayName: string;
  readonly kind: 'member' | 'guest';
  readonly allocatedAmountMinor: number;
  readonly deliveryChoice: 'manual' | 'automatic';
}

/** Phase 4 §5b. Built for Equal/Custom (C12/C13/C14); Redesign for merging into one screen
 * with Purpose+Total's own screen (§5a) split out. No `'PERCENTAGE'` member — D22 keeps
 * percentage split hidden everywhere in this UI. */
export interface CreateVinkPeopleAndSplitState {
  readonly participants: readonly CreateVinkParticipantRow[];
  readonly splitMethod: 'EQUAL' | 'CUSTOM_AMOUNT';
  /** Phase 4 §5b "organizer's own share (editable, can be $0, custom, or equal)". */
  readonly organizerShareMinor: number;
}

/** Phase 4 §5c, the transient Open-Vink confirmation sheet. Redesign: today's standalone
 * Review screen shows the same fields as a full-page destination, not a dismissible sheet
 * (D30). No fee line (D21) — deliberately absent from this type, not merely unset. */
export interface OpenVinkConfirmationViewModel {
  readonly purpose: CreateVinkPurposeAndTotalState['purpose'];
  readonly totalMinor: number;
  readonly participants: readonly CreateVinkParticipantRow[];
}

// ---------------------------------------------------------------------------
// §6 Live Vink — Lobby (organizer/member)
// ---------------------------------------------------------------------------

/** Phase 4 §6. Built on `VinkSnapshot` (`packages/application/src/queries.ts`,
 * `getVinkSnapshot`) — every field §6 lists ("purpose, total, ink vessel, time remaining,
 * participant list, ... invite controls, card/settlement detail") already has a real
 * source on `VinkSnapshot` (`vink`, `contributionProgress`, `participants`, `card`,
 * `recovery`, `allowedActions`) **except purpose**, which is `HomeVinkCardViewModel`'s same
 * flagged gap — see that type's doc comment; not re-derived here to avoid two independently
 * drifting explanations of the same known gap. "Time remaining" is derived client-side from
 * `vink.submissionDeadline`, not a separate field (Phase 4 §6 names no distinct field for
 * it beyond the deadline itself). */
export type LobbyScreenViewModel = VinkSnapshot;

export type LobbyAllowedAction = AllowedAction;

// ---------------------------------------------------------------------------
// §7 Live Vink — Guest: Not Open Yet (D23)
// ---------------------------------------------------------------------------

/** Phase 4 §7. Built — `NotOpenYetView` already exists exactly as specified: "only what
 * D23's backend gate actually returns for a pre-open Vink," deliberately no
 * purpose/amount/organizer preview. */
export type GuestNotOpenYetViewModel = NotOpenYetView;

// ---------------------------------------------------------------------------
// §8 Live Vink — Guest: Join Form
// ---------------------------------------------------------------------------

/** Phase 4 §8. Built on `EnrichedPublicVinkSummary` (`packages/application/src/guest.ts`,
 * `getPublicVinkView`'s non-`not_open_yet` branch) — organizer/purpose (purpose gap as
 * above), exact guest share is NOT on this type today (it's computed post-join only; §8's
 * "exact guest share" line is flagged **New — designed, not built** for the pre-join case,
 * since `PublicVinkSummary` carries no per-guest allocation before a join exists to compute
 * one from), group `contributionProgress`, `submissionDeadline` (Phase 4 §8's "time
 * remaining, new — parity gap fixed"). */
export interface GuestJoinFormViewModel {
  readonly vink: EnrichedPublicVinkSummary;
  /** New — designed, not built: no pre-join per-guest share exists to show (see doc
   * comment above). */
  readonly prospectiveShareMinor: number | null;
}

// ---------------------------------------------------------------------------
// §9 Live Vink — Guest: Session View
// ---------------------------------------------------------------------------

/** Phase 4 §9. Built — `GuestVinkViewResult` (`packages/application/src/guest.ts`,
 * `getGuestVinkView`) already carries everything §9 requires for both the pre-contribution
 * and post-contribution/terminal branches: `vinkOutcome` (D25's vink-level category) and
 * `participant.contributionStatus` (D24/D25's viewer-own category) together decide which of
 * the two mutually-exclusive dominant objects (vessel vs. outcome statement) a client
 * renders — that branching itself is a Phase 6/7 copy-system concern
 * (`apps/guest-web/lib/guest-copy.ts`'s `guestTerminalSentence`), not re-typed here. */
export type GuestSessionViewModel = GuestVinkViewResult;

/** Same shape, for a signed-in member who is not the organizer (Phase 3 §1 Slice I2B) —
 * Phase 4 §6's own text notes the Lobby is organizer-only; a member's equivalent read is
 * `ParticipantVinkView`, not `VinkSnapshot`. Not explicitly its own Phase 4 section (Phase 4
 * doesn't number a separate member screen), but included here because Phase 5 §2's locked
 * rules ("no role-based shortcut," Phase 0 §3) require member and guest contribution UI to
 * share the same contract shape wherever the backend already does — this is that shared
 * shape for the signed-in-member case specifically. */
export type ParticipantSessionViewModel = ParticipantVinkView;

// ---------------------------------------------------------------------------
// §10 Activity (list)
// ---------------------------------------------------------------------------

/** Phase 4 §10 "Exact visible information (per entry)": Vink purpose, outcome label
 * (completed/expired/cancelled/returned — "aligned to the same vocabulary discipline as
 * guest-web's D25 set"), date, amount. New — designed, not built: no query producing a
 * cross-Vink, per-entry outcome-labeled list exists yet (§10's own Implementation dependency
 * note: "same participant-inclusive query as Home," itself unbuilt at the Home-list level
 * per `HomeVinkCardViewModel`). `outcomeLabel` reuses `GuestVinkOutcome`'s already-real
 * four-terminal-value subset (`completed | expired | cancelled | returned`) rather than
 * inventing a parallel vocabulary — Phase 4 §10 explicitly asks for exactly that alignment. */
export interface ActivityListEntryViewModel {
  readonly vinkId: VinkId;
  /** Same flagged gap as `HomeVinkCardViewModel.purposeLabel`. */
  readonly purposeLabel: PurchaseCategory;
  readonly outcomeLabel: 'completed' | 'expired' | 'cancelled' | 'returned';
  readonly date: string;
  readonly amountMinor: number;
}

export interface ActivityListViewModel {
  readonly entries: readonly ActivityListEntryViewModel[];
}

// ---------------------------------------------------------------------------
// §11 Activity — Vink details (D29/D31)
// ---------------------------------------------------------------------------

/** Phase 4 §11. New — designed, not built. "purpose, total, every participant's
 * contribution outcome ..., timestamps of key transitions, merchant settlement detail if
 * applicable" — full detail is correct here (organizer/member's own history, not the guest
 * privacy-scoped view, per §11's own text), unlike `ActivityListEntryViewModel`'s summary
 * row. No fee line (D21) — deliberately absent, not merely unset. Never labeled or shaped as
 * a receipt (D31). */
export interface ActivityVinkDetailsParticipantOutcome {
  readonly participantId: ParticipantId;
  readonly displayName: string;
  readonly contributionOutcomeLabel: string;
  readonly amountMinor: number;
}

export interface ActivityVinkDetailsTimelineEntry {
  readonly label: string;
  readonly at: string;
}

export interface ActivityVinkDetailsViewModel {
  readonly vinkId: VinkId;
  readonly purposeLabel: PurchaseCategory;
  readonly totalMinor: number;
  readonly participants: readonly ActivityVinkDetailsParticipantOutcome[];
  readonly timeline: readonly ActivityVinkDetailsTimelineEntry[];
  readonly merchantSettlementDetail: string | null;
}

// ---------------------------------------------------------------------------
// §12 Profile
// ---------------------------------------------------------------------------

/** Phase 4 §12 "Exact visible information": display name, username, **contact info (new)**,
 * **support contact (new, D28)**. Explicitly excludes payment methods,
 * security-beyond-password, legal content (Phase 3 §5) — this type has no fields for any of
 * those, by design, not omission. `contactMethod`/`contactDestination`/`supportChannel` are
 * New — designed, not built (D19/D27, D28); `displayName`/`username` are Built (today's
 * identity display). */
export interface ProfileViewModel {
  readonly displayName: string;
  readonly username: string;
  /** New — designed, not built (D19/D27). */
  readonly contactMethod: 'phone' | 'email' | null;
  /** New — designed, not built (D19/D27). */
  readonly contactDestination: string | null;
  /** New — designed, not built (D28). No response-time commitment is ever attached here
   * (explicitly not invented, Phase 5 C37). */
  readonly supportChannel: string | null;
}

// ---------------------------------------------------------------------------
// §13 Guest token-redeem page
// ---------------------------------------------------------------------------

/** Phase 4 §13. Built (mechanically, as an existing `/g/:token` redeem flow) — a pure
 * redirect target, not a destination; carries no independent view-model fields beyond the
 * transient loading/error states §13 names. */
export type GuestTokenRedeemState =
  | { readonly phase: 'redirecting' }
  | { readonly phase: 'failed'; readonly reason: 'invalid_or_expired_token' };

// ---------------------------------------------------------------------------
// §14 Cross-cutting: In-place re-auth prompt (D26)
// ---------------------------------------------------------------------------

/** Phase 4 §14. New — designed, not built: "the whole screen is new — requires the global
 * 401 listener ... and state-preservation in the Create flow/Lobby specifically." Not a
 * route; an overlay presentable over any authenticated organizer/member screen. */
export interface ReauthOverlayViewModel {
  readonly presented: boolean;
  readonly usernameField: string;
  readonly passwordField: string;
}

/** The full canonical screen-contract registry (§1–§14, §5 expanded to its three
 * sub-screens) — used by `traceability.ts` and by `screens.test.ts` to assert this file
 * covers every Phase 4 screen and invents none beyond it. Values are `true` markers, not the
 * types themselves (TypeScript has no reflective type registry) — this is the
 * compile-time-checkable enumeration `traceability.ts` cross-references against Phase 5's
 * §5 screen-by-screen matrix and against `docs/design/phase-4-screen-contracts.md`'s own
 * section numbers. */
export const SCREEN_CONTRACT_IDS = [
  'welcome',
  'login',
  'register',
  'home',
  'create_purpose_and_total',
  'create_people_and_split',
  'open_vink_confirmation',
  'lobby',
  'guest_not_open_yet',
  'guest_join_form',
  'guest_session',
  'participant_session',
  'activity_list',
  'activity_vink_details',
  'profile',
  'guest_token_redeem',
  'reauth_overlay',
] as const;

export type ScreenContractId = (typeof SCREEN_CONTRACT_IDS)[number];
