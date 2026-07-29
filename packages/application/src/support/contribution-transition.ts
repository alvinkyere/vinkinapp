/**
 * THE single write path for a contribution status change (D12/D13), mirroring
 * `applyVinkTransition`: the domain decides `{to, emits}`, then the row, its history, and
 * the outbox event are written together in the caller's unit of work.
 */

import {
  transitionContribution,
  type Contribution,
  type ContributionEvent,
} from '../../../domain/src/index.ts';
import type { VinkTx } from '../ports.ts';

export async function applyContributionTransition(
  tx: VinkTx,
  contribution: Contribution,
  event: ContributionEvent,
  actor: string,
  correlationId: string,
  now: Date,
  patch: Partial<
    Pick<
      Contribution,
      'authorizedAmount' | 'capturedAmount' | 'refundedAmount' | 'providerReference'
    >
  > = {},
): Promise<Contribution> {
  const { to, emits } = transitionContribution(contribution.status, event);
  const updated: Contribution = {
    ...contribution,
    ...patch,
    status: to,
    updatedAt: now.toISOString(),
  };
  await tx.updateContribution(updated);
  await tx.appendContributionHistory({
    contributionId: contribution.id,
    fromStatus: contribution.status,
    event,
    toStatus: to,
    actor,
    correlationId,
    // ENG7 — whatever the contribution's own providerReference is AFTER this patch (the same
    // value the just-updated row now carries), not before — this is what the roadmap's own
    // audit-trail field template asks for at each transition.
    providerReference: updated.providerReference,
  });
  await tx.insertOutbox({
    eventType: emits,
    aggregateType: 'vink',
    aggregateId: contribution.vinkId,
    payload: {
      vinkId: contribution.vinkId,
      contributionId: contribution.id,
      participantId: contribution.participantId,
      from: contribution.status,
      to,
      event,
    },
  });
  return updated;
}
