/**
 * Slice I4 (D19/D27) — automatic invitation delivery, member path; Slice I4B (D38) extends
 * it to guests.
 *
 * MEMBERS: a member participant's contact info lives on their own `users` row (captured once,
 * at registration) and the invite is a plain, non-secret "open the app" link — nothing here
 * is ever secret, so dispatch can safely be deferred to a later moment (batched at
 * `VINK_OPENED`) or retried, with no security concern. `dispatchMemberInvitation`/
 * `dispatchMemberInvitationsOnOpen` below call `ctx.delivery.provider.send()` directly since
 * there is no secret in scope to protect.
 *
 * GUESTS ARE DELIBERATELY NOT FULLY HANDLED HERE — only the two narrow, secret-free
 * primitives (`claimGuestDeliverySlot`/`recordGuestInvitationDeliveryResult`) live in this
 * file. A guest's join link contains the raw guest token, minted once by the transport
 * (`newGuestToken()`, `apps/api/src/modules/vinks/routes.ts`) — the application layer only
 * ever sees its hash (D14, hard rule), so the actual `provider.send()` call for a guest (the
 * one step that needs the plaintext URL) has to happen in the transport, not here. This file
 * only offers the transport two atomic, hash-only building blocks: "claim the right to
 * dispatch this guest" (before minting is wasted on a losing race) and "record what
 * happened" (after the transport's own `provider.send()` call returns) — see
 * `dispatchGuestInvitation` in `apps/api/src/modules/vinks/routes.ts` for how the transport
 * sequences these around its own token mint + provider call.
 */

import type { DeliveryProvider } from '../../delivery/src/index.ts';
import type { GuestIdentityId, Participant, Vink } from '../../domain/src/index.ts';
import type { CommandContext, InvitationDeliveryInput, VinkTx } from './ports.ts';

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
      // Slice I5B (D39): the real, organizer-written purpose once one exists, falling back
      // to the raw category for every Vink that doesn't have one (pre-I5B, or the five-step
      // wizard) — never a broken/empty message for those.
      purpose: vink.purpose ?? vink.purchaseCategory,
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

/**
 * Slice I4B (D38) — the transport-facing claim primitive. Never sees the raw token, only its
 * hash: `tx.claimGuestDeliveryToken` sets it via a conditional `WHERE access_token_hash IS
 * NULL` update and reports whether this call won. The transport must call this BEFORE
 * calling `provider.send()` — a lost claim means someone else already dispatched (or is
 * dispatching) this guest, so the freshly-minted-but-unclaimed token is simply discarded,
 * never sent anywhere.
 */
export async function claimGuestDeliverySlot(
  ctx: CommandContext,
  guestIdentityId: GuestIdentityId,
  tokenHash: string,
  expiresAt: string,
): Promise<boolean> {
  return ctx.uow.run((tx) => tx.claimGuestDeliveryToken(guestIdentityId, tokenHash, expiresAt));
}

/**
 * Slice I4B (D38) — records a guest dispatch attempt the transport already carried out
 * (`provider.send()`, called with the plaintext URL this file never touches). Same audit
 * shape and same locked rule as the member path (`insertInvitationDelivery`, Phase 5 §2): a
 * failed send is recorded, never thrown, never blocks anything else.
 */
export async function recordGuestInvitationDeliveryResult(
  ctx: CommandContext,
  input: InvitationDeliveryInput,
): Promise<void> {
  await ctx.uow.run((tx) => tx.insertInvitationDelivery(input));
}
