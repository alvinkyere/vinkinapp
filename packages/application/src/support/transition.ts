/**
 * THE single write path for a vink state change (D12/D13): domain decides `{to, emits}`,
 * then — inside the caller's unit of work — the aggregate row, the history row, and the
 * outbox event are written together. No other code may mutate `vink.state`.
 */

import { transitionVink, type Vink, type VinkEvent } from '../../../domain/src/index.ts';
import type { VinkTx } from '../ports.ts';

export async function applyVinkTransition(
  tx: VinkTx,
  vink: Vink,
  event: VinkEvent,
  actor: string,
  correlationId: string,
  now: Date,
): Promise<Vink> {
  const { to, emits } = transitionVink(vink.state, event);
  const updated: Vink = {
    ...vink,
    state: to,
    version: vink.version + 1,
    updatedAt: now.toISOString(),
  };
  await tx.updateVink(updated);
  await tx.appendHistory({
    vinkId: vink.id,
    fromState: vink.state,
    event,
    toState: to,
    actor,
    correlationId,
  });
  await tx.insertOutbox({
    eventType: emits,
    aggregateType: 'vink',
    aggregateId: vink.id,
    payload: { vinkId: vink.id, from: vink.state, to, event },
  });
  return updated;
}
