/**
 * Branded identifiers (Plan §26 Day 2 "Define identifiers") and the PV-track idempotency-key
 * builders (Plan §11). Brands are compile-time only — erasable, zero runtime cost.
 *
 * Two key families exist deliberately:
 *  - These command-level keys (Plan §11 format) identify one financial COMMAND.
 *  - `@vinkin/payment-provider` `operationId.*` (Spec §12 format) identifies one PROVIDER
 *    operation. Application services mint a command key, then derive provider operation ids
 *    when calling the provider. Divergence noted in the PV0–PV2 milestone report.
 */

import { randomUUID } from 'node:crypto';

declare const brand: unique symbol;
type Branded<T extends string> = string & { readonly [brand]: T };

export type UserId = Branded<'UserId'>;
export type GuestIdentityId = Branded<'GuestIdentityId'>;
export type VinkId = Branded<'VinkId'>;
export type ParticipantId = Branded<'ParticipantId'>;
export type ContributionId = Branded<'ContributionId'>;
export type TemporaryCardId = Branded<'TemporaryCardId'>;
export type PurchaseAuthorizationId = Branded<'PurchaseAuthorizationId'>;
export type SettlementId = Branded<'SettlementId'>;
export type RecoveryObligationId = Branded<'RecoveryObligationId'>;

export const newUserId = (): UserId => randomUUID() as UserId;
export const newGuestIdentityId = (): GuestIdentityId => randomUUID() as GuestIdentityId;
export const newVinkId = (): VinkId => randomUUID() as VinkId;
export const newParticipantId = (): ParticipantId => randomUUID() as ParticipantId;
export const newContributionId = (): ContributionId => randomUUID() as ContributionId;
export const newTemporaryCardId = (): TemporaryCardId => randomUUID() as TemporaryCardId;
export const newPurchaseAuthorizationId = (): PurchaseAuthorizationId =>
  randomUUID() as PurchaseAuthorizationId;
export const newSettlementId = (): SettlementId => randomUUID() as SettlementId;
export const newRecoveryObligationId = (): RecoveryObligationId =>
  randomUUID() as RecoveryObligationId;

/** Plan §11 idempotency-key formats, verbatim. Server-derived, never minted per tap. */
export const idempotencyKey = {
  authorizeContribution: (
    vinkId: VinkId,
    participantId: ParticipantId,
    attemptNumber: number,
  ): string => `vink:${vinkId}:participant:${participantId}:authorize:${attemptNumber}`,

  captureContribution: (vinkId: VinkId, contributionId: ContributionId): string =>
    `vink:${vinkId}:contribution:${contributionId}:capture`,

  issueCard: (vinkId: VinkId): string => `vink:${vinkId}:issue-card`,

  capturePurchaseAuthorization: (
    vinkId: VinkId,
    authorizationId: PurchaseAuthorizationId,
  ): string => `vink:${vinkId}:authorization:${authorizationId}:capture`,

  refundContribution: (vinkId: VinkId, contributionId: ContributionId): string =>
    `vink:${vinkId}:contribution:${contributionId}:refund`,
} as const;
