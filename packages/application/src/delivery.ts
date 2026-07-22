/**
 * Slice I4 (D19/D27) — automatic invitation delivery, member path only.
 *
 * MEMBERS ONLY: a member participant's contact info lives on their own `users` row
 * (captured once, at registration) and the invite is a plain, non-secret "open the app" link
 * — nothing here is ever secret, so dispatch can safely be deferred to a later moment
 * (batched at `VINK_OPENED`) or retried, with no security concern.
 *
 * GUESTS ARE DELIBERATELY NOT HANDLED HERE. A guest's join link contains the raw guest
 * token, minted once by the transport (`newGuestToken()`,
 * `apps/api/src/modules/vinks/routes.ts`) — the application layer only ever sees its hash
 * (D14, hard rule). Automatic guest-invite dispatch can only happen in the same transport
 * request that mints the token, and is deferred (not built this pass — flagged in the I4
 * milestone report) because that route file was under active, unrelated concurrent edit for
 * this entire pass. `inviteGuestCommand` (`guest.ts`) still captures and stores the contact
 * destination now, so the transport-layer dispatch call site has something to read once it's
 * safe to wire it in.
 */

import type { DeliveryProvider } from '../../delivery/src/index.ts';
import type { Participant, Vink } from '../../domain/src/index.ts';
import type { CommandContext, VinkTx } from './ports.ts';

export interface DeliveryCommandContext extends CommandContext {
  /** Omitted (as almost every existing caller/test does) is equivalent to `enabled: false`
   * — dispatch is always a no-op unless BOTH a provider is threaded in AND this is true.
   * Mirrors `automatic_invitation_delivery`'s own flag discipline (default off; §4/§11:
   * never enabled outside `development`/`test` until a real provider is selected). */
  delivery?: {
    provider: DeliveryProvider;
    enabled: boolean;
  };
}

async function resolveMemberDestination(
  tx: VinkTx,
  userId: string,
): Promise<{ destination: string; method: 'EMAIL' | 'SMS' } | null> {
  const info = await tx.getUserContactInfo(userId);
  if (info === null) return null;
  if (info.email !== null) return { destination: info.email, method: 'EMAIL' };
  if (info.phone !== null) return { destination: info.phone, method: 'SMS' };
  return null;
}

/**
 * Attempts to send one member participant their automatic invitation. Never throws on a
 * provider-side rejection or a missing contact destination — manual sharing is always the
 * fallback (Phase 5 §2's locked rule: a delivery failure never blocks or misrepresents the
 * caller's own already-committed state). A no-op for a guest (`participant.userId === null`)
 * or when `ctx.delivery` is absent/disabled.
 */
export async function dispatchMemberInvitation(
  ctx: DeliveryCommandContext,
  tx: VinkTx,
  vink: Vink,
  participant: Participant,
  organizerDisplayName: string,
): Promise<void> {
  if (ctx.delivery?.enabled !== true) return;
  if (participant.userId === null) return;

  const destination = await resolveMemberDestination(tx, participant.userId);
  if (destination === null) return;

  const result = await ctx.delivery.provider.send({
    destination: destination.destination,
    method: destination.method,
    template: {
      kind: 'member_invite',
      organizerName: organizerDisplayName,
      purpose: vink.purchaseCategory,
      yourShareMinor: participant.allocatedAmount.amountMinor,
      deadline: vink.submissionDeadline,
    },
  });

  await tx.insertInvitationDelivery({
    participantId: participant.id,
    status: result.accepted ? 'SENT' : 'FAILED',
    method: destination.method,
    destination: destination.destination,
    ...(result.providerMessageId !== undefined && { providerMessageId: result.providerMessageId }),
    ...(result.failureReason !== undefined && { failureReason: result.failureReason }),
  });
}

/** Batch variant for `openVinkCommand` — every active member participant besides the
 * organizer (the organizer doesn't invite themselves). One failure never stops the rest
 * (Phase 5 §2) — each dispatch is independently attempted and independently recorded. */
export async function dispatchMemberInvitationsOnOpen(
  ctx: DeliveryCommandContext,
  tx: VinkTx,
  vink: Vink,
  participants: Participant[],
): Promise<void> {
  if (ctx.delivery?.enabled !== true) return;
  const organizer = participants.find((participant) => participant.role === 'ORGANIZER');
  if (organizer === undefined) return;
  const members = participants.filter(
    (participant) => participant.role === 'MEMBER' && participant.status !== 'REMOVED',
  );
  for (const member of members) {
    await dispatchMemberInvitation(ctx, tx, vink, member, organizer.displayName);
  }
}
