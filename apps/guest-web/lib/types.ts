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

export interface GuestParticipant {
  id: string;
  vinkId: string;
  displayName: string;
  status: 'INVITED' | 'JOINED' | 'REMOVED';
  allocatedAmountMinor: number;
  maximumApprovedAmountMinor: number;
}

export interface GuestVinkView {
  vink: PublicVinkSummary;
  participant: GuestParticipant;
}

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
