/**
 * ENG2 — machine-checkable traceability map from every type/event this package declares
 * back to its exact Phase 4 or Phase 5 source. `screens.test.ts`/`events.test.ts` assert
 * these maps are complete (every `ScreenContractId`/`VinkinAnalyticsEventName` has an
 * entry) and closed (no entry names a screen/event this package doesn't also declare) —
 * that pairing is what makes "do not invent screens, actions, analytics events, or
 * payloads" a checked property, not just a written promise.
 *
 * The human-readable rendering of these same two maps lives in
 * `docs/architecture/client-contracts-traceability.md` — kept in sync by
 * `traceability.test.ts`, which fails if the doc's row count for either table drifts from
 * these maps' own size.
 */

import { SCREEN_CONTRACT_IDS, type ScreenContractId } from './screens.ts';
import { VINKIN_ANALYTICS_EVENT_NAMES, type VinkinAnalyticsEventName } from './events.ts';

/** Screen contract id → Phase 4 section. */
export const SCREEN_CONTRACT_SOURCE: Readonly<Record<ScreenContractId, string>> = {
  welcome: 'Phase 4 §1 Welcome',
  login: 'Phase 4 §2 Login',
  register: 'Phase 4 §3 Register',
  home: 'Phase 4 §4 Home',
  create_purpose_and_total: 'Phase 4 §5a Create Vink — Purpose and total',
  create_people_and_split: 'Phase 4 §5b Create Vink — People and split',
  open_vink_confirmation: 'Phase 4 §5c Create Vink — Open Vink confirmation',
  lobby: 'Phase 4 §6 Live Vink — Lobby (organizer branch)',
  guest_not_open_yet: 'Phase 4 §7 Live Vink — Guest: Not Open Yet (D23)',
  guest_join_form: 'Phase 4 §8 Live Vink — Guest: Join Form',
  guest_session: 'Phase 4 §9 Live Vink — Guest: Session View',
  participant_session: 'Phase 4 §6 Live Vink — Lobby (member branch, Phase 3 §1 Slice I2B)',
  activity_list: 'Phase 4 §10 Activity (list)',
  activity_vink_details: 'Phase 4 §11 Activity — Vink details (D29/D31)',
  profile: 'Phase 4 §12 Profile',
  guest_token_redeem: 'Phase 4 §13 Guest token-redeem page',
  reauth_overlay: 'Phase 4 §14 Cross-cutting: In-place re-auth prompt (D26)',
};

/** Analytics event name → the Phase 5 interaction contract id(s) whose `Analytics:` line
 * names it. An array because a small number of events are shared verbatim across two
 * contracts (Phase 5 says so explicitly in each case — see `events.ts`'s own per-event
 * comments for the citation). */
export const EVENT_CONTRACT_SOURCE: Readonly<Record<VinkinAnalyticsEventName, readonly string[]>> =
  {
    welcome_login_tapped: ['C1'],
    welcome_register_tapped: ['C2'],
    login_attempted: ['C3'],
    login_failed: ['C3'],
    registration_attempted: ['C4'],
    registration_failed: ['C4'],
    create_started: ['C5'],
    participant_add_attempted: ['C8'],
    participant_added: ['C8'],
    participant_edited: ['C9'],
    participant_removed: ['C10'],
    vink_open_attempted: ['C15'],
    vink_opened: ['C15'],
    vink_open_failed: ['C15'],
    invitation_dispatch_attempted: ['C16'],
    invitation_delivered: ['C16'],
    invitation_delivery_failed: ['C16'],
    invitation_fallback_opened: ['C17', 'C19'],
    invitation_resend_attempted: ['C18'],
    invite_link_copied: ['C20'],
    invite_share_sheet_opened: ['C21'],
    invite_qr_shown: ['C22'],
    contribution_attempted: ['C23', 'C24'],
    contribution_confirmed: ['C23', 'C24'],
    contribution_declined: ['C23', 'C24'],
    guest_contribution_attempted: ['C25'],
    guest_contribution_confirmed: ['C25'],
    guest_contribution_declined: ['C25'],
    contribution_retry_attempted: ['C26'],
    vink_cancel_attempted: ['C27'],
    vink_cancelled: ['C27'],
    card_provisioning_started: ['C30'],
    pay_now_entered: ['C31'],
    vink_completed: ['C32'],
    activity_row_opened: ['C33'],
    vink_details_opened: ['C34'],
    contact_info_updated: ['C35'],
    password_change_attempted: ['C36'],
    password_changed: ['C36'],
    support_contact_opened: ['C37'],
    reauth_prompted: ['C44'],
    reauth_succeeded: ['C44'],
    reauth_cancelled: ['C44'],
    offline_detected: ['C45'],
    reconnected: ['C45'],
    generic_error_shown: ['C45'],
  };

/** The 14 Phase 5 interaction contracts that name no `Analytics:` line at all (pure
 * state-driven visuals, disabled/no-op states, or passive screens) — listed explicitly so a
 * contract test can assert this set plus `EVENT_CONTRACT_SOURCE`'s covered set together
 * equal exactly C1–C45, with none missing and none double-counted. */
export const INTERACTIONS_WITHOUT_ANALYTICS: readonly string[] = [
  'C6',
  'C7',
  'C11',
  'C12',
  'C13',
  'C14',
  'C28',
  'C29',
  'C38',
  'C39',
  'C40',
  'C41',
  'C42',
  'C43',
];

export function allScreenContractIdsCovered(): boolean {
  return SCREEN_CONTRACT_IDS.every((id) => id in SCREEN_CONTRACT_SOURCE);
}

export function allEventNamesCovered(): boolean {
  return VINKIN_ANALYTICS_EVENT_NAMES.every((name) => name in EVENT_CONTRACT_SOURCE);
}
