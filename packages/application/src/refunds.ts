/**
 * Failed-session refunds (PV7, journeys E2 post-capture / E8). When a FUNDED vink fails
 * after capture (card provisioning reversal → EXPIRED), the captured contributions are
 * refunded and the ledger reverses the capture + funding move (corrections are reversals).
 *
 * A provider refund failure is not swallowed: the contribution reaches REFUND_FAILED — an
 * explicit, observable state the retry-refund job (and the ops console) act on (E8).
 * D12/D13 throughout; the vink stays EXPIRED (contribution-level cleanup, doc 03).
 */

import {
  operationId,
  ProviderError,
  type FinancialProvider,
} from '../../payment-provider/src/index.ts';
import { contributionRefundPosting } from '../../ledger/src/index.ts';
import type { Contribution, ContributionId, VinkId } from '../../domain/src/index.ts';
import { ApplicationError } from './errors.ts';
import type { PublicCommandContext, VinkTx } from './ports.ts';
import { applyContributionTransition } from './support/contribution-transition.ts';

export interface RefundCommandContext extends PublicCommandContext {
  provider: FinancialProvider;
}

async function refundOne(
  tx: VinkTx,
  ctx: RefundCommandContext,
  contribution: Contribution,
  fromRetry: boolean,
  now: Date,
): Promise<Contribution> {
  const amount = contribution.capturedAmount;
  if (amount === null)
    throw new ApplicationError('INVALID_COMMAND', 'contribution has nothing captured to refund');

  let current = fromRetry
    ? await applyContributionTransition(
        tx,
        contribution,
        'REFUND_RETRIED',
        'refund',
        ctx.correlationId,
        now,
      )
    : await applyContributionTransition(
        tx,
        contribution,
        'REFUND_REQUIRED',
        'refund',
        ctx.correlationId,
        now,
      );
  try {
    await ctx.provider.refundContribution({
      idempotencyKey: operationId.refund(contribution.id),
      providerPaymentId: contribution.providerReference ?? '',
      amount,
      reason: 'VINK_FAILED',
    });
  } catch (error) {
    if (error instanceof ProviderError && error.retryable) {
      return applyContributionTransition(
        tx,
        current,
        'REFUND_FAILED',
        'refund',
        ctx.correlationId,
        now,
      );
    }
    throw error;
  }
  current = await applyContributionTransition(
    tx,
    current,
    'REFUND_SUCCEEDED',
    'refund',
    ctx.correlationId,
    now,
    { refundedAmount: amount },
  );
  await tx.insertLedgerPosting({
    referenceType: 'contribution',
    referenceId: contribution.id,
    entries: contributionRefundPosting(amount).entries,
  });
  return current;
}

export interface RefundSummary {
  refunded: number;
  failed: number;
}

/** Refund every captured contribution of a failed (EXPIRED) vink. */
export async function refundFailedSessionCommand(
  ctx: RefundCommandContext,
  input: { vinkId: VinkId },
): Promise<RefundSummary> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    if (vink.state !== 'EXPIRED') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `refunds run on a failed (EXPIRED) vink (state: ${vink.state})`,
      );
    }
    const contributions = await tx.listContributionsForUpdate(vink.id);
    const now = ctx.clock.now();
    const summary: RefundSummary = { refunded: 0, failed: 0 };
    for (const contribution of contributions) {
      if (contribution.status !== 'CAPTURED') continue;
      const result = await refundOne(tx, ctx, contribution, false, now);
      if (result.status === 'REFUNDED') summary.refunded += 1;
      else summary.failed += 1;
    }
    return summary;
  });
}

/** retry-refund job body: a single REFUND_FAILED contribution (E8). */
export async function retryRefundCommand(
  ctx: RefundCommandContext,
  input: { vinkId: VinkId; contributionId: ContributionId },
): Promise<Contribution> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    const contributions = await tx.listContributionsForUpdate(vink.id);
    const contribution = contributions.find((row) => row.id === input.contributionId);
    if (contribution === undefined) {
      throw new ApplicationError(
        'PARTICIPANT_NOT_FOUND',
        `contribution ${input.contributionId} not found`,
      );
    }
    if (contribution.status !== 'REFUND_FAILED') return contribution; // idempotent no-op
    const now = ctx.clock.now();
    return refundOne(tx, ctx, contribution, true, now);
  });
}
