/**
 * RM1/RM2 (D47) — the reusable card pool. Deliberately scoped narrowly and additively:
 * these commands manage the pool's own reserve/enable/provision/disable/revoke/return
 * mechanics only. They do NOT drive the Vink's own state transitions (FUNDED →
 * CARD_PROVISIONING → CARD_READY) or the capture-timing funding-engine change — that wiring
 * is RM3's job, once the live FUNDED-Vink flow actually cuts over to this schema. This slice
 * proves the pool + provider-boundary mechanics are correct in isolation first, same
 * "code-complete, not yet wired into the live path" precedent as ENG8's `vinkin_app` role and
 * ENG6 Slice 4's webhook ingestion (built before Slice 5's reconciliation processor read it).
 *
 * The security property `returnCardToPoolCommand` exists to guarantee (D47, owner-clarified):
 * a card is only returnable to the pool — and therefore only reassignable to a different
 * Vink — once its assignment's wallet token is confirmed REVOKED. Without this, a stale
 * device from a prior assignment could still authorize against a card now assigned elsewhere.
 * RM2's own commands (`disableCardCommand` → `revokeWalletTokenCommand`) are the real path
 * that gets an assignment to that state; `returnCardToPoolCommand`'s own gate (checking the
 * wallet token table directly) is UNCHANGED from RM1 — a deliberate choice to avoid breaking
 * RM1's own proven tests, not an oversight (see the RM2 milestone report).
 *
 * RM2's `provisioning_status` sub-machine (RESERVED → ENABLING → AWAITING_WALLET_
 * PROVISIONING → READY_TO_PAY, and DISABLING → TOKEN_REVOCATION_PENDING → SANITIZED) is
 * layered tracking, not a second enforced gate on return — see migration 0025's own header
 * comment. Every command here is idempotent (a call that finds the assignment already past
 * its target state is a safe no-op, never a duplicate provider call) and quarantines the
 * underlying pool card (never returns it to AVAILABLE) on a genuinely ambiguous provider
 * outcome (`ProviderError` with `code === 'UNKNOWN_OUTCOME'`) — the invariant "provider
 * failures leave the card RESERVED or QUARANTINED, never AVAILABLE by accident."
 */

import {
  idempotencyKey,
  money,
  newCardAssignmentId,
  newCardWalletTokenId,
  type Card,
  type CardAssignment,
  type VinkId,
} from '../../domain/src/index.ts';
import { ProviderError, type FinancialProvider } from '../../payment-provider/src/index.ts';
import { ApplicationError } from './errors.ts';
import type { PublicCommandContext, VinkTx } from './ports.ts';
import { logCommand } from './support/command-logging.ts';

/** RM1's own two commands (`reserveCardFromPoolCommand`/`returnCardToPoolCommand`) never call
 * the provider — kept provider-free so RM1's own existing tests, which construct this context
 * without one, are unaffected. */
export type CardPoolCommandContext = PublicCommandContext;

/** RM2's four provider-calling commands need the provider; a separate, stricter context type
 * (matching `PurchaseCommandContext extends PublicCommandContext { provider }`'s own
 * established pattern) rather than making `CardPoolCommandContext` require one everywhere. */
export interface CardProvisioningCommandContext extends CardPoolCommandContext {
  provider: FinancialProvider;
}

export interface ReserveCardInput {
  vinkId: VinkId;
  spendingLimitMinor: number;
  merchantLockKey?: string | null;
  usageWindowSeconds: number;
}

export async function reserveCardFromPoolCommand(
  ctx: CardPoolCommandContext,
  input: ReserveCardInput,
): Promise<CardAssignment> {
  const assignment = await ctx.uow.run(async (tx): Promise<CardAssignment> => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null) {
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    }
    // The UNIQUE(vink_id) constraint on card_assignments (migration 0024) is the final guard
    // — this is the application-layer optimization ahead of it, per the hard rule.
    const existing = await tx.getCardAssignmentForVink(vink.id);
    if (existing !== null) {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `vink ${vink.id} already has a card assignment`,
      );
    }
    const card = await tx.reserveAvailableCard();
    if (card === null) {
      throw new ApplicationError('CARD_POOL_EXHAUSTED', 'no available card in the pool');
    }
    const now = ctx.clock.now();
    const newAssignment: CardAssignment = {
      id: newCardAssignmentId(),
      cardId: card.id,
      vinkId: vink.id,
      status: 'ACTIVE',
      provisioningStatus: 'RESERVED',
      spendingLimit: money(input.spendingLimitMinor),
      merchantLockKey: input.merchantLockKey ?? null,
      reservedAt: now.toISOString(),
      usageWindowExpiresAt: new Date(now.getTime() + input.usageWindowSeconds * 1000).toISOString(),
      returnedAt: null,
    };
    await tx.insertCardAssignment(newAssignment);
    return newAssignment;
  });
  logCommand(ctx.logger, 'reserveCardFromPool', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: input.vinkId,
  });
  return assignment;
}

export interface ReturnCardInput {
  cardAssignmentId: CardAssignment['id'];
}

export async function returnCardToPoolCommand(
  ctx: CardPoolCommandContext,
  input: ReturnCardInput,
): Promise<CardAssignment> {
  const assignment = await ctx.uow.run(async (tx): Promise<CardAssignment> => {
    const existing = await tx.getCardAssignmentForUpdate(input.cardAssignmentId);
    if (existing === null) {
      throw new ApplicationError(
        'CARD_ASSIGNMENT_NOT_FOUND',
        `card assignment ${input.cardAssignmentId} not found`,
      );
    }
    if (existing.status === 'RETURNED') {
      // Idempotent: a retried return-to-pool call is a no-op, not an error — matches this
      // codebase's own "replay, don't re-execute" convention throughout the command layer.
      return existing;
    }
    // The load-bearing security check (D47): a stale device from a prior assignment must
    // never be able to authorize against a card now assigned elsewhere, so the card cannot
    // become AVAILABLE again until its wallet token is confirmed REVOKED. No token row at
    // all (RM1 predates RM5's real provisioning) is treated the same as "not yet revoked" —
    // fail closed, never assume a missing row means nothing to revoke.
    const token = await tx.getCardWalletTokenForAssignment(existing.id);
    if (token === null || token.status !== 'REVOKED') {
      throw new ApplicationError(
        'WALLET_TOKEN_NOT_REVOKED',
        `card assignment ${existing.id} cannot return to the pool before its wallet token is revoked`,
      );
    }
    const now = ctx.clock.now();
    const returned: CardAssignment = {
      ...existing,
      status: 'RETURNED',
      returnedAt: now.toISOString(),
    };
    await tx.updateCardAssignment(returned);
    await tx.releaseCardToPool(existing.cardId);
    return returned;
  });
  logCommand(ctx.logger, 'returnCardToPool', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: assignment.vinkId,
  });
  return assignment;
}

// ---------------------------------------------------------------------------
// RM2 (D47) — provider-boundary lifecycle: enable -> provision wallet token -> (spend) ->
// disable -> revoke wallet token. See this file's own top-of-file doc comment for the
// provisioning_status sub-machine and the quarantine-on-ambiguous-outcome invariant.
// ---------------------------------------------------------------------------

async function requireCard(tx: VinkTx, cardId: CardAssignment['cardId']): Promise<Card> {
  const card = await tx.getCard(cardId);
  if (card === null) throw new ApplicationError('INVALID_COMMAND', `card ${cardId} not found`);
  return card;
}

/** Deliberately a RETURNED outcome, never a throw from inside `callProviderOrQuarantine`
 * itself: throwing from within `ctx.uow.run(...)` rolls back the WHOLE transaction (a real
 * bug this file's own live-Postgres integration test caught — the exact same class of defect
 * as PV3's reuse-detection rollback issue, see `purchases.ts`'s own header comment), which
 * would silently undo the `quarantineCard` write this helper exists to make durable. Every
 * RM2 command checks this outcome AFTER `uow.run` has committed, and only then re-throws. */
type ProviderCallOutcome<T> = { kind: 'OK'; value: T } | { kind: 'ERROR'; error: unknown };

/** Every RM2 command that touches the provider funnels through this: on a genuinely ambiguous
 * outcome (`UNKNOWN_OUTCOME` — the provider itself cannot say whether the side effect
 * happened), the underlying pool card is quarantined (durably, since this write is part of
 * the same still-open transaction as the rest of the command) before the error is returned,
 * so it can never be silently returned to the pool or reserved by a different Vink while its
 * real state is unknown. Any other error (a clean, known failure — nothing happened) is
 * returned unchanged, no quarantine. */
async function callProviderOrQuarantine<T>(
  tx: VinkTx,
  cardId: CardAssignment['cardId'],
  fn: () => Promise<T>,
): Promise<ProviderCallOutcome<T>> {
  try {
    return { kind: 'OK', value: await fn() };
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'UNKNOWN_OUTCOME') {
      await tx.quarantineCard(cardId);
    }
    return { kind: 'ERROR', error };
  }
}

export interface CardAssignmentCommandInput {
  cardAssignmentId: CardAssignment['id'];
}

async function loadActiveAssignment(tx: VinkTx, id: CardAssignment['id']): Promise<CardAssignment> {
  const assignment = await tx.getCardAssignmentForUpdate(id);
  if (assignment === null) {
    throw new ApplicationError('CARD_ASSIGNMENT_NOT_FOUND', `card assignment ${id} not found`);
  }
  if (assignment.status !== 'ACTIVE') {
    throw new ApplicationError('INVALID_COMMAND', `card assignment ${id} is not ACTIVE`);
  }
  return assignment;
}

/** RESERVED -> ENABLING -> (provider.enableCard) -> AWAITING_WALLET_PROVISIONING. Idempotent:
 * an assignment already past RESERVED is returned unchanged, no second provider call. */
export async function enableCardCommand(
  ctx: CardProvisioningCommandContext,
  input: CardAssignmentCommandInput,
): Promise<CardAssignment> {
  interface Result {
    assignment: CardAssignment;
    providerOutcome: ProviderCallOutcome<void>;
  }
  const result = await ctx.uow.run(async (tx): Promise<Result> => {
    const existing = await loadActiveAssignment(tx, input.cardAssignmentId);
    if (existing.provisioningStatus !== 'RESERVED') {
      return { assignment: existing, providerOutcome: { kind: 'OK', value: undefined } }; // idempotent no-op
    }

    await tx.updateCardAssignment({ ...existing, provisioningStatus: 'ENABLING' });
    const card = await requireCard(tx, existing.cardId);
    const providerOutcome = await callProviderOrQuarantine(tx, existing.cardId, () =>
      ctx.provider.enableCard(card.providerCardId),
    );
    if (providerOutcome.kind === 'ERROR') return { assignment: existing, providerOutcome };
    const enabled: CardAssignment = {
      ...existing,
      provisioningStatus: 'AWAITING_WALLET_PROVISIONING',
    };
    await tx.updateCardAssignment(enabled);
    return { assignment: enabled, providerOutcome };
  });
  // Thrown ONLY after the transaction (including any quarantine write) has committed — see
  // `callProviderOrQuarantine`'s own doc comment for why this can't throw from inside `run`.
  if (result.providerOutcome.kind === 'ERROR') throw result.providerOutcome.error;
  logCommand(ctx.logger, 'enableCard', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: result.assignment.vinkId,
  });
  return result.assignment;
}

export interface ProvisionWalletTokenInput extends CardAssignmentCommandInput {
  walletType: 'APPLE_PAY' | 'GOOGLE_PAY';
}

/** AWAITING_WALLET_PROVISIONING -> (provider.createWalletProvisioningSession) ->
 * READY_TO_PAY. Deliberately does not persist a separate `TOKEN_PROVISIONED` row-state — see
 * this file's own top comment. Idempotent: an assignment already at READY_TO_PAY (or later)
 * is returned unchanged. */
export async function provisionWalletTokenCommand(
  ctx: CardProvisioningCommandContext,
  input: ProvisionWalletTokenInput,
): Promise<CardAssignment> {
  interface Result {
    assignment: CardAssignment;
    providerOutcome: ProviderCallOutcome<unknown>;
  }
  const result = await ctx.uow.run(async (tx): Promise<Result> => {
    const existing = await loadActiveAssignment(tx, input.cardAssignmentId);
    if (existing.provisioningStatus === 'READY_TO_PAY') {
      return { assignment: existing, providerOutcome: { kind: 'OK', value: undefined } }; // idempotent no-op
    }
    if (existing.provisioningStatus !== 'AWAITING_WALLET_PROVISIONING') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `card assignment ${existing.id} must be enabled before wallet provisioning ` +
          `(provisioningStatus: ${existing.provisioningStatus})`,
      );
    }
    const card = await requireCard(tx, existing.cardId);
    const providerOutcome = await callProviderOrQuarantine(tx, existing.cardId, () =>
      ctx.provider.createWalletProvisioningSession({
        idempotencyKey: idempotencyKey.provisionWalletToken(existing.id),
        providerCardId: card.providerCardId,
        walletType: input.walletType,
      }),
    );
    if (providerOutcome.kind === 'ERROR') return { assignment: existing, providerOutcome };
    await tx.insertCardWalletToken({
      id: newCardWalletTokenId(),
      cardAssignmentId: existing.id,
      providerTokenId: providerOutcome.value.providerReference,
      status: 'PROVISIONED',
      provisionedAt: ctx.clock.now().toISOString(),
      revokedAt: null,
    });
    const ready: CardAssignment = { ...existing, provisioningStatus: 'READY_TO_PAY' };
    await tx.updateCardAssignment(ready);
    return { assignment: ready, providerOutcome };
  });
  if (result.providerOutcome.kind === 'ERROR') throw result.providerOutcome.error;
  logCommand(ctx.logger, 'provisionWalletToken', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: result.assignment.vinkId,
  });
  return result.assignment;
}

/** Starts teardown from wherever the assignment currently is (READY_TO_PAY normally, but also
 * callable as an abort path from an earlier state) -> DISABLING -> (provider.disableCard).
 * Idempotent: an assignment already at DISABLING or later is returned unchanged. */
export async function disableCardCommand(
  ctx: CardProvisioningCommandContext,
  input: CardAssignmentCommandInput,
): Promise<CardAssignment> {
  interface Result {
    assignment: CardAssignment;
    providerOutcome: ProviderCallOutcome<void>;
  }
  const result = await ctx.uow.run(async (tx): Promise<Result> => {
    const existing = await loadActiveAssignment(tx, input.cardAssignmentId);
    const alreadyTearingDown =
      existing.provisioningStatus === 'DISABLING' ||
      existing.provisioningStatus === 'TOKEN_REVOCATION_PENDING' ||
      existing.provisioningStatus === 'SANITIZED';
    if (alreadyTearingDown) {
      return { assignment: existing, providerOutcome: { kind: 'OK', value: undefined } }; // idempotent no-op
    }

    await tx.updateCardAssignment({ ...existing, provisioningStatus: 'DISABLING' });
    const card = await requireCard(tx, existing.cardId);
    const providerOutcome = await callProviderOrQuarantine(tx, existing.cardId, () =>
      ctx.provider.disableCard(card.providerCardId),
    );
    if (providerOutcome.kind === 'ERROR') return { assignment: existing, providerOutcome };
    const disabled: CardAssignment = {
      ...existing,
      provisioningStatus: 'TOKEN_REVOCATION_PENDING',
    };
    await tx.updateCardAssignment(disabled);
    return { assignment: disabled, providerOutcome };
  });
  if (result.providerOutcome.kind === 'ERROR') throw result.providerOutcome.error;
  logCommand(ctx.logger, 'disableCard', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: result.assignment.vinkId,
  });
  return result.assignment;
}

/** TOKEN_REVOCATION_PENDING -> (provider.revokeWalletToken) -> SANITIZED. This is what makes
 * `returnCardToPoolCommand`'s own security check pass: the wallet token row this command
 * updates to REVOKED is exactly what that command queries. A missing/already-revoked token
 * (nothing real to revoke) still safely reaches SANITIZED — idempotent, not an error. */
export async function revokeWalletTokenCommand(
  ctx: CardProvisioningCommandContext,
  input: CardAssignmentCommandInput,
): Promise<CardAssignment> {
  interface Result {
    assignment: CardAssignment;
    providerOutcome: ProviderCallOutcome<void>;
  }
  const result = await ctx.uow.run(async (tx): Promise<Result> => {
    const existing = await loadActiveAssignment(tx, input.cardAssignmentId);
    if (existing.provisioningStatus === 'SANITIZED') {
      return { assignment: existing, providerOutcome: { kind: 'OK', value: undefined } }; // idempotent no-op
    }

    const token = await tx.getCardWalletTokenForAssignment(existing.id);
    if (token !== null && token.status === 'PROVISIONED') {
      const providerOutcome = await callProviderOrQuarantine(tx, existing.cardId, () =>
        ctx.provider.revokeWalletToken(token.providerTokenId),
      );
      if (providerOutcome.kind === 'ERROR') return { assignment: existing, providerOutcome };
      await tx.updateCardWalletToken({
        ...token,
        status: 'REVOKED',
        revokedAt: ctx.clock.now().toISOString(),
      });
    }
    const sanitized: CardAssignment = { ...existing, provisioningStatus: 'SANITIZED' };
    await tx.updateCardAssignment(sanitized);
    return { assignment: sanitized, providerOutcome: { kind: 'OK', value: undefined } };
  });
  if (result.providerOutcome.kind === 'ERROR') throw result.providerOutcome.error;
  logCommand(ctx.logger, 'revokeWalletToken', {
    correlationId: ctx.correlationId,
    actor: 'system',
    vinkId: result.assignment.vinkId,
  });
  return result.assignment;
}
