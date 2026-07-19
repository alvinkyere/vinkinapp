/**
 * Organizer recovery engine (PV7, journey E7 second half; Spec §23). A settlement overage
 * leaves the vink in RECOVERY_REQUIRED (PV6). Here the platform books the receivable it
 * fronted and charges the ORGANIZER off-session — participants are never recharged (§4.7).
 *
 * The charge reuses the neutral authorize+capture primitive against the organizer's own
 * payment method (the mock's `offSessionRecovery` capability). D5/D12/D13 throughout: vink
 * row locked first, one unit of work, domain-decided transitions + outbox events, the DB's
 * balanced/append-only ledger triggers as the final guard.
 */

import {
  compareMoney,
  money,
  newRecoveryObligationId,
  type RecoveryObligation,
  type Vink,
  type VinkId,
} from '../../domain/src/index.ts';
import { operationId, type FinancialProvider } from '../../payment-provider/src/index.ts';
import {
  recoveryChargePosting,
  recoveryReceivablePosting,
  recoveryWriteoffPosting,
} from '../../ledger/src/index.ts';
import { ApplicationError } from './errors.ts';
import type { PublicCommandContext, VinkTx } from './ports.ts';
import { applyVinkTransition } from './support/transition.ts';

/** Retry ladder: default after this many failed charge attempts (§23). */
export const RECOVERY_MAX_ATTEMPTS = 3;
const RECOVERY_DUE_DAYS = 1;

export type RecoveryScenario = 'SUCCESS' | 'DECLINE';
const RECOVERY_TOKEN: Record<RecoveryScenario, string> = {
  SUCCESS: 'tok_ok',
  DECLINE: 'tok_decline',
};

export interface RecoveryCommandContext extends PublicCommandContext {
  provider: FinancialProvider;
}

export type RecoveryOutcome = 'RESOLVED' | 'RETRY_SCHEDULED' | 'DEFAULTED';

export interface RecoveryResult {
  obligation: RecoveryObligation;
  outcome: RecoveryOutcome;
  vinkState: Vink['state'];
}

/** Charge the organizer off-session for `amount`. Returns true on capture, false on decline. */
async function chargeOrganizer(
  provider: FinancialProvider,
  vink: Vink,
  amountMinor: number,
  attempt: number,
  scenario: RecoveryScenario,
): Promise<boolean> {
  const externalId = `recovery:${vink.id}`;
  const { providerCustomerId } = await provider.createCustomer({
    idempotencyKey: `recovery-customer:v1:${vink.id}`,
    externalUserId: vink.organizerUserId,
  });
  const { providerMethodId } = await provider.setupPaymentMethod({
    idempotencyKey: `recovery-method:v1:${vink.id}:${scenario}`,
    providerCustomerId,
    methodToken: RECOVERY_TOKEN[scenario],
    usage: 'RECOVERY',
  });
  const authorization = await provider.authorizeContribution({
    idempotencyKey: operationId.authorize(externalId, attempt),
    providerCustomerId,
    providerMethodId,
    amount: money(amountMinor),
    captureMode: 'MANUAL',
    metadata: { vinkId: vink.id, kind: 'recovery' },
  });
  if (authorization.status !== 'AUTHORIZED') return false;
  await provider.captureContribution({
    idempotencyKey: operationId.capture(externalId, attempt),
    providerPaymentId: authorization.providerPaymentId,
    amount: money(amountMinor),
  });
  return true;
}

async function applyChargeResult(
  tx: VinkTx,
  ctx: RecoveryCommandContext,
  vink: Vink,
  obligation: RecoveryObligation,
  charged: boolean,
  now: Date,
): Promise<RecoveryResult> {
  if (charged) {
    const resolved: RecoveryObligation = {
      ...obligation,
      status: 'RESOLVED',
      resolvedAt: now.toISOString(),
    };
    await tx.updateRecoveryObligation(resolved);
    await tx.insertLedgerPosting({
      referenceType: 'vink',
      referenceId: vink.id,
      entries: recoveryChargePosting(obligation.amount).entries,
    });
    const completed = await applyVinkTransition(
      tx,
      vink,
      'RECOVERY_RESOLVED',
      'recovery',
      ctx.correlationId,
      now,
    );
    return { obligation: resolved, outcome: 'RESOLVED', vinkState: completed.state };
  }
  if (obligation.attemptCount >= RECOVERY_MAX_ATTEMPTS) {
    const defaulted: RecoveryObligation = {
      ...obligation,
      status: 'DEFAULTED',
      resolvedAt: now.toISOString(),
    };
    await tx.updateRecoveryObligation(defaulted);
    await tx.insertLedgerPosting({
      referenceType: 'vink',
      referenceId: vink.id,
      entries: recoveryWriteoffPosting(obligation.amount).entries,
    });
    const restricted = await applyVinkTransition(
      tx,
      vink,
      'RECOVERY_DEFAULTED',
      'recovery',
      ctx.correlationId,
      now,
    );
    return { obligation: defaulted, outcome: 'DEFAULTED', vinkState: restricted.state };
  }
  await tx.updateRecoveryObligation(obligation); // attemptCount already incremented
  await tx.insertOutbox({
    eventType: 'RecoveryObligationCreated',
    aggregateType: 'vink',
    aggregateId: vink.id,
    payload: {
      vinkId: vink.id,
      obligationId: obligation.id,
      retryScheduled: true,
      attempt: obligation.attemptCount,
    },
  });
  return { obligation, outcome: 'RETRY_SCHEDULED', vinkState: vink.state };
}

// ---------------------------------------------------------------------------
// StartRecoveryCommand — RECOVERY_REQUIRED → obligation + first charge
// ---------------------------------------------------------------------------

export async function startRecoveryCommand(
  ctx: RecoveryCommandContext,
  input: { vinkId: VinkId; scenario?: RecoveryScenario },
): Promise<RecoveryResult> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    if (vink.state !== 'RECOVERY_REQUIRED') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `recovery requires RECOVERY_REQUIRED (state: ${vink.state})`,
      );
    }
    const settlements = await tx.listSettlementsForUpdate(vink.id);
    const overage = settlements.find((row) => row.status === 'OVERAGE');
    if (overage === undefined || compareMoney(overage.varianceAmount, money(0)) === 0) {
      throw new ApplicationError('INVALID_COMMAND', 'no settlement overage to recover');
    }
    const now = ctx.clock.now();
    const obligation: RecoveryObligation = {
      id: newRecoveryObligationId(),
      vinkId: vink.id,
      organizerUserId: vink.organizerUserId,
      amount: overage.varianceAmount,
      reason: 'SETTLEMENT_OVERAGE',
      status: 'PENDING',
      attemptCount: 1,
      dueAt: new Date(now.getTime() + RECOVERY_DUE_DAYS * 86_400_000).toISOString(),
      resolvedAt: null,
      createdAt: now.toISOString(),
    };
    await tx.insertRecoveryObligation(obligation);
    // Book the receivable the platform fronted to the merchant.
    await tx.insertLedgerPosting({
      referenceType: 'vink',
      referenceId: vink.id,
      entries: recoveryReceivablePosting(overage.varianceAmount).entries,
    });
    const pending = await applyVinkTransition(
      tx,
      vink,
      'RECOVERY_STARTED',
      'recovery',
      ctx.correlationId,
      now,
    );
    await tx.insertOutbox({
      eventType: 'RecoveryObligationCreated',
      aggregateType: 'vink',
      aggregateId: vink.id,
      payload: {
        vinkId: vink.id,
        obligationId: obligation.id,
        amountMinor: obligation.amount.amountMinor,
      },
    });

    const charged = await chargeOrganizer(
      ctx.provider,
      pending,
      obligation.amount.amountMinor,
      1,
      input.scenario ?? 'SUCCESS',
    );
    return applyChargeResult(tx, ctx, pending, obligation, charged, now);
  });
}

// ---------------------------------------------------------------------------
// RetryRecoveryCommand — retry-recovery job body (§23 ladder)
// ---------------------------------------------------------------------------

export async function retryRecoveryCommand(
  ctx: RecoveryCommandContext,
  input: { vinkId: VinkId; scenario?: RecoveryScenario },
): Promise<RecoveryResult> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    if (vink.state !== 'RECOVERY_PENDING') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `retry requires RECOVERY_PENDING (state: ${vink.state})`,
      );
    }
    const obligations = await tx.listRecoveryObligationsForUpdate(vink.id);
    const pending = obligations.find((row) => row.status === 'PENDING');
    if (pending === undefined)
      throw new ApplicationError('PARTICIPANT_NOT_FOUND', 'no pending recovery obligation');
    const now = ctx.clock.now();
    const attempted: RecoveryObligation = { ...pending, attemptCount: pending.attemptCount + 1 };
    const charged = await chargeOrganizer(
      ctx.provider,
      vink,
      attempted.amount.amountMinor,
      attempted.attemptCount,
      input.scenario ?? 'SUCCESS',
    );
    return applyChargeResult(tx, ctx, vink, attempted, charged, now);
  });
}
