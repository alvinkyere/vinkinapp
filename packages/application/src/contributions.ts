/**
 * Contribution + funding engine (PV5, rebuilt RM3A/D47). Every financial transition: one unit
 * of work, vink row lock first (Plan §11 lock list), domain-decided transition + outbox event
 * (D12), typed errors. The provider is reached ONLY through the neutral FinancialProvider
 * interface — scenario differences ride on the mock's payment-method tokens, never on
 * provider types.
 *
 * RM3A (D47): capture happens IMMEDIATELY, per contribution, the moment it authorizes
 * (`captureImmediately`, called from `authorizeContributionCommand`) — not batched once
 * everyone's authorized, as PV5 originally built it. `resolveFunding`'s "everyone funded"
 * branch is now a pure aggregate check over already-`CAPTURED` rows; its failure branch
 * refunds already-captured money (via `refunds.ts`'s exported `refundOne`) rather than
 * merely cancelling holds, since capture-immediately means holds mostly don't exist by the
 * time expiry is decided. `resolveAgainstProviderTruth` is shared between the standalone E5
 * resolver (`resolveContributionCommand`) and `resolveFunding`'s own failure branch — a
 * RESOLUTION_PENDING contribution can now originate from a CAPTURE-side ambiguity
 * (`CAPTURE_RESULT_UNKNOWN`), not just an authorize-side one, so it is never blindly cancelled
 * — provider truth is checked first. A live contribution still found `AUTHORIZED` (impossible
 * via the new path, but possible for data predating this deploy) is caught up via the
 * ORIGINAL, unchanged `SESSION_FUNDED`-driven capture logic — the compatibility shim.
 *
 * D5 single-resolver rule: `resolveFunding` is the only code that fires
 * FUNDING_CONFIRMED / FUNDING_FAILED. Both the fast path (last authorization arrives) and
 * the deadline jobs enter through it, always under the same vink row lock.
 *
 * D15 (ratified): provider calls happen inside the unit of work. The mock is in-process and
 * cannot fail independently of the transaction, so this is safe today; the two-phase
 * pattern a REAL adapter needs depends on that provider's own idempotency/webhook
 * semantics and is designed at the M0 gate's close, not guessed at now. A non-retryable
 * provider error during `captureImmediately` propagates and rolls back this transaction —
 * the same accepted risk posture as any other provider call in this file, not a new gap
 * RM3A introduces.
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
import { refundOne } from './refunds.ts';
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

export type FundingOutcome =
  | 'FUNDED'
  | 'EXPIRED'
  | 'REFUND_RECOVERY_REQUIRED' // RM3A (D47): a refund failed, or a contribution's status is still unknown
  | 'WAITING'
  | 'NOT_DUE';

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

/** RM3A (D47): AUTHORIZED -> CAPTURE_PENDING -> CAPTURED (or RESOLUTION_PENDING on a
 * genuinely ambiguous/retryable provider outcome) — the core of the capture-immediately
 * funding engine. Same two ledger postings this codebase has always inserted at capture time
 * (`resolveFunding` used to insert them once everyone funded; now inserted here, per
 * contribution, immediately). See this file's own module doc comment for the non-retryable
 * error posture (D15). */
async function captureImmediately(
  tx: VinkTx,
  ctx: ContributionCommandContext,
  contribution: Contribution,
  actor: string,
  now: Date,
): Promise<Contribution> {
  const amount = contribution.authorizedAmount ?? money(0);
  const current = await applyContributionTransition(
    tx,
    contribution,
    'CAPTURE_INITIATED',
    actor,
    ctx.correlationId,
    now,
  );
  try {
    await ctx.provider.captureContribution({
      idempotencyKey: operationId.capture(contribution.participantId, contribution.attemptNumber),
      providerPaymentId: contribution.providerReference ?? '',
      amount,
    });
  } catch (error) {
    if (error instanceof ProviderError && error.retryable) {
      // Genuinely ambiguous (e.g. UNKNOWN_OUTCOME): don't assume either way (§12).
      return applyContributionTransition(
        tx,
        current,
        'CAPTURE_RESULT_UNKNOWN',
        actor,
        ctx.correlationId,
        now,
      );
    }
    throw error;
  }
  const captured = await applyContributionTransition(
    tx,
    current,
    'CAPTURE_SUCCEEDED',
    actor,
    ctx.correlationId,
    now,
    { capturedAmount: amount },
  );
  await tx.insertLedgerPosting({
    referenceType: 'contribution',
    referenceId: captured.id,
    entries: contributionCapturePosting(amount).entries,
  });
  await tx.insertLedgerPosting({
    referenceType: 'contribution',
    referenceId: captured.id,
    entries: sessionFundingPosting(amount).entries,
  });
  return captured;
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
    // RM4A (D47): consistent deadline enforcement — mirrors `guest.ts`'s own `isJoinable`
    // check (and `addParticipantCommand`'s matching one) rather than trusting the sweep
    // (10s cadence) to have already flipped state off OPEN by the time this lands.
    if (ctx.clock.now().getTime() >= new Date(vink.submissionDeadline).getTime()) {
      throw new ApplicationError('INVALID_COMMAND', 'the submission deadline has passed');
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
        // RM3A (D47): capture immediately, on this contribution's own authorization — do not
        // wait for the whole session to fund. See this file's own module doc comment.
        contribution = await captureImmediately(tx, ctx, contribution, actor, now);
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

/** Fast path: if everyone's contribution is already CAPTURED (RM3A — capture happens
 * immediately, on each contribution's own authorization) while OPEN, close submissions and
 * resolve now. */
async function maybeCloseAndResolve(
  tx: VinkTx,
  ctx: ContributionCommandContext,
  vink: Vink,
  now: Date,
): Promise<{ vinkState: Vink['state'] }> {
  if (vink.state !== 'OPEN') return { vinkState: vink.state };
  const participants = fundingParticipants(await tx.listParticipants(vink.id));
  const contributions = await tx.listContributionsForUpdate(vink.id);
  const captured = contributions.filter((row) => row.status === 'CAPTURED');
  const everyoneCaptured =
    participants.length > 0 &&
    participants.every((participant) =>
      captured.some((row) => row.participantId === participant.id),
    );
  if (!everyoneCaptured) return { vinkState: vink.state };
  const capturedSum = sumMoney(captured.map((row) => row.capturedAmount ?? money(0)));
  if (compareMoney(capturedSum, vink.requiredAmount) !== 0) return { vinkState: vink.state };

  // RM3A: the VinkEvent name ALL_CONTRIBUTIONS_AUTHORIZED is now slightly stale (everyone is
  // CAPTURED by this point, not merely authorized) — left unrenamed deliberately, to avoid
  // rippling a Vink-state-machine event-name change through client-contracts/analytics for a
  // purely cosmetic fix; the domain event it actually emits, SubmissionsClosed, was already
  // accurate and is unaffected.
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
  let contributions = await tx.listContributionsForUpdate(vink.id);
  let live = contributions.filter(isLive);

  // RM3A (D47) compatibility shim: a contribution predating the capture-immediately engine
  // can still be sitting at AUTHORIZED (an uncaptured hold) — impossible via the new
  // `authorizeContributionCommand` path, but must not crash on data that predates this
  // deploy. Caught up with the EXACT capture logic this codebase ran before RM3A, unchanged.
  const legacyHolds = live.filter((row) => row.status === 'AUTHORIZED');
  for (const row of legacyHolds) {
    const amount = row.authorizedAmount ?? money(0);
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
  }
  if (legacyHolds.length > 0) {
    contributions = await tx.listContributionsForUpdate(vink.id);
    live = contributions.filter(isLive);
  }

  const captured = live.filter((row) => row.status === 'CAPTURED');
  const unresolved = live.filter(
    (row) => row.status === 'AUTHORIZATION_PENDING' || row.status === 'RESOLUTION_PENDING',
  );

  const everyoneCaptured =
    participants.length > 0 &&
    participants.every((participant) =>
      captured.some((row) => row.participantId === participant.id),
    ) &&
    compareMoney(
      sumMoney(captured.map((row) => row.capturedAmount ?? money(0))),
      vink.requiredAmount,
    ) === 0;

  if (everyoneCaptured) {
    // RM3A: capture already happened, per contribution, at authorization time
    // (`captureImmediately`) — this is now a pure aggregate read, not a capture loop.
    const fundedTotal = captured.reduce(
      (sum, row) => sum + (row.capturedAmount?.amountMinor ?? 0),
      0,
    );
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

  // Funding failed. RM3A: capture-immediately means some contributions may already hold real
  // captured money that must be REFUNDED, not merely cancelled — see this file's own module
  // doc comment and the Vink state machine's own header comment for why this routes through
  // REFUNDS_PENDING (a new non-terminal state) rather than straight to EXPIRED.
  let current = await applyVinkTransition(
    tx,
    vink,
    'FUNDING_FAILED',
    'resolver',
    ctx.correlationId,
    now,
  );
  let anyRefundFailed = false;
  let anyStillAmbiguous = false;
  for (const row of live) {
    if (row.status === 'CAPTURED') {
      const result = await refundOne(tx, ctx, row, false, now);
      if (result.status !== 'REFUNDED') anyRefundFailed = true;
    } else if (row.status === 'AUTHORIZED') {
      // Compatibility-only in principle (see the shim above) — a race could still leave one
      // here between the shim's read and this loop; same cancel logic either way.
      const cancelling = await applyContributionTransition(
        tx,
        row,
        'SESSION_EXPIRED',
        'resolver',
        ctx.correlationId,
        now,
      );
      await cancelAtProvider(ctx.provider, cancelling);
      await applyContributionTransition(
        tx,
        cancelling,
        'CANCELLATION_SUCCEEDED',
        'resolver',
        ctx.correlationId,
        now,
      );
    } else if (row.status === 'AUTHORIZATION_PENDING') {
      // Capture structurally cannot have happened before authorize resolves — safe to time
      // out and cancel, unchanged from the pre-RM3A behavior.
      const timedOut = await applyContributionTransition(
        tx,
        row,
        'AUTHORIZATION_TIMED_OUT',
        'resolver',
        ctx.correlationId,
        now,
      );
      await cancelAtProvider(ctx.provider, timedOut);
      await applyContributionTransition(
        tx,
        timedOut,
        'RESOLVED_CANCELLED',
        'resolver',
        ctx.correlationId,
        now,
      );
    } else if (row.status === 'RESOLUTION_PENDING') {
      // RM3A: this status can now originate from a CAPTURE-side ambiguity
      // (CAPTURE_RESULT_UNKNOWN), not just an authorize-side one — money may genuinely
      // already be captured. Check provider truth before deciding cancel vs. refund, instead
      // of blindly cancelling (which used to be safe only because nothing could have been
      // captured yet).
      const resolved = await resolveAgainstProviderTruth(tx, ctx, row, now);
      if (resolved.status === 'CAPTURED') {
        const result = await refundOne(tx, ctx, resolved, false, now);
        if (result.status !== 'REFUNDED') anyRefundFailed = true;
      } else if (resolved.status === 'AUTHORIZED') {
        const cancelling = await applyContributionTransition(
          tx,
          resolved,
          'SESSION_EXPIRED',
          'resolver',
          ctx.correlationId,
          now,
        );
        await cancelAtProvider(ctx.provider, cancelling);
        await applyContributionTransition(
          tx,
          cancelling,
          'CANCELLATION_SUCCEEDED',
          'resolver',
          ctx.correlationId,
          now,
        );
      } else if (resolved.status === 'RESOLUTION_PENDING') {
        // Still genuinely unknown (provider still PROCESSING) — leave it; the sweep keeps
        // trying, and this vink cannot be declared cleanly resolved yet.
        anyStillAmbiguous = true;
      }
      // DECLINED/CANCELLED: already a safe terminal outcome, nothing further to do.
    }
  }

  const needsRecovery = anyRefundFailed || anyStillAmbiguous;
  current = await applyVinkTransition(
    tx,
    current,
    needsRecovery ? 'REFUND_RECOVERY_NEEDED' : 'REFUNDS_COMPLETED',
    'resolver',
    ctx.correlationId,
    now,
  );
  return { outcome: needsRecovery ? 'REFUND_RECOVERY_REQUIRED' : 'EXPIRED', vink: current };
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

/**
 * RM3A (D47): the shared core of provider-truth resolution — used both by the standalone E5
 * resolver (`resolveContributionCommand`, which additionally decides whether to re-enter
 * `maybeCloseAndResolve`/`resolveFunding` afterward) and inline by `resolveFunding`'s own
 * failure branch (which does NOT re-enter the resolver — it's already deciding the terminal
 * outcome). Also closes a previously-latent gap: a provider status of CAPTURED had no branch
 * here before RM3A and was silently ignored.
 */
async function resolveAgainstProviderTruth(
  tx: VinkTx,
  ctx: ContributionCommandContext,
  contribution: Contribution,
  now: Date,
  scenario: ContributionScenario = 'SUCCESS',
): Promise<Contribution> {
  let providerReference = contribution.providerReference;
  if (providerReference === null) {
    // Lost response (§12): replay the ORIGINAL operation with the same idempotency key — the
    // provider returns the already-executed result without a duplicate side effect.
    const token = SCENARIO_TOKEN[scenario];
    const ids = await providerIdsFor(ctx.provider, contribution.participantId, token);
    const replayed = await ctx.provider.authorizeContribution({
      idempotencyKey: operationId.authorize(contribution.participantId, contribution.attemptNumber),
      providerCustomerId: ids.providerCustomerId,
      providerMethodId: ids.providerMethodId,
      amount: contribution.requestedAmount,
      captureMode: 'MANUAL',
      metadata: {
        vinkId: contribution.vinkId,
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
  } else if (status.status === 'CAPTURED') {
    // RM3A: closes a previously-latent gap (no branch existed for this status at all before).
    const amount = status.capturedTotal ?? contribution.requestedAmount;
    resolved = await applyContributionTransition(
      tx,
      contribution,
      'RESOLVED_CAPTURED',
      'resolver',
      ctx.correlationId,
      now,
      {
        authorizedAmount: contribution.authorizedAmount ?? amount,
        capturedAmount: amount,
        providerReference,
      },
    );
    await tx.insertLedgerPosting({
      referenceType: 'contribution',
      referenceId: resolved.id,
      entries: contributionCapturePosting(amount).entries,
    });
    await tx.insertLedgerPosting({
      referenceType: 'contribution',
      referenceId: resolved.id,
      entries: sessionFundingPosting(amount).entries,
    });
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
  // Any other case (still PROCESSING and not fromPending — a genuine capture-side ambiguity
  // still unresolved; or a REFUNDED provider status, out of RM3A's own scope to unwind here —
  // reconciliation's MISMATCHED classification is the disclosed safety net) leaves the
  // contribution's status unchanged; callers decide what "still RESOLUTION_PENDING" means.
  return resolved;
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

    let resolved = await resolveAgainstProviderTruth(
      tx,
      ctx,
      contribution,
      now,
      input.scenario ?? 'SUCCESS',
    );

    if (resolved.status === 'AUTHORIZED') {
      // RM3A: capture immediately, exactly as authorizeContributionCommand does — this is a
      // normal, ongoing resolution path (E5), not the resolveFunding compatibility shim.
      resolved = await captureImmediately(tx, ctx, resolved, 'resolver', now);
    }
    if (resolved.status === 'CAPTURED') {
      if (vink.state === 'OPEN') {
        await maybeCloseAndResolve(tx, ctx, vink, now);
      } else if (vink.state === 'PROCESSING_GRACE') {
        const deadlineReached = now.getTime() >= new Date(vink.processingGraceDeadline).getTime();
        await resolveFunding(tx, ctx, vink, now, deadlineReached);
      }
      // The resolver may have advanced this contribution further (e.g. refunded it, if the
      // vink had already failed) — return its current row.
      resolved =
        (await tx.listContributionsForUpdate(vink.id)).find((row) => row.id === resolved.id) ??
        resolved;
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
