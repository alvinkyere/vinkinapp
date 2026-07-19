/**
 * Mock card + purchase engine (PV6). Card issuance/closure reach the provider ONLY through
 * the neutral FinancialProvider interface. The merchant-authorization DECISION is VinkIn's
 * own §17 engine — card state, first-merchant lock, spend limit — decided from domain state,
 * never delegated to the provider. The merchant *simulation* (a swipe arriving) lives at the
 * simulator transport, which feeds a providerAuthorizationId in here for dedupe (E4) and
 * capture linkage.
 *
 * Every transition is one row-locked unit of work with its outbox event (D12); the vink row
 * is locked first (Plan §11). The FUNDED→COMPLETED path posts to the ledger; the DB's
 * balanced/append-only triggers are the final guard. Provider calls (issuance/closure)
 * happen inside that unit of work — ratified for the mock build as D15.
 */

import {
  compareMoney,
  idempotencyKey,
  money,
  newPurchaseAuthorizationId,
  newSettlementId,
  newTemporaryCardId,
  subtractMoney,
  type PurchaseAuthorization,
  type Settlement,
  type TemporaryCard,
  type Vink,
  type VinkId,
} from '../../domain/src/index.ts';
import { ProviderError, type FinancialProvider } from '../../payment-provider/src/index.ts';
import {
  authorizationReservePosting,
  reserveReleasePosting,
  settlementExpensePosting,
} from '../../ledger/src/index.ts';
import { ApplicationError } from './errors.ts';
import type { PublicCommandContext } from './ports.ts';
import { applyVinkTransition } from './support/transition.ts';

/** Cash-like MCCs are always blocked on the temporary card (§3.2/§36). */
const BLOCKED_MCCS = ['6010', '6011', '6012', '7995'] as const;
const CARD_TTL_DAYS = 3;

export interface PurchaseCommandContext extends PublicCommandContext {
  provider: FinancialProvider;
}

export interface MerchantAuthorizationRequest {
  vinkId: VinkId;
  providerAuthorizationId: string;
  merchantName: string;
  merchantIdentifier: string;
  mcc: string;
  amountMinor: number;
}

export type PurchaseOutcome = 'APPROVED' | 'DECLINED' | 'DUPLICATE';

// ---------------------------------------------------------------------------
// ProvisionCardCommand — FUNDED → CARD_READY (or FUNDING_REVERSAL on failure)
// ---------------------------------------------------------------------------

type ProvisionOutcome =
  { kind: 'ISSUED'; card: TemporaryCard } | { kind: 'FAILED'; message: string };

export async function provisionCardCommand(
  ctx: PurchaseCommandContext,
  input: { vinkId: VinkId },
): Promise<TemporaryCard> {
  // The reversal path RETURNS an outcome instead of throwing — throwing inside `uow.run`
  // rolls the whole transaction back, which previously undid the funding reversal itself
  // (PV3's reuse-detection defect, same shape; see the PV7 milestone report). The
  // caller-visible error is raised only after the reversal has committed.
  const outcome = await ctx.uow.run(async (tx): Promise<ProvisionOutcome> => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    if (vink.state !== 'FUNDED') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `card provisioning requires FUNDED (state: ${vink.state})`,
      );
    }
    const now = ctx.clock.now();
    const provisioning = await applyVinkTransition(
      tx,
      vink,
      'CARD_PROVISIONING_STARTED',
      'system',
      ctx.correlationId,
      now,
    );

    try {
      const { providerCardholderId } = await ctx.provider.createCardholder({
        idempotencyKey: `cardholder:v1:${vink.organizerUserId}`,
        externalAccountId: vink.organizerUserId,
        legalName: `Organizer ${vink.organizerUserId}`,
      });
      const issued = await ctx.provider.issueTemporaryCard({
        idempotencyKey: idempotencyKey.issueCard(vink.id),
        providerCardholderId,
        spendLimit: vink.fundedAmount, // EXACT_FINAL: card limit = funded amount (Plan §16)
        metadata: { vinkId: vink.id },
      });
      await ctx.provider.updateCardControls({
        providerCardId: issued.providerCardId,
        blockedMccs: BLOCKED_MCCS,
      });

      const card: TemporaryCard = {
        id: newTemporaryCardId(),
        vinkId: vink.id,
        providerCardId: issued.providerCardId,
        displayLastFour: '4242', // mock; a real adapter returns the issued last four
        status: 'ACTIVE',
        spendingLimit: vink.fundedAmount,
        merchantLockKey: null,
        expiresAt: new Date(now.getTime() + CARD_TTL_DAYS * 86_400_000).toISOString(),
        issuedAt: now.toISOString(),
        closedAt: null,
      };
      await tx.insertCard(card);
      await applyVinkTransition(tx, provisioning, 'CARD_ISSUED', 'system', ctx.correlationId, now);
      return { kind: 'ISSUED', card };
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // Issuance failed: reverse funding (the state machine's dead-end exit → EXPIRED).
      const failedCard: TemporaryCard = {
        id: newTemporaryCardId(),
        vinkId: vink.id,
        providerCardId: '',
        displayLastFour: '0000',
        status: 'FAILED',
        spendingLimit: vink.fundedAmount,
        merchantLockKey: null,
        expiresAt: now.toISOString(),
        issuedAt: now.toISOString(),
        closedAt: now.toISOString(),
      };
      await tx.insertCard(failedCard);
      const reversal = await applyVinkTransition(
        tx,
        provisioning,
        'CARD_PROVISIONING_FAILED',
        'system',
        ctx.correlationId,
        now,
      );
      await applyVinkTransition(
        tx,
        reversal,
        'FUNDING_REVERSAL_COMPLETED',
        'system',
        ctx.correlationId,
        now,
      );
      return { kind: 'FAILED', message: error.message };
    }
  });

  if (outcome.kind === 'FAILED') {
    throw new ApplicationError('INVALID_COMMAND', `card issuance failed: ${outcome.message}`);
  }
  return outcome.card;
}

// ---------------------------------------------------------------------------
// AuthorizeMerchantPurchaseCommand — VinkIn's §17 decision (exactly-one guard)
// ---------------------------------------------------------------------------

export interface MerchantAuthorizationResult {
  outcome: PurchaseOutcome;
  authorization: PurchaseAuthorization;
  vinkState: Vink['state'];
}

export async function authorizeMerchantPurchaseCommand(
  ctx: PurchaseCommandContext,
  input: MerchantAuthorizationRequest,
): Promise<MerchantAuthorizationResult> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    const card = await tx.getCardByVinkForUpdate(vink.id);
    const existing = await tx.listPurchaseAuthorizationsForUpdate(vink.id);
    const now = ctx.clock.now();

    // E4: a duplicate merchant authorization returns the SAME recorded decision.
    const duplicate = existing.find(
      (row) => row.providerAuthorizationId === input.providerAuthorizationId,
    );
    if (duplicate !== undefined) {
      return { outcome: 'DUPLICATE', authorization: duplicate, vinkState: vink.state };
    }

    const amount = money(input.amountMinor);
    const decline = async (reason: string): Promise<MerchantAuthorizationResult> => {
      const declined: PurchaseAuthorization = {
        id: newPurchaseAuthorizationId(),
        vinkId: vink.id,
        temporaryCardId: card?.id ?? newTemporaryCardId(),
        providerAuthorizationId: input.providerAuthorizationId,
        merchantName: input.merchantName,
        merchantIdentifier: input.merchantIdentifier,
        mcc: input.mcc,
        requestedAmount: amount,
        approvedAmount: null,
        status: 'DECLINED',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await tx.insertPurchaseAuthorization(declined);
      await tx.insertOutbox({
        eventType: 'MerchantAuthorizationDeclined',
        aggregateType: 'vink',
        aggregateId: vink.id,
        payload: { vinkId: vink.id, reason, amountMinor: amount.amountMinor },
      });
      return { outcome: 'DECLINED', authorization: declined, vinkState: vink.state };
    };

    // §17 decision, in order: card usable → merchant lock → spend limit.
    if (card === null || card.status !== 'ACTIVE') return decline('CARD_NOT_ACTIVE');
    if (vink.state !== 'CARD_READY') return decline('CARD_NOT_READY');
    if (card.merchantLockKey !== null && card.merchantLockKey !== input.merchantIdentifier) {
      return decline('MERCHANT_LOCKED');
    }
    if (compareMoney(amount, card.spendingLimit) > 0) return decline('OVER_LIMIT');

    const approved: PurchaseAuthorization = {
      id: newPurchaseAuthorizationId(),
      vinkId: vink.id,
      temporaryCardId: card.id,
      providerAuthorizationId: input.providerAuthorizationId,
      merchantName: input.merchantName,
      merchantIdentifier: input.merchantIdentifier,
      mcc: input.mcc,
      requestedAmount: amount,
      approvedAmount: amount,
      status: 'APPROVED',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await tx.insertPurchaseAuthorization(approved);
    // First-merchant lock: bind the card to this merchant in the same transaction (§17/§18).
    await tx.updateCard({ ...card, merchantLockKey: input.merchantIdentifier });
    const locked: Vink = { ...vink, merchantLockStatus: 'LOCKED' };
    const authorized = await applyVinkTransition(
      tx,
      locked,
      'MERCHANT_AUTHORIZATION_APPROVED',
      'system',
      ctx.correlationId,
      now,
    );
    await tx.insertOutbox({
      eventType: 'MerchantLocked',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: { vinkId: vink.id, merchantIdentifier: input.merchantIdentifier },
    });
    await tx.insertLedgerPosting({
      referenceType: 'vink',
      referenceId: vink.id,
      entries: authorizationReservePosting(amount).entries,
    });
    return { outcome: 'APPROVED', authorization: approved, vinkState: authorized.state };
  });
}

// ---------------------------------------------------------------------------
// ReverseAuthorizationCommand — PURCHASE_AUTHORIZED → CARD_READY
// ---------------------------------------------------------------------------

export async function reverseAuthorizationCommand(
  ctx: PurchaseCommandContext,
  input: { vinkId: VinkId; authorizationId: string },
): Promise<Vink> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    const authorizations = await tx.listPurchaseAuthorizationsForUpdate(vink.id);
    const authorization = authorizations.find((row) => row.id === input.authorizationId);
    if (authorization === undefined || authorization.status !== 'APPROVED') {
      throw new ApplicationError('PARTICIPANT_NOT_FOUND', 'no approved authorization to reverse');
    }
    const now = ctx.clock.now();
    await tx.updatePurchaseAuthorization({
      ...authorization,
      status: 'REVERSED',
      updatedAt: now.toISOString(),
    });
    const reversed = await applyVinkTransition(
      tx,
      vink,
      'AUTHORIZATION_REVERSED',
      'system',
      ctx.correlationId,
      now,
    );
    await tx.insertLedgerPosting({
      referenceType: 'vink',
      referenceId: vink.id,
      entries: reserveReleasePosting(authorization.approvedAmount ?? money(0)).entries,
    });
    return reversed;
  });
}

// ---------------------------------------------------------------------------
// SettlePurchaseCommand — capture → SETTLING → COMPLETED | RECOVERY_REQUIRED
// ---------------------------------------------------------------------------

export interface SettlementResult {
  settlement: Settlement;
  vinkState: Vink['state'];
}

export async function settlePurchaseCommand(
  ctx: PurchaseCommandContext,
  input: { vinkId: VinkId; authorizationId: string; settledAmountMinor: number },
): Promise<SettlementResult> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    if (vink.state !== 'PURCHASE_AUTHORIZED') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `settlement requires PURCHASE_AUTHORIZED (state: ${vink.state})`,
      );
    }
    const authorizations = await tx.listPurchaseAuthorizationsForUpdate(vink.id);
    const authorization = authorizations.find((row) => row.id === input.authorizationId);
    if (authorization === undefined || authorization.status !== 'APPROVED') {
      throw new ApplicationError('PARTICIPANT_NOT_FOUND', 'no approved authorization to settle');
    }
    const card = await tx.getCardByVinkForUpdate(vink.id);
    const approved = authorization.approvedAmount ?? money(0);
    const settled = money(input.settledAmountMinor);
    const now = ctx.clock.now();

    await tx.updatePurchaseAuthorization({
      ...authorization,
      status: 'CAPTURED',
      updatedAt: now.toISOString(),
    });
    const settling = await applyVinkTransition(
      tx,
      vink,
      'PURCHASE_CAPTURED',
      'system',
      ctx.correlationId,
      now,
    );

    // Expense = min(settled, approved); release any unused reserve; overage → recovery (PV7).
    const expense = compareMoney(settled, approved) <= 0 ? settled : approved;
    if (expense.amountMinor > 0) {
      await tx.insertLedgerPosting({
        referenceType: 'settlement',
        referenceId: authorization.id,
        entries: settlementExpensePosting(expense).entries,
      });
    }
    if (compareMoney(approved, settled) > 0) {
      await tx.insertLedgerPosting({
        referenceType: 'settlement',
        referenceId: authorization.id,
        entries: reserveReleasePosting(subtractMoney(approved, settled)).entries,
      });
    }

    const comparison = compareMoney(settled, approved);
    const status: Settlement['status'] =
      comparison === 0 ? 'MATCHED' : comparison < 0 ? 'UNDERAGE' : 'OVERAGE';
    const variance =
      comparison === 0
        ? money(0)
        : comparison < 0
          ? subtractMoney(approved, settled)
          : subtractMoney(settled, approved);
    const settlement: Settlement = {
      id: newSettlementId(),
      vinkId: vink.id,
      authorizationId: authorization.id,
      settledAmount: settled,
      varianceAmount: variance,
      status,
      settledAt: now.toISOString(),
      createdAt: now.toISOString(),
    };
    await tx.insertSettlement(settlement);

    if (status === 'OVERAGE') {
      // Recovery obligation + organizer charging is PV7; PV6 stops at the observable state.
      const flagged = await applyVinkTransition(
        tx,
        settling,
        'SETTLEMENT_OVERAGE_DETECTED',
        'system',
        ctx.correlationId,
        now,
      );
      return { settlement, vinkState: flagged.state };
    }

    // MATCHED / UNDERAGE complete the purchase; close the mock card.
    if (card !== null) {
      await ctx.provider.closeCard(card.providerCardId);
      await tx.updateCard({ ...card, status: 'CLOSED', closedAt: now.toISOString() });
    }
    const completed = await applyVinkTransition(
      tx,
      settling,
      'SETTLEMENT_MATCHED',
      'system',
      ctx.correlationId,
      now,
    );
    return { settlement, vinkState: completed.state };
  });
}
