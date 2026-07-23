/**
 * ENG2 — typed interaction-event contracts for the C1–C45 catalog in
 * `docs/design/phase-5-button-interaction-contracts.md` ("Phase 5"). Every event name and
 * every payload field below is copied verbatim from that document's per-contract
 * `Analytics:` line — nothing here is invented. 14 of the 45 contracts (C6, C7, C11–C14,
 * C28, C29, C38–C43) name no `Analytics:` line at all and therefore emit no event; they are
 * absent from this file on purpose, not by oversight (`traceability.ts` asserts this
 * explicitly). The remaining 31 contracts produce 46 distinct event names, not 31 — C23/C24
 * share all 3 of their names verbatim and C17/C19 share one ("invitation_fallback_opened"),
 * per Phase 5's own text for each.
 *
 * Envelope shape (`VinkinAnalyticsBatchRequest`) is copied from the real, already-shipped
 * Zod schema at `apps/api/src/modules/analytics/routes.ts` (`batchSchema`/`eventSchema`) —
 * this file does not invent a transport shape either, it types the one that exists.
 */

import type { ParticipantId, VinkId } from '../../domain/src/index.ts';

// ---------------------------------------------------------------------------
// Envelope — matches apps/api/src/modules/analytics/routes.ts exactly. `app` has exactly
// the two values the real Zod `z.enum([...])` accepts; a third value (e.g. for
// operations-console) does not exist in the shipped schema and is not invented here.
// ---------------------------------------------------------------------------

export type VinkinAnalyticsApp = 'organizer_mobile' | 'guest_web';

export interface VinkinAnalyticsEventEnvelope<
  Name extends string = string,
  Properties = Record<string, unknown>,
> {
  readonly eventName: Name;
  /** Matches the real schema's top-level, optional `vinkId` — carried once per event, not
   * duplicated inside `properties` even for the Phase 5 contracts whose prose lists
   * `{vinkId}` (C33/C34): the real transport already has a first-class slot for it. */
  readonly vinkId?: VinkId;
  readonly properties: Properties;
  /** ISO 8601 — decided by `occurredAt`, matching the Spec §28 discipline of deciding by
   * event time, never arrival time, applied here to client events too. */
  readonly occurredAt: string;
}

export interface VinkinAnalyticsBatchRequest<
  E extends VinkinAnalyticsEventEnvelope = VinkinAnalyticsEventEnvelope,
> {
  readonly clientId: string;
  readonly app: VinkinAnalyticsApp;
  readonly events: readonly E[];
}

// ---------------------------------------------------------------------------
// Group A — Auth (C1–C4)
// ---------------------------------------------------------------------------

export type WelcomeLoginTapped = VinkinAnalyticsEventEnvelope<
  'welcome_login_tapped',
  Record<string, never>
>;
export type WelcomeRegisterTapped = VinkinAnalyticsEventEnvelope<
  'welcome_register_tapped',
  Record<string, never>
>;
export type LoginAttempted = VinkinAnalyticsEventEnvelope<'login_attempted', Record<string, never>>;
export type LoginFailed = VinkinAnalyticsEventEnvelope<'login_failed', { readonly code: string }>;
export type RegistrationAttempted = VinkinAnalyticsEventEnvelope<
  'registration_attempted',
  Record<string, never>
>;
export type RegistrationFailed = VinkinAnalyticsEventEnvelope<
  'registration_failed',
  { readonly code: string }
>;

// ---------------------------------------------------------------------------
// Group B — Create (C5, C8–C10, C15)
// ---------------------------------------------------------------------------

export type CreateStarted = VinkinAnalyticsEventEnvelope<'create_started', Record<string, never>>;
export type ParticipantAddAttempted = VinkinAnalyticsEventEnvelope<
  'participant_add_attempted',
  Record<string, never>
>;
export type ParticipantAdded = VinkinAnalyticsEventEnvelope<
  'participant_added',
  { readonly role: 'member' | 'guest' }
>;
export type ParticipantEdited = VinkinAnalyticsEventEnvelope<
  'participant_edited',
  Record<string, never>
>;
export type ParticipantRemoved = VinkinAnalyticsEventEnvelope<
  'participant_removed',
  Record<string, never>
>;
export type VinkOpenAttempted = VinkinAnalyticsEventEnvelope<
  'vink_open_attempted',
  Record<string, never>
>;
export type VinkOpened = VinkinAnalyticsEventEnvelope<'vink_opened', Record<string, never>>;
export type VinkOpenFailed = VinkinAnalyticsEventEnvelope<
  'vink_open_failed',
  { readonly code: string }
>;

// ---------------------------------------------------------------------------
// Group C — Invitation delivery (C16–C19)
// ---------------------------------------------------------------------------

export type InvitationDispatchAttempted = VinkinAnalyticsEventEnvelope<
  'invitation_dispatch_attempted',
  { readonly count: number }
>;
export type InvitationDelivered = VinkinAnalyticsEventEnvelope<
  'invitation_delivered',
  { readonly participantId: ParticipantId }
>;
export type InvitationDeliveryFailed = VinkinAnalyticsEventEnvelope<
  'invitation_delivery_failed',
  { readonly participantId: ParticipantId }
>;
/** Shared by C17 (`reason: 'delivery_failed'`) and C19 (`reason: 'manual'`) — one event
 * name, two reasons, exactly as Phase 5 documents both contracts opening the same sheet. */
export type InvitationFallbackOpened = VinkinAnalyticsEventEnvelope<
  'invitation_fallback_opened',
  { readonly participantId: ParticipantId; readonly reason: 'delivery_failed' | 'manual' }
>;
export type InvitationResendAttempted = VinkinAnalyticsEventEnvelope<
  'invitation_resend_attempted',
  { readonly participantId: ParticipantId }
>;
export type InviteLinkCopied = VinkinAnalyticsEventEnvelope<
  'invite_link_copied',
  Record<string, never>
>;
export type InviteShareSheetOpened = VinkinAnalyticsEventEnvelope<
  'invite_share_sheet_opened',
  Record<string, never>
>;
export type InviteQrShown = VinkinAnalyticsEventEnvelope<'invite_qr_shown', Record<string, never>>;

// ---------------------------------------------------------------------------
// Group D — Contribution (C23–C27)
// ---------------------------------------------------------------------------

/** Shared verbatim by C23 (organizer) and C24 (member) — Phase 5 states C24 is
 * "Identical contract to C23 — same endpoint, same UI" (Phase 0 §3's no-role-shortcut
 * rule), so this file does not declare two separate event families for them. */
export type ContributionAttempted = VinkinAnalyticsEventEnvelope<
  'contribution_attempted',
  Record<string, never>
>;
export type ContributionConfirmed = VinkinAnalyticsEventEnvelope<
  'contribution_confirmed',
  Record<string, never>
>;
export type ContributionDeclined = VinkinAnalyticsEventEnvelope<
  'contribution_declined',
  Record<string, never>
>;

export type GuestContributionAttempted = VinkinAnalyticsEventEnvelope<
  'guest_contribution_attempted',
  Record<string, never>
>;
export type GuestContributionConfirmed = VinkinAnalyticsEventEnvelope<
  'guest_contribution_confirmed',
  Record<string, never>
>;
export type GuestContributionDeclined = VinkinAnalyticsEventEnvelope<
  'guest_contribution_declined',
  Record<string, never>
>;

export type ContributionRetryAttempted = VinkinAnalyticsEventEnvelope<
  'contribution_retry_attempted',
  Record<string, never>
>;

export type VinkCancelAttempted = VinkinAnalyticsEventEnvelope<
  'vink_cancel_attempted',
  Record<string, never>
>;
export type VinkCancelled = VinkinAnalyticsEventEnvelope<'vink_cancelled', Record<string, never>>;

// ---------------------------------------------------------------------------
// Group E — Live Vink / Ink Progress / Payment (C30–C32)
// ---------------------------------------------------------------------------

export type CardProvisioningStarted = VinkinAnalyticsEventEnvelope<
  'card_provisioning_started',
  Record<string, never>
>;
export type PayNowEntered = VinkinAnalyticsEventEnvelope<'pay_now_entered', Record<string, never>>;
export type VinkCompleted = VinkinAnalyticsEventEnvelope<'vink_completed', Record<string, never>>;

// ---------------------------------------------------------------------------
// Group F — Activity / Profile (C33–C37)
// ---------------------------------------------------------------------------

export type ActivityRowOpened = VinkinAnalyticsEventEnvelope<
  'activity_row_opened',
  Record<string, never>
>;
export type VinkDetailsOpened = VinkinAnalyticsEventEnvelope<
  'vink_details_opened',
  Record<string, never>
>;
export type ContactInfoUpdated = VinkinAnalyticsEventEnvelope<
  'contact_info_updated',
  Record<string, never>
>;
export type PasswordChangeAttempted = VinkinAnalyticsEventEnvelope<
  'password_change_attempted',
  Record<string, never>
>;
export type PasswordChanged = VinkinAnalyticsEventEnvelope<
  'password_changed',
  Record<string, never>
>;
export type SupportContactOpened = VinkinAnalyticsEventEnvelope<
  'support_contact_opened',
  { readonly source: 'profile' | 'vink_details' }
>;

// ---------------------------------------------------------------------------
// Group H — Cross-cutting (C44–C45)
// ---------------------------------------------------------------------------

export type ReauthPrompted = VinkinAnalyticsEventEnvelope<'reauth_prompted', Record<string, never>>;
export type ReauthSucceeded = VinkinAnalyticsEventEnvelope<
  'reauth_succeeded',
  Record<string, never>
>;
export type ReauthCancelled = VinkinAnalyticsEventEnvelope<
  'reauth_cancelled',
  Record<string, never>
>;

export type OfflineDetected = VinkinAnalyticsEventEnvelope<
  'offline_detected',
  Record<string, never>
>;
export type Reconnected = VinkinAnalyticsEventEnvelope<'reconnected', Record<string, never>>;
export type GenericErrorShown = VinkinAnalyticsEventEnvelope<
  'generic_error_shown',
  { readonly context: string }
>;

/** The exhaustive union of every event this file declares — used by `events.test.ts` for a
 * compile-time exhaustiveness check (a `switch` over `eventName` with a `never` default) and
 * by `traceability.ts` to cross-reference against Phase 5's own C1–C45 catalog. */
export type VinkinAnalyticsEvent =
  | WelcomeLoginTapped
  | WelcomeRegisterTapped
  | LoginAttempted
  | LoginFailed
  | RegistrationAttempted
  | RegistrationFailed
  | CreateStarted
  | ParticipantAddAttempted
  | ParticipantAdded
  | ParticipantEdited
  | ParticipantRemoved
  | VinkOpenAttempted
  | VinkOpened
  | VinkOpenFailed
  | InvitationDispatchAttempted
  | InvitationDelivered
  | InvitationDeliveryFailed
  | InvitationFallbackOpened
  | InvitationResendAttempted
  | InviteLinkCopied
  | InviteShareSheetOpened
  | InviteQrShown
  | ContributionAttempted
  | ContributionConfirmed
  | ContributionDeclined
  | GuestContributionAttempted
  | GuestContributionConfirmed
  | GuestContributionDeclined
  | ContributionRetryAttempted
  | VinkCancelAttempted
  | VinkCancelled
  | CardProvisioningStarted
  | PayNowEntered
  | VinkCompleted
  | ActivityRowOpened
  | VinkDetailsOpened
  | ContactInfoUpdated
  | PasswordChangeAttempted
  | PasswordChanged
  | SupportContactOpened
  | ReauthPrompted
  | ReauthSucceeded
  | ReauthCancelled
  | OfflineDetected
  | Reconnected
  | GenericErrorShown;

export type VinkinAnalyticsEventName = VinkinAnalyticsEvent['eventName'];

/** Every event name this file declares, in the exact order Phase 5 §3 introduces them
 * (Group A → Group H). Kept as a runtime array (not just the type union above) because
 * `traceability.ts`/`events.test.ts` need to iterate and diff it against Phase 5's own C1–
 * C45 table at test time — TypeScript unions aren't enumerable at runtime. */
export const VINKIN_ANALYTICS_EVENT_NAMES = [
  'welcome_login_tapped',
  'welcome_register_tapped',
  'login_attempted',
  'login_failed',
  'registration_attempted',
  'registration_failed',
  'create_started',
  'participant_add_attempted',
  'participant_added',
  'participant_edited',
  'participant_removed',
  'vink_open_attempted',
  'vink_opened',
  'vink_open_failed',
  'invitation_dispatch_attempted',
  'invitation_delivered',
  'invitation_delivery_failed',
  'invitation_fallback_opened',
  'invitation_resend_attempted',
  'invite_link_copied',
  'invite_share_sheet_opened',
  'invite_qr_shown',
  'contribution_attempted',
  'contribution_confirmed',
  'contribution_declined',
  'guest_contribution_attempted',
  'guest_contribution_confirmed',
  'guest_contribution_declined',
  'contribution_retry_attempted',
  'vink_cancel_attempted',
  'vink_cancelled',
  'card_provisioning_started',
  'pay_now_entered',
  'vink_completed',
  'activity_row_opened',
  'vink_details_opened',
  'contact_info_updated',
  'password_change_attempted',
  'password_changed',
  'support_contact_opened',
  'reauth_prompted',
  'reauth_succeeded',
  'reauth_cancelled',
  'offline_detected',
  'reconnected',
  'generic_error_shown',
] as const satisfies readonly VinkinAnalyticsEventName[];
