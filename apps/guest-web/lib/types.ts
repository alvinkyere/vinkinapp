// Mirrors packages/application/src/guest.ts's PublicVinkSummary / GuestVinkView — the only
// shapes a guest (unauthenticated visitor or joined participant) is ever allowed to see.

export type PurchaseCategory =
  'GROCERY' | 'RETAIL' | 'ELECTRONICS' | 'RESTAURANT' | 'HOTEL' | 'FUEL' | 'CAR_RENTAL';

export interface PublicVinkSummary {
  publicCode: string;
  purchaseCategory: PurchaseCategory;
  state: string;
  requiredAmountMinor: number;
  fundedAmountMinor: number;
  submissionDeadline: string;
  participantCount: number;
  joinable: boolean;
}

/** D24/Slice I1's `ContributionProgressView` — the aggregate, additive progress signal.
 * Never a per-participant breakdown (privacy — see `packages/application/src/queries.ts`). */
export interface ContributionProgressView {
  confirmedAmountMinor: number;
  totalAmountMinor: number;
  confirmedParticipantCount: number;
  totalParticipantCount: number;
}

/** D25's six-way guest-safe vink-level outcome, plus the two non-terminal values
 * (`open`/`not_open_yet`) — mirrors `packages/application/src/guest.ts`'s `GuestVinkOutcome`
 * exactly. Never a raw D11 state name. */
export type GuestVinkOutcome =
  | 'not_open_yet'
  | 'open'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'return_pending'
  | 'returned'
  | 'recovery_required';

/** D23 — the minimal, customer-safe shape for a vink that hasn't opened yet. Deliberately
 * withholds everything else (amount, split, category) — mirrors
 * `packages/application/src/guest.ts`'s `NotOpenYetView`. */
export interface NotOpenYetView {
  vinkOutcome: 'not_open_yet';
}

/** D24 — `PublicVinkSummary` plus the two additive, guest-safe projections. Always present
 * on the full (non-`NotOpenYetView`) shape — mirrors `EnrichedPublicVinkSummary`. */
export type EnrichedPublicVinkSummary = PublicVinkSummary & {
  contributionProgress: ContributionProgressView;
  vinkOutcome: GuestVinkOutcome;
};

/** What `GET /api/v1/join/:publicCode` actually returns — a discriminated union on
 * `vinkOutcome === 'not_open_yet'` (the only case `NotOpenYetView` has no other fields). */
export type PublicVinkView = NotOpenYetView | EnrichedPublicVinkSummary;

/** D24/D25's eight-value guest-safe contribution status — the viewer's own outcome only,
 * never another participant's. Mirrors `GuestContributionStatus` exactly. */
export type GuestContributionStatus =
  | 'not_started'
  | 'processing'
  | 'confirmed'
  | 'declined_retryable'
  | 'declined_final'
  | 'return_pending'
  | 'returned'
  | 'recovery_required';

export interface GuestParticipant {
  id: string;
  vinkId: string;
  displayName: string;
  status: 'INVITED' | 'JOINED' | 'REMOVED';
  allocatedAmountMinor: number;
  maximumApprovedAmountMinor: number;
  /** D24/D25 — this guest's own contribution outcome, never another participant's. */
  contributionStatus: GuestContributionStatus;
}

export interface GuestVinkView {
  vink: EnrichedPublicVinkSummary;
  participant: GuestParticipant;
}

/** What `GET /api/v1/guest/session` actually returns — same discriminated-union shape as
 * `PublicVinkView`, for the same D23 reason (a joined guest can still land on a DRAFT vink
 * if invited before OPEN). */
export type GuestVinkViewResult = NotOpenYetView | GuestVinkView;

export interface GuestSession {
  publicCode: string;
  guestToken: string;
  vinkId: string;
}

export interface ContributionView {
  id: string;
  participantId: string;
  attemptNumber: number;
  status: string;
  requestedAmountMinor: number;
  authorizedAmountMinor: number | null;
  capturedAmountMinor: number | null;
}

export interface AuthorizeContributionResponse {
  contribution: ContributionView;
  vinkState: string;
  replayed: boolean;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
}
