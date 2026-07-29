/**
 * Mock contribution engine (PV5). Every financial transition: one unit of work, vink row
 * lock first (Plan §11 lock list), domain-decided transition + outbox event (D12), typed
 * errors. The provider is reached ONLY through the neutral FinancialProvider interface —
 * scenario differences ride on the mock's payment-method tokens, never on provider types.
 *
 * D5 single-resolver rule: `resolveFunding` is the only code that fires
 * FUNDING_CONFIRMED / FUNDING_FAILED. Both the fast path (last authorization arrives) and
 * the deadline jobs enter through it, always under the same vink row lock.
 *
 * D15 (ratified): provider calls happen inside the unit of work. The mock is in-process and
 * cannot fail independently of the transaction, so this is safe today; the two-phase
 * pattern a REAL adapter needs depends on that provider's own idempotency/webhook
 * semantics and is designed at the M0 gate's close, not guessed at now.
 */

import {
  assertWithinApprovedMaximum,
  compareMoney,
  idempotencyKey,
  money,
  newContributionId,
  sumMoney,
  type Contribution,
  type ContributionId,
  type Participant,
  type Vink,
  type VinkId,
} from '../../domain/src/index.ts';
import {
  operationId,
  ProviderError,
  type FinancialProvider,
} from '../../payment-provider/src/index.ts';
import { contributionCapturePosting, sessionFundingPosting } from '../../ledger/src/index.ts';
import { ApplicationError } from './errors.ts';
import type { PublicCommandContext, VinkTx } from './ports.ts';
import { applyVinkTransition } from './support/transition.ts';
import { applyContributionTransition } from './support/contribution-transition.ts';
import { logCommand } from './support/command-logging.ts';

/** How long an AUTHORIZATION_PENDING may sit before the sweep declares it unknown. */
export const AUTHORIZATION_TIMEOUT_MS = 30_000;

export type ContributionScenario = 'SUCCESS' | 'DECLINE' | 'DELAYED';

/** Scenario → mock payment-method token. Non-SUCCESS is simulator-gated at the transport. */
const SCENARIO_TOKEN: Record<ContributionScenario, string> = {
  SUCCESS: 'tok_ok',
  DECLINE: 'tok_decline',
  DELAYED: 'tok_pending',
};

export type ContributionRequester =
  { kind: 'user'; userId: string } | { kind: 'guest'; guestIdentityId: string };

export interface ContributionCommandContext extends PublicCommandContext {
  provider: FinancialProvider;
}

export type FundingOutcome = 'FUNDED' | 'EXPIRED' | 'WAITING' | 'NOT_DUE';

function requesterActor(requester: ContributionRequester): string {
  return requester.kind === 'user' ? requester.userId : `guest:${requester.guestIdentityId}`;
}

function findOwnParticipant(
  participants: Participant[],
  requester: ContributionRequester,
): Participant | undefined {
  return participants.find(
    (participant) =>
      participant.status === 'JOINED' &&
      (requester.kind === 'user'
        ? participant.userId === requester.userId
        : participant.guestIdentityId === requester.guestIdentityId),
  );
}

function isLive(contribution: Contribution): boolean {
  return contribution.status !== 'DECLINED' && contribution.status !== 'CANCELLED';
}

/** Participants the funding decision counts: active with a positive allocation. */
function fundingParticipants(participants: Participant[]): Participant[] {
  return participants.filter(
    (participant) =>
      participant.status !== 'REMOVED' && participant.allocatedAmount.amountMinor > 0,
  );
}

async function providerIdsFor(
  provider: FinancialProvider,
  participantId: string,
  methodToken: string,
): Promise<{ providerCustomerId: string; providerMethodId: string }> {
  const { providerCustomerId } = await provider.createCustomer({
    idempotencyKey: `customer:v1:${participantId}`,
    externalUserId: participantId,
  });
  const { providerMethodId } = await provider.setupPaymentMethod({
    idempotencyKey: `method:v1:${participantId}:${methodToken}`,
    providerCustomerId,
    methodToken,
    usage: 'CONTRIBUTION',
  });
  return { providerCustomerId, providerMethodId };
}

// ---------------------------------------------------------------------------
// AuthorizeContributionCommand
// ---------------------------------------------------------------------------

export interface AuthorizeContributionInput {
  vinkId: VinkId;
  requester: ContributionRequester;
  scenario?: ContributionScenario;
}

export interface AuthorizeContributionResult {
  contribution: Contribution;
  vinkState: Vink['state'];
  /** true when an existing live contribution was returned instead of creating a new one. */
  replayed: boolean;
}

export async function authorizeContributionCommand(
  ctx: ContributionCommandContext,
  input: AuthorizeContributionInput,
): Promise<AuthorizeContributionResult> {
  const scenario = input.scenario ?? 'SUCCESS';
  const result = await ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    if (vink.state !== 'OPEN') {
      throw new ApplicationError(
        'INVALID_COMMAND',
        `contributions are accepted only while OPEN (state: ${vink.state})`,
      );
    }
    const participants = await tx.listParticipants(vink.id);
    const participant = findOwnParticipant(participants, input.requester);
    if (participant === undefined) {
      throw new ApplicationError(
        'FORBIDDEN',
        'requester is not an active participant of this vink',
      );
    }
    if (participant.allocatedAmount.amountMinor === 0) {
      throw new ApplicationError(
        'INVALID_COMMAND',
        'no allocation to authorize — ask the organizer to set the split',
      );
    }

    const contributions = await tx.listContributionsForUpdate(vink.id);
    const own = contributions.filter((row) => row.participantId === participant.id);
    const live = own.find(isLive);
    if (live !== undefined) {
      // Business-level idempotency: a double tap returns the live contribution unchanged.
      return { contribution: live, vinkState: vink.state, replayed: true };
    }

    const amount = participant.allocatedAmount;
    assertWithinApprovedMaximum(amount, participant.maximumApprovedAmount, 'authorizeContribution');

    const now = ctx.clock.now();
    const attemptNumber = own.length + 1;
    let contribution: Contribution = {
      id: newContributionId(),
      vinkId: vink.id,
      participantId: participant.id,
      attemptNumber,
      requestedAmount: amount,
      authorizedAmount: null,
      capturedAmount: null,
      refundedAmount: null,
      status: 'CREATED',
      providerReference: null,
      idempotencyKey: idempotencyKey.authorizeContribution(vink.id, participant.id, attemptNumber),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await tx.insertContribution(contribution);
    const actor = requesterActor(input.requester);
    contribution = await applyContributionTransition(
      tx,
      contribution,
      'AUTHORIZATION_STARTED',
      actor,
      ctx.correlationId,
      now,
    );

    try {
      const token = SCENARIO_TOKEN[scenario];
      const ids = await providerIdsFor(ctx.provider, participant.id, token);
      const result = await ctx.provider.authorizeContribution({
        idempotencyKey: operationId.authorize(participant.id, attemptNumber),
        providerCustomerId: ids.providerCustomerId,
        providerMethodId: ids.providerMethodId,
        amount,
        captureMode: 'MANUAL',
        metadata: {
          vinkId: vink.id,
          participantId: participant.id,
          contributionId: contribution.id,
        },
      });
      if (result.status === 'AUTHORIZED') {
        contribution = await applyContributionTransition(
          tx,
          contribution,
          'AUTHORIZATION_APPROVED',
          actor,
          ctx.correlationId,
          now,
          { authorizedAmount: amount, providerReference: result.providerPaymentId },
        );
        const outcome = await maybeCloseAndResolve(tx, ctx, vink, now);
        // The fast path may have captured this contribution — return its current row.
        const current =
          (await tx.listContributionsForUpdate(vink.id)).find(
            (row) => row.id === contribution.id,
          ) ?? contribution;
        return { contribution: current, vinkState: outcome.vinkState, replayed: false };
      }
      if (result.status === 'DECLINED') {
        contribution = await applyContributionTransition(
          tx,
          contribution,
          'AUTHORIZATION_DECLINED',
          actor,
          ctx.correlationId,
          now,
          { providerReference: result.providerPaymentId },
        );
        return { contribution, vinkState: vink.state, replayed: false };
      }
      // PROCESSING: async confirmation pending — stays AUTHORIZATION_PENDING; the sweep or
      // the simulator resolves it later.
      contribution = { ...contribution, providerReference: result.providerPaymentId };
      await tx.updateContribution(contribution);
      return { contribution, vinkState: vink.state, replayed: false };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'PROVIDER_UNAVAILABLE') {
        // Lost response (§12): outcome unknown; the SAME idempotency key resolves it later.
        contribution = await applyContributionTransition(
          tx,
          contribution,
          'PROVIDER_RESULT_UNKNOWN',
          actor,
          ctx.correlationId,
          now,
        );
        return { contribution, vinkState: vink.state, replayed: false };
      }
      throw error;
    }
  });
  if (result.replayed) ctx.metrics?.recordReplay('authorizeContribution');
  ctx.metrics?.recordContributionOutcome(result.contribution.status);
  logCommand(ctx.logger, 'authorizeContribution', {
    correlationId: ctx.correlationId,
    actor: requesterActor(input.requester),
    vinkId: input.vinkId,
    idempotencyKey: result.contribution.idempotencyKey,
    status: result.contribution.status,
    replayed: result.replayed,
  });
  return result;
}

// ---------------------------------------------------------------------------
// The D5 resolver and its entry points
// ---------------------------------------------------------------------------

/** Fast path: if everything is authorized while OPEN, close submissions and resolve now. */
async function maybeCloseAndResolve(
  tx: VinkTx,
  ctx: ContributionCommandContext,
  vink: Vink,
  now: Date,
): Promise<{ vinkState: Vink['state'] }> {
  if (vink.state !== 'OPEN') return { vinkState: vink.state };
  const participants = fundingParticipants(await tx.listParticipants(vink.id));
  const contributions = await tx.listContributionsForUpdate(vink.id);
  const authorized = contributions.filter((row) => row.status === 'AUTHORIZED');
  const everyoneAuthorized =
    participants.length > 0 &&
    participants.every((participant) =>
      authorized.some((row) => row.participantId === participant.id),
    );
  if (!everyoneAuthorized) return { vinkState: vink.state };
  const authorizedSum = sumMoney(authorized.map((row) => row.authorizedAmount ?? money(0)));
  if (compareMoney(authorizedSum, vink.requiredAmount) !== 0) return { vinkState: vink.state };

  let current = await applyVinkTransition(
    tx,
    vink,
    'ALL_CONTRIBUTIONS_AUTHORIZED',
    'system',
    ctx.correlationId,
    now,
  );
  current = await applyVinkTransition(
    tx,
    current,
    'PROCESSING_GRACE_STARTED',
    'system',
    ctx.correlationId,
    now,
  );
  const outcome = await resolveFunding(tx, ctx, current, now, true);
  return { vinkState: outcome.vink.state };
}

/**
 * THE funding decision (D5): fires FUNDING_CONFIRMED or FUNDING_FAILED exactly once, under
 * the vink row lock taken by the caller. Nothing else may fire those events.
 */
async function resolveFunding(
  tx: VinkTx,
  ctx: ContributionCommandContext,
  vink: Vink,
  now: Date,
  deadlineReached: boolean,
): Promise<{ outcome: FundingOutcome; vink: Vink }> {
  if (vink.state !== 'PROCESSING_GRACE') {
    throw new ApplicationError(
      'INVALID_COMMAND',
      `resolver requires PROCESSING_GRACE, got ${vink.state}`,
    );
  }
  const participants = fundingParticipants(await tx.listParticipants(vink.id));
  const contributions = await tx.listContributionsForUpdate(vink.id);
  const live = contributions.filter(isLive);
  const authorized = live.filter((row) => row.status === 'AUTHORIZED');
  const unresolved = live.filter(
    (row) => row.status === 'AUTHORIZATION_PENDING' || row.status === 'RESOLUTION_PENDING',
  );

  const everyoneAuthorized =
    participants.length > 0 &&
    participants.every((participant) =>
      authorized.some((row) => row.participantId === participant.id),
    ) &&
    compareMoney(
      sumMoney(authorized.map((row) => row.authorizedAmount ?? money(0))),
      vink.requiredAmount,
    ) === 0;

  if (everyoneAuthorized) {
    let fundedTotal = 0;
    for (const row of authorized) {
      const amount = row.authorizedAmount ?? money(0);
      // §4.7 final guard before any capture.
      const participant = participants.find((p) => p.id === row.participantId);
      if (participant !== undefined) {
        assertWithinApprovedMaximum(amount, participant.maximumApprovedAmount, 'capture');
      }
      let current = await applyContributionTransition(
        tx,
        row,
        'SESSION_FUNDED',
        'resolver',
        ctx.correlationId,
        now,
      );
      await ctx.provider.captureContribution({
        idempotencyKey: operationId.capture(row.participantId, row.attemptNumber),
        providerPaymentId: row.providerReference ?? '',
        amount,
      });
      current = await applyContributionTransition(
        tx,
        current,
        'CAPTURE_SUCCEEDED',
        'resolver',
        ctx.correlationId,
        now,
        { capturedAmount: amount },
      );
      await tx.insertLedgerPosting({
        referenceType: 'contribution',
        referenceId: current.id,
        entries: contributionCapturePosting(amount).entries,
      });
      await tx.insertLedgerPosting({
        referenceType: 'contribution',
        referenceId: current.id,
        entries: sessionFundingPosting(amount).entries,
      });
      fundedTotal += amount.amountMinor;
    }
    const funded: Vink = { ...vink, fundedAmount: money(fundedTotal) };
    const final = await applyVinkTransition(
      tx,
      funded,
      'FUNDING_CONFIRMED',
      'resolver',
      ctx.correlationId,
      now,
    );
    return { outcome: 'FUNDED', vink: final };
  }

  if (!deadlineReached && unresolved.length > 0) {
    return { outcome: 'WAITING', vink };
  }

  // Funding failed: release every hold; unknowns are cancelled at the provider.
  for (const row of live) {
    if (row.status === 'AUTHORIZED') {
      const current = await applyContributionTransition(
        tx,
        row,
        'SESSION_EXPIRED',
        'resolver',
        ctx.correlationId,
        now,
      );
      await cancelAtProvider(ctx.provider, current);
      await applyContributionTransition(
        tx,
        current,
        'CANCELLATION_SUCCEEDED',
        'resolver',
        ctx.correlationId,
        now,
      );
    } else if (row.status === 'AUTHORIZATION_PENDING' || row.status === 'RESOLUTION_PENDING') {
      let current = row;
      if (current.status === 'AUTHORIZATION_PENDING') {
        current = await applyContributionTransition(
          tx,
          current,
          'AUTHORIZATION_TIMED_OUT',
          'resolver',
          ctx.correlationId,
          now,
        );
      }
      await cancelAtProvider(ctx.provider, current);
      await applyContributionTransition(
        tx,
        current,
        'RESOLVED_CANCELLED',
        'resolver',
        ctx.correlationId,
        now,
      );
    }
  }
  const final = await applyVinkTransition(
    tx,
    vink,
    'FUNDING_FAILED',
    'resolver',
    ctx.correlationId,
    now,
  );
  return { outcome: 'EXPIRED', vink: final };
}

async function cancelAtProvider(
  provider: FinancialProvider,
  contribution: Contribution,
): Promise<void> {
  if (contribution.providerReference === null) return; // nothing ever reached the provider
  try {
    await provider.cancelContributionAuthorization({
      idempotencyKey: `cancel:v1:${contribution.id}`,
      providerPaymentId: contribution.providerReference,
      reason: 'VINK_EXPIRED',
    });
  } catch (error) {
    // Already terminal at the provider (declined/expired/canceled) — the release is moot.
    if (!(error instanceof ProviderError && error.code === 'INVALID_STATE')) throw error;
  }
}

export interface DeadlineInput {
  vinkId: VinkId;
  now?: Date;
}

/** close-submissions job body: PostgreSQL deadline truth decides, never the scheduler. */
export async function closeSubmissionsCommand(
  ctx: ContributionCommandContext,
  input: DeadlineInput,
): Promise<FundingOutcome> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    const now = input.now ?? ctx.clock.now();
    if (vink.state !== 'OPEN') return 'NOT_DUE';
    if (now.getTime() < new Date(vink.submissionDeadline).getTime()) return 'NOT_DUE';
    let current = await applyVinkTransition(
      tx,
      vink,
      'SUBMISSION_DEADLINE_REACHED',
      'timer',
      ctx.correlationId,
      now,
    );
    current = await applyVinkTransition(
      tx,
      current,
      'PROCESSING_GRACE_STARTED',
      'timer',
      ctx.correlationId,
      now,
    );
    const deadlineReached = now.getTime() >= new Date(current.processingGraceDeadline).getTime();
    const outcome = (await resolveFunding(tx, ctx, current, now, deadlineReached)).outcome;
    logCommand(ctx.logger, 'closeSubmissions', {
      correlationId: ctx.correlationId,
      actor: 'timer',
      vinkId: current.id,
      outcome,
    });
    return outcome;
  });
}

/** resolve-processing-grace job body — same resolver, grace-deadline entry (D5). */
export async function resolveGraceCommand(
  ctx: ContributionCommandContext,
  input: DeadlineInput,
): Promise<FundingOutcome> {
  return ctx.uow.run(async (tx) => {
    const vink = await tx.getVinkForUpdate(input.vinkId);
    if (vink === null)
      throw new ApplicationError('VINK_NOT_FOUND', `vink ${input.vinkId} not found`);
    const now = input.now ?? ctx.clock.now();
    let current = vink;
    if (current.state === 'SUBMISSIONS_CLOSED') {
      current = await applyVinkTransition(
        tx,
        current,
        'PROCESSING_GRACE_STARTED',
        'timer',
        ctx.correlationId,
        now,
      );
    }
    if (current.state !== 'PROCESSING_GRACE') return 'NOT_DUE';
    const deadlineReached = now.getTime() >= new Date(current.processingGraceDeadline).getTime();
    const outcome = (await resolveFunding(tx, ctx, current, now, deadlineReached)).outcome;
    logCommand(ctx.logger, 'resolveGrace', {
      correlationId: ctx.correlationId,
      actor: 'timer',
      vinkId: current.id,
      outcome,
    });
    return outcome;
  });
}

// ---------------------------------------------------------------------------
// ResolveContributionCommand — resolution-pending / stuck-pending recovery (E5)
// ---------------------------------------------------------------------------

export interface ResolveContributionInput {
  contributionId: ContributionId;
  vinkId: VinkId;
  /** For the lost-response replay (no provider reference yet): same scenario, same key. */
  scenario?: ContributionScenario;
  now?: Date;
}

export async function resolveContributionCommand(
  ctx: ContributionCommandContext,
  input: ResolveContributionInput,
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
    const now = input.now ?? ctx.clock.now();
    if (
      contribution.status !== 'AUTHORIZATION_PENDING' &&
      contribution.status !== 'RESOLUTION_PENDING'
    ) {
      return contribution; // nothing to resolve — idempotent no-op
    }

    let providerReference = contribution.providerReference;
    if (providerReference === null) {
      // Lost response: replay the ORIGINAL operation with the same idempotency key (§12) —
      // the provider returns the already-executed result without a duplicate side effect.
      const token = SCENARIO_TOKEN[input.scenario ?? 'SUCCESS'];
      const ids = await providerIdsFor(ctx.provider, contribution.participantId, token);
      const replayed = await ctx.provider.authorizeContribution({
        idempotencyKey: operationId.authorize(
          contribution.participantId,
          contribution.attemptNumber,
        ),
        providerCustomerId: ids.providerCustomerId,
        providerMethodId: ids.providerMethodId,
        amount: contribution.requestedAmount,
        captureMode: 'MANUAL',
        metadata: {
          vinkId: vink.id,
          participantId: contribution.participantId,
          contributionId: contribution.id,
        },
      });
      providerReference = replayed.providerPaymentId;
    }

    const status = await ctx.provider.retrievePaymentStatus(providerReference);
    const fromPending = contribution.status === 'AUTHORIZATION_PENDING';
    let resolved = contribution;
    if (status.status === 'AUTHORIZED') {
      resolved = await applyContributionTransition(
        tx,
        contribution,
        fromPending ? 'AUTHORIZATION_APPROVED' : 'RESOLVED_AUTHORIZED',
        'resolver',
        ctx.correlationId,
        now,
        {
          authorizedAmount: status.authorizedAmount ?? contribution.requestedAmount,
          providerReference,
        },
      );
      if (vink.state === 'OPEN') {
        await maybeCloseAndResolve(tx, ctx, vink, now);
      } else if (vink.state === 'PROCESSING_GRACE') {
        const deadlineReached = now.getTime() >= new Date(vink.processingGraceDeadline).getTime();
        await resolveFunding(tx, ctx, vink, now, deadlineReached);
      }
      // The resolver may have captured this contribution — return its current row.
      resolved =
        (await tx.listContributionsForUpdate(vink.id)).find((row) => row.id === resolved.id) ??
        resolved;
    } else if (status.status === 'DECLINED') {
      resolved = await applyContributionTransition(
        tx,
        contribution,
        fromPending ? 'AUTHORIZATION_DECLINED' : 'RESOLVED_DECLINED',
        'resolver',
        ctx.correlationId,
        now,
        { providerReference },
      );
    } else if (status.status === 'CANCELED' || status.status === 'EXPIRED') {
      let current = contribution;
      if (fromPending) {
        current = await applyContributionTransition(
          tx,
          current,
          'AUTHORIZATION_TIMED_OUT',
          'resolver',
          ctx.correlationId,
          now,
          { providerReference },
        );
      }
      resolved = await applyContributionTransition(
        tx,
        current,
        'RESOLVED_CANCELLED',
        'resolver',
        ctx.correlationId,
        now,
      );
    } else if (status.status === 'PROCESSING' && fromPending) {
      const age = now.getTime() - new Date(contribution.createdAt).getTime();
      if (age >= AUTHORIZATION_TIMEOUT_MS) {
        resolved = await applyContributionTransition(
          tx,
          contribution,
          'AUTHORIZATION_TIMED_OUT',
          'resolver',
          ctx.correlationId,
          now,
          { providerReference },
        );
      } else if (contribution.providerReference === null) {
        resolved = { ...contribution, providerReference };
        await tx.updateContribution(resolved);
      }
    }
    ctx.metrics?.recordContributionOutcome(resolved.status);
    logCommand(ctx.logger, 'resolveContribution', {
      correlationId: ctx.correlationId,
      actor: 'resolver',
      vinkId: vink.id,
      idempotencyKey: resolved.idempotencyKey,
      status: resolved.status,
    });
    return resolved;
  });
}
