/**
 * Core domain entities — Plan §7, restricted to the PV2 scope (Vink, Participant,
 * Contribution, TemporaryCard, plus the purchase-side records they reference).
 * Timestamps are ISO-8601 strings; all amounts are Money (integer minor units).
 */

import type { Money, CurrencyCode } from './money.ts';
import { compareMoney } from './money.ts';
import { invariant } from './errors.ts';
import type {
  ContributionId,
  GuestIdentityId,
  ParticipantId,
  PurchaseAuthorizationId,
  RecoveryObligationId,
  SettlementId,
  TemporaryCardId,
  UserId,
  VinkId,
} from './ids.ts';
import type { VinkState } from './vink-state-machine.ts';
import type { ContributionStatus } from './contribution-state-machine.ts';
import type { PurchaseCategory, PolicyType } from './policy.ts';

export type SplitMethod = 'EQUAL' | 'CUSTOM_AMOUNT' | 'PERCENTAGE' | 'ITEMIZED_LATER';

export type ParticipantRole = 'ORGANIZER' | 'MEMBER';
export type ParticipantStatus = 'INVITED' | 'JOINED' | 'REMOVED';
export type MerchantLockStatus = 'UNLOCKED' | 'LOCKED';
export type TemporaryCardStatus = 'REQUESTED' | 'ACTIVE' | 'CLOSED' | 'FAILED';
export type PurchaseAuthorizationStatus = 'APPROVED' | 'DECLINED' | 'REVERSED' | 'CAPTURED';
export type SettlementStatus = 'MATCHED' | 'OVERAGE' | 'UNDERAGE';
export type RecoveryObligationStatus = 'CREATED' | 'PENDING' | 'RESOLVED' | 'DEFAULTED';

export interface Vink {
  id: VinkId;
  organizerUserId: UserId;
  publicCode: string; // cryptographically random, never sequential (Plan §21)
  currency: CurrencyCode;
  purchaseCategory: PurchaseCategory;
  paymentPolicy: PolicyType;
  subtotalAmount: Money;
  tipAmount: Money;
  maximumAmount: Money;
  requiredAmount: Money;
  fundedAmount: Money;
  state: VinkState;
  submissionDeadline: string;
  processingGraceDeadline: string;
  merchantLockStatus: MerchantLockStatus;
  version: number; // optimistic concurrency (Plan §11); increments on every mutation
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id: ParticipantId;
  vinkId: VinkId;
  userId: UserId | null;
  guestIdentityId: GuestIdentityId | null;
  displayName: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  allocatedAmount: Money;
  maximumApprovedAmount: Money;
  joinedAt: string;
  updatedAt: string;
}

export interface Contribution {
  id: ContributionId;
  vinkId: VinkId;
  participantId: ParticipantId;
  /** Plan §11: a retry after a definitive decline is a NEW contribution, next attempt. */
  attemptNumber: number;
  requestedAmount: Money;
  authorizedAmount: Money | null;
  capturedAmount: Money | null;
  refundedAmount: Money | null;
  status: ContributionStatus;
  providerReference: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Never stores PAN or CVV, even for mock cards (Plan §7). */
export interface TemporaryCard {
  id: TemporaryCardId;
  vinkId: VinkId;
  providerCardId: string;
  displayLastFour: string;
  status: TemporaryCardStatus;
  spendingLimit: Money;
  merchantLockKey: string | null;
  expiresAt: string;
  issuedAt: string;
  closedAt: string | null;
}

export interface PurchaseAuthorization {
  id: PurchaseAuthorizationId;
  vinkId: VinkId;
  temporaryCardId: TemporaryCardId;
  providerAuthorizationId: string | null;
  merchantName: string;
  merchantIdentifier: string;
  mcc: string;
  requestedAmount: Money;
  approvedAmount: Money | null;
  status: PurchaseAuthorizationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Settlement {
  id: SettlementId;
  vinkId: VinkId;
  authorizationId: PurchaseAuthorizationId;
  settledAmount: Money;
  varianceAmount: Money; // magnitude; direction is the status (OVERAGE/UNDERAGE)
  status: SettlementStatus;
  settledAt: string;
  createdAt: string;
}

export interface RecoveryObligation {
  id: RecoveryObligationId;
  vinkId: VinkId;
  organizerUserId: UserId;
  amount: Money;
  reason: 'SETTLEMENT_OVERAGE' | 'MANUAL_ADJUSTMENT';
  status: RecoveryObligationStatus;
  /** Charge attempts made so far; the retry ladder defaults after a configured max (§23). */
  attemptCount: number;
  dueAt: string;
  resolvedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Invariants (Plan §7, §15; Spec §4.7)
// ---------------------------------------------------------------------------

/** Exactly one of userId / guestIdentityId must be present (Plan §7). */
export function assertParticipantIdentity(
  participant: Pick<Participant, 'userId' | 'guestIdentityId'>,
): void {
  const hasUser = participant.userId !== null;
  const hasGuest = participant.guestIdentityId !== null;
  invariant(hasUser !== hasGuest, 'Participant must have exactly one of userId or guestIdentityId');
}

/**
 * A participant is never charged beyond their explicitly approved maximum (Spec §4.7).
 * Checked against authorized and captured amounts before any provider call is recorded.
 */
export function assertWithinApprovedMaximum(
  amount: Money,
  maximumApprovedAmount: Money,
  label: string,
): void {
  invariant(
    compareMoney(amount, maximumApprovedAmount) <= 0,
    `${label}: ${amount.amountMinor} exceeds approved maximum ${maximumApprovedAmount.amountMinor} (§4.7)`,
  );
}

/** requiredAmount ≤ maximumAmount; fundedAmount ≤ maximumAmount; subtotal + tip = required for EXACT_FINAL is policy-checked separately. */
export function assertVinkAmounts(
  vink: Pick<Vink, 'requiredAmount' | 'maximumAmount' | 'fundedAmount'>,
): void {
  invariant(
    compareMoney(vink.requiredAmount, vink.maximumAmount) <= 0,
    'Vink requiredAmount must not exceed maximumAmount',
  );
  invariant(
    compareMoney(vink.fundedAmount, vink.maximumAmount) <= 0,
    'Vink fundedAmount must not exceed maximumAmount',
  );
}

/** Mock or real, a card record may carry only the last four display digits (Plan §7/§21). */
export function assertCardDisplaySafety(card: Pick<TemporaryCard, 'displayLastFour'>): void {
  invariant(
    /^\d{4}$/.test(card.displayLastFour),
    'TemporaryCard.displayLastFour must be exactly four digits — never a PAN or CVV',
  );
}
