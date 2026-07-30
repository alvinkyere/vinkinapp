/**
 * Mock card + purchase engine (PV6, cut over to the RM1/RM2 card pool by RM3B/D47). Card
 * issuance/closure reach the provider ONLY through the neutral FinancialProvider interface.
 * The merchant-authorization DECISION is VinkIn's own §17 engine — card state, first-merchant
 * lock, spend limit — decided from domain state, never delegated to the provider. The merchant
 * *simulation* (a swipe arriving) lives at the simulator transport, which feeds a
 * providerAuthorizationId in here for dedupe (E4) and capture linkage.
 *
 * RM3B (D47): the live FUNDED-Vink flow now provisions from RM1/RM2's reusable card pool via
 * `provisionCardFromPoolCommand`, not the legacy one-shot `provisionCardCommand` below (kept
 * fully intact — untouched, still exported, still tested — for backward compatibility with any
 * legacy in-flight vink; the sweep just stops calling it going forward). `authorizeMerchant
 * PurchaseCommand`/`settlePurchaseCommand` are dual-path: they detect which shape a given vink
 * is on (`tx.getCardAssignmentForVink` vs. the legacy `tx.getCardByVinkForUpdate`) and branch
 * accordingly — the legacy branch is byte-for-byte unchanged. The card-pool branch adds the
 * actual security payoff D47's wallet-token clarification exists for: authorization is decided
 * against the PRESENTED WALLET TOKEN, not the card's status alone (see
 * `authorizeMerchantPurchaseCommand`'s own comment below) — a stale device holding a
 * since-revoked token from a prior assignment must never authorize against a card now assigned
 * elsewhere.
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
  type CardAssignment,
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
import {
  disableCardCommand,
  enableCardCommand,
  provisionWalletTokenCommand,
  reserveCardFromPoolCommand,
  revokeWalletTokenCommand,
  returnCardToPoolCommand,
  type CardProvisioningCommandContext,
} from './card-pool.ts';
import type { PublicCommandContext } from './ports.ts';
import { applyVinkTransition } from './support/transition.ts';
import { logCommand } from './support/command-logging.ts';

/** Cash-like MCCs are always blocked on the temporary card (§3.2/§36). */
const BLOCKED_MCCS = ['6010', '6011', '6012', '7995'] as const;
const CARD_TTL_DAYS = 3;
/** D47's own spec value ("a separate 10-minute card usage window"). No sweep enforces this
 * yet — the transition it feeds (`CARD_WINDOW_EXPIRED`) is real and tested (RM1), but the
 * sweep that fires it is RM4's job, disclosed there and here, not guessed at early. */
const CARD_USAGE_WINDOW_SECONDS = 600;

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
  /** RM3B (D47) — required on the card-pool path (ignored on the legacy path, which has no
   * concept of a wallet token). This is VinkIn's own §17 engine decision input, never
   * delegated to or validated by the provider (see this file's own module doc comment). */
  presentedWalletToken?: string;
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
  logCommand(ctx.logger, 'provisionCard', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: input.vinkId,
  });
  return outcome.card;
}

// ---------------------------------------------------------------------------
// ProvisionCardFromPoolCommand — RM3B (D47): FUNDED → CARD_READY via RM1/RM2's card pool.
// The live sweep's own trigger going forward; `provisionCardCommand` above stays untouched.
// ---------------------------------------------------------------------------

/**
 * RM3B (D47): reserves, enables, and wallet-provisions a pool card for a FUNDED vink —
 * reusing RM1/RM2's own real, already-tested commands as a *sequence* of independent
 * transactions (not one atomic unit; see this file's own module doc comment and the RM3B
 * milestone report for the disclosed crash-resumability limitation). Owner-confirmed for this
 * slice: wallet-token provisioning is auto-completed here via the mock's synchronous
 * capability, standing in for RM5's real, client-triggered Apple/Google Wallet step.
 */
export async function provisionCardFromPoolCommand(
  ctx: PurchaseCommandContext & CardProvisioningCommandContext,
  input: { vinkId: VinkId },
) {
  const fundedAmountMinor = await ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    if (vink.state !== 'FUNDED') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `card provisioning requires FUNDED (state: ${vink.state})`,
      );
    }
    await applyVinkTransition(
      tx,
      vink,
      'CARD_PROVISIONING_STARTED',
      'system',
      ctx.correlationId,
      ctx.clock.now(),
    );
    return vink.fundedAmount.amountMinor;
  });

  let reservedAssignmentId: CardAssignment['id'] | null = null;
  try {
    const assignment = await reserveCardFromPoolCommand(ctx, {
      vinkId: input.vinkId,
      spendingLimitMinor: fundedAmountMinor,
      usageWindowSeconds: CARD_USAGE_WINDOW_SECONDS,
    });
    reservedAssignmentId = assignment.id;
    const enabled = await enableCardCommand(ctx, { cardAssignmentId: assignment.id });
    // MCC blocking (§3.2/§36): enableCardCommand has no equivalent provider call — done
    // explicitly here, before the wallet token exists, so there is no window where a token
    // could authorize against an MCC-unblocked card.
    const card = await ctx.uow.run(async (tx) => {
      const found = await tx.getCard(enabled.cardId);
      if (found === null) {
        throw new ApplicationError('INVALID_COMMAND', `card ${enabled.cardId} not found`);
      }
      return found;
    });
    await ctx.provider.updateCardControls({
      providerCardId: card.providerCardId,
      blockedMccs: BLOCKED_MCCS,
    });
    const ready = await provisionWalletTokenCommand(ctx, {
      cardAssignmentId: assignment.id,
      // Arbitrary for the mock — RM5's real client flow decides this for real, per device.
      walletType: 'APPLE_PAY',
    });

    await ctx.uow.run(async (tx) => {
      const vink = await tx.getVinkForUpdate(input.vinkId);
      if (vink === null)
        throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
      await applyVinkTransition(
        tx,
        vink,
        'CARD_ISSUED',
        'system',
        ctx.correlationId,
        ctx.clock.now(),
      );
    });
    logCommand(ctx.logger, 'provisionCardFromPool', {
      correlationId: ctx.correlationId,
      actor: 'system',
      vinkId: input.vinkId,
    });
    return ready;
  } catch (error) {
    // Best-effort compensating cleanup so a provisioning failure doesn't permanently strand a
    // pool card at RESERVED — disclosed as best-effort, not guaranteed: if this itself fails,
    // the card stays stuck, needing the same operator-clearing gap RM2 already disclosed for
    // QUARANTINED cards, not built in this slice either.
    if (reservedAssignmentId !== null) {
      try {
        await disableCardCommand(ctx, { cardAssignmentId: reservedAssignmentId });
        await revokeWalletTokenCommand(ctx, { cardAssignmentId: reservedAssignmentId });
        await returnCardToPoolCommand(ctx, { cardAssignmentId: reservedAssignmentId });
      } catch {
        // Swallowed deliberately — the Vink-level reversal below is the load-bearing outcome;
        // a failed compensating cleanup must not prevent it.
      }
    }
    await ctx.uow.run(async (tx) => {
      const vink = await tx.getVinkForUpdate(input.vinkId);
      if (vink === null) return;
      const reversal = await applyVinkTransition(
        tx,
        vink,
        'CARD_PROVISIONING_FAILED',
        'system',
        ctx.correlationId,
        ctx.clock.now(),
      );
      await applyVinkTransition(
        tx,
        reversal,
        'FUNDING_REVERSAL_COMPLETED',
        'system',
        ctx.correlationId,
        ctx.clock.now(),
      );
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ExpireCardWindowCommand — RM4A (D47): CARD_READY → FUNDING_REVERSAL → EXPIRED when the
// 10-minute card usage window elapses with no purchase made.
// ---------------------------------------------------------------------------

/**
 * RM4A (D47): the sweep trigger for RM1's own `CARD_WINDOW_EXPIRED` transition (real and
 * tested since RM1, but never fired by anything until this slice). Chains the identical
 * `CARD_WINDOW_EXPIRED → FUNDING_REVERSAL_COMPLETED` two-step
 * `provisionCardFromPoolCommand`'s own failure branch already uses, then tears the card down
 * back to the pool — it was never spent, so it must become reusable, not permanently stranded
 * assigned (the identical best-effort `disableCardCommand` → `revokeWalletTokenCommand` →
 * `returnCardToPoolCommand` sequence `settlePurchaseCommand` already uses on its own
 * completion path).
 */
export async function expireCardWindowCommand(
  ctx: PurchaseCommandContext & CardProvisioningCommandContext,
  input: { vinkId: VinkId },
): Promise<void> {
  const assignmentId = await ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    if (vink.state !== 'CARD_READY') return null; // already moved on — idempotent no-op
    const assignment = await tx.getCardAssignmentForVink(vink.id);
    if (assignment === null || assignment.status !== 'ACTIVE') return null;
    const now = ctx.clock.now();
    const reversal = await applyVinkTransition(
      tx,
      vink,
      'CARD_WINDOW_EXPIRED',
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
    return assignment.id;
  });
  if (assignmentId === null) return;

  try {
    await disableCardCommand(ctx, { cardAssignmentId: assignmentId });
    await revokeWalletTokenCommand(ctx, { cardAssignmentId: assignmentId });
    await returnCardToPoolCommand(ctx, { cardAssignmentId: assignmentId });
  } catch (error) {
    ctx.logger?.error('expire_card_window_teardown_failed', {
      vinkId: input.vinkId,
      cardAssignmentId: assignmentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  logCommand(ctx.logger, 'expireCardWindow', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: input.vinkId,
  });
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
  const result = await ctx.uow.run(async (tx): Promise<MerchantAuthorizationResult> => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
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

    // RM3B (D47): dual-path detection — a card-pool assignment takes priority; a legacy
    // in-flight vink (no assignment ever created for it) falls back to the untouched
    // temporary_cards path below.
    const assignmentRef = await tx.getCardAssignmentForVink(vink.id);
    if (assignmentRef !== null) {
      const assignment = await tx.getCardAssignmentForUpdate(assignmentRef.id);
      const decline = async (reason: string): Promise<MerchantAuthorizationResult> => {
        const declined: PurchaseAuthorization = {
          id: newPurchaseAuthorizationId(),
          vinkId: vink.id,
          temporaryCardId: null,
          cardAssignmentId: assignment?.id ?? assignmentRef.id,
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

      // §17 decision, card-pool path, in order: assignment ready → PRESENTED WALLET TOKEN
      // matches → merchant lock → spend limit. The token check is the actual security payoff
      // D47's wallet-token clarification exists for: a stale device holding a since-revoked
      // token from a PRIOR assignment must never authorize against this card now assigned
      // here, even though the underlying card itself is still enabled at the provider.
      if (
        assignment === null ||
        assignment.status !== 'ACTIVE' ||
        assignment.provisioningStatus !== 'READY_TO_PAY'
      ) {
        return decline('CARD_NOT_READY');
      }
      if (vink.state !== 'CARD_READY') return decline('CARD_NOT_READY');
      const token = await tx.getCardWalletTokenForAssignment(assignment.id);
      if (
        token === null ||
        token.status !== 'PROVISIONED' ||
        input.presentedWalletToken === undefined ||
        token.providerTokenId !== input.presentedWalletToken
      ) {
        return decline('WALLET_TOKEN_MISMATCH');
      }
      if (
        assignment.merchantLockKey !== null &&
        assignment.merchantLockKey !== input.merchantIdentifier
      ) {
        return decline('MERCHANT_LOCKED');
      }
      if (compareMoney(amount, assignment.spendingLimit) > 0) return decline('OVER_LIMIT');

      const approved: PurchaseAuthorization = {
        id: newPurchaseAuthorizationId(),
        vinkId: vink.id,
        temporaryCardId: null,
        cardAssignmentId: assignment.id,
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
      // First-merchant lock: bind the assignment to this merchant in the same transaction.
      await tx.updateCardAssignment({ ...assignment, merchantLockKey: input.merchantIdentifier });
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
    }

    // Legacy path — byte-for-byte unchanged from pre-RM3B behavior.
    const card = await tx.getCardByVinkForUpdate(vink.id);
    const decline = async (reason: string): Promise<MerchantAuthorizationResult> => {
      const declined: PurchaseAuthorization = {
        id: newPurchaseAuthorizationId(),
        vinkId: vink.id,
        temporaryCardId: card?.id ?? newTemporaryCardId(),
        cardAssignmentId: null,
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
      cardAssignmentId: null,
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
  ctx.metrics?.recordAuthorizationOutcome(result.outcome);
  logCommand(ctx.logger, 'authorizeMerchantPurchase', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: input.vinkId,
    outcome: result.outcome,
    providerAuthorizationId: input.providerAuthorizationId,
  });
  return result;
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
    logCommand(ctx.logger, 'reverseAuthorization', {
      correlationId: ctx.correlationId,
      actor: 'system',
      vinkId: vink.id,
      authorizationId: input.authorizationId,
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
  ctx: PurchaseCommandContext & CardProvisioningCommandContext,
  input: { vinkId: VinkId; authorizationId: string; settledAmountMinor: number },
): Promise<SettlementResult> {
  const result = await ctx.uow.run(async (tx) => {
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
    // RM3B (D47): dual-path — a card-pool assignment (if any) takes priority; the legacy
    // temporary_cards lookup stays untouched for a legacy in-flight vink.
    const assignment = await tx.getCardAssignmentForVink(vink.id);
    const card = assignment === null ? await tx.getCardByVinkForUpdate(vink.id) : null;
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
      return { settlement, vinkState: flagged.state, teardownAssignmentId: null };
    }

    // MATCHED / UNDERAGE complete the purchase. Legacy path: close the mock card inline, same
    // as always. Card-pool path: the actual teardown (disable/revoke/return) is a sequence of
    // RM1/RM2's own independent transactions — it cannot run nested inside this one (same
    // reasoning as `provisionCardFromPoolCommand`'s own module comment) — so it happens AFTER
    // this transaction commits; only the assignment id to tear down is carried out of here.
    if (assignment === null && card !== null) {
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
    return {
      settlement,
      vinkState: completed.state,
      teardownAssignmentId: assignment?.id ?? null,
    };
  });

  // RM3B (D47): the card-pool teardown — returning the card to the pool is the entire point
  // of a reusable 15-card pool. Best-effort: a failure here does not unwind the already-
  // committed settlement (the purchase genuinely completed); the assignment is left assigned,
  // needing the same disclosed operator-clearing gap as RM2's own QUARANTINED cards and
  // `provisionCardFromPoolCommand`'s own compensating cleanup — no sweep-driven retry built in
  // this slice.
  if (result.teardownAssignmentId !== null) {
    try {
      await disableCardCommand(ctx, { cardAssignmentId: result.teardownAssignmentId });
      await revokeWalletTokenCommand(ctx, { cardAssignmentId: result.teardownAssignmentId });
      await returnCardToPoolCommand(ctx, { cardAssignmentId: result.teardownAssignmentId });
    } catch (error) {
      ctx.logger?.error('settle_purchase_teardown_failed', {
        vinkId: input.vinkId,
        cardAssignmentId: result.teardownAssignmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logCommand(ctx.logger, 'settlePurchase', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: input.vinkId,
    authorizationId: input.authorizationId,
    settlementStatus: result.settlement.status,
  });
  return { settlement: result.settlement, vinkState: result.vinkState };
}
