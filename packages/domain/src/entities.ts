/**
 * Core domain entities — Plan §7, restricted to the PV2 scope (Vink, Participant,
 * Contribution, TemporaryCard, plus the purchase-side records they reference).
 * Timestamps are ISO-8601 strings; all amounts are Money (integer minor units).
 */

import type { Money, CurrencyCode } from './money.ts';
import { compareMoney } from './money.ts';
import { invariant } from './errors.ts';
import type {
  CardAssignmentId,
  CardId,
  CardWalletTokenId,
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
  /** Slice I5B (D39) — human-readable payment context ("Team lunch"), non-financial metadata,
   * deliberately separate from `purchaseCategory` (the policy input `policyForCategory`
   * reads — never inferred from this field). Null for every Vink created before this slice
   * and for every Vink the five-step wizard still creates (flag off) — a permanent, valid
   * state, not a backfill gap. */
  purpose: string | null;
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
  /** Client-generated, stable across retries of the same create attempt (ENG1 #4) — lets a
   * lost-response retry return this same Vink instead of creating a duplicate. */
  creationIdempotencyKey: string;
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
  /** Always set at row creation (the "added to this Vink" moment) — same started/outcome
   * timestamp-pair shape as `TemporaryCard.issuedAt`/`RecoveryObligation.dueAt`. */
  invitedAt: string;
  /** Null while `status === 'INVITED'`; set to the real acceptance moment once the
   * participant becomes `JOINED` (immediately, for every path except an existing member
   * added by the organizer — see `acceptInviteCommand`). */
  joinedAt: string | null;
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

// ---------------------------------------------------------------------------
// RM1 (D47) — the reusable card pool. Distinct from TemporaryCard above, which stays
// unchanged until a later RM slice cuts the live FUNDED-Vink flow over to this schema.
// ---------------------------------------------------------------------------

/** RM2 (D47) adds `QUARANTINED`: a card an ambiguous provider outcome touched during the
 * enable/provision/disable/revoke handshake — excluded from `reserveAvailableCard`'s own
 * query by construction, never silently returned to the pool (the invariant "provider
 * failures leave the card RESERVED or QUARANTINED, never AVAILABLE by accident"). Clearing a
 * QUARANTINED card is a manual operator action, not built in this slice. */
export type CardPoolStatus = 'AVAILABLE' | 'RESERVED' | 'QUARANTINED';

/** Long-lived and reusable — never stores PAN or CVV (Plan §7/§21, unchanged discipline). */
export interface Card {
  id: CardId;
  providerCardId: string;
  displayLastFour: string;
  status: CardPoolStatus;
  createdAt: string;
  updatedAt: string;
}

export type CardAssignmentStatus = 'ACTIVE' | 'RETURNED';

/** RM2 (D47) — fine-grained tracking of the enable -> wallet-provision -> disable -> revoke
 * handshake within one ACTIVE assignment. Deliberately narrower than the full chain a
 * provisioning design review proposed: `TOKEN_PROVISIONED` is folded into `READY_TO_PAY`
 * (nothing observes them as separate persisted states within one transaction) and `SETTLED`
 * is omitted (driving a card-pool assignment from a real purchase settlement is RM3's job,
 * not built here) — both disclosed simplifications, not silent gaps. Orthogonal to
 * `CardAssignmentStatus` above: `returnCardToPoolCommand`'s own RM1-proven security gate
 * (checking the wallet token directly) is unchanged by this column's existence. */
export type CardAssignmentProvisioningStatus =
  | 'RESERVED'
  | 'ENABLING'
  | 'AWAITING_WALLET_PROVISIONING'
  | 'READY_TO_PAY'
  | 'DISABLING'
  | 'TOKEN_REVOCATION_PENDING'
  | 'SANITIZED';

/** One row per Vink's use of a pool card — a Vink is assigned a card at most once (never
 * reassigned across attempts); a card is assigned to many Vinks over its lifetime,
 * sequentially, never concurrently (enforced at the DB level, migration 0024). */
export interface CardAssignment {
  id: CardAssignmentId;
  cardId: CardId;
  vinkId: VinkId;
  status: CardAssignmentStatus;
  provisioningStatus: CardAssignmentProvisioningStatus;
  spendingLimit: Money;
  merchantLockKey: string | null;
  reservedAt: string;
  /** The D47 10-minute card usage window — distinct from the Vink's own submission deadline. */
  usageWindowExpiresAt: string;
  returnedAt: string | null;
}

export type CardWalletTokenStatus = 'PROVISIONED' | 'REVOKED';

/** D47: authorizations are approved against the assigned wallet token, not solely the
 * underlying card — a card is only returnable to the pool once its assignment's token is
 * confirmed REVOKED (enforced by the command performing the return, `returnCardToPoolCommand`
 * — this is the actual fix for the reassignment security gap the token model exists for). */
export interface CardWalletToken {
  id: CardWalletTokenId;
  cardAssignmentId: CardAssignmentId;
  providerTokenId: string;
  status: CardWalletTokenStatus;
  provisionedAt: string;
  revokedAt: string | null;
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
