import type { Vink } from '../../../domain/src/index.ts';
import { ApplicationError } from '../errors.ts';
import type { VinkTx } from '../ports.ts';
import type { VinkId } from '../../../domain/src/index.ts';

/** Loads the row-locked vink, enforcing existence, ownership, and optimistic version. */
export async function loadOwnedVink(
  tx: VinkTx,
  vinkId: VinkId,
  actorUserId: string,
  expectedVersion?: number,
): Promise<Vink> {
  const vink = await tx.getVinkForUpdate(vinkId);
  if (vink === null) throw new ApplicationError('VINK_NOT_FOUND', `vink ${vinkId} not found`);
  if (vink.organizerUserId !== actorUserId) {
    throw new ApplicationError('FORBIDDEN', 'only the organizer may manage this vink');
  }
  if (expectedVersion !== undefined && vink.version !== expectedVersion) {
    throw new ApplicationError(
      'VINK_VERSION_CONFLICT',
      `expected version ${expectedVersion}, current is ${vink.version}`,
    );
  }
  return vink;
}
