/**
 * Read-side queries. `allowedActions` is computed here, server-side — clients render what
 * the server permits and never re-derive state-machine logic (master plan §19).
 */

import type { Contribution, Participant, Vink, VinkId } from '../../domain/src/index.ts';
import { ApplicationError } from './errors.ts';
import type { ActivityEntry, VinkReader } from './ports.ts';
import { unallocatedAmount } from './commands.ts';

export type AllowedAction =
  'OPEN_VINK' | 'CANCEL_VINK' | 'ADD_PARTICIPANT' | 'EDIT_ALLOCATION' | 'COVER_REMAINING';

export interface CardView {
  status: string;
  displayLastFour: string;
  spendingLimitMinor: number;
  merchantLocked: boolean;
}

export interface RecoveryView {
  status: string;
  amountMinor: number;
  attemptCount: number;
}

export interface ParticipantContributionView {
  participantId: string;
  /** The participant's most recent contribution attempt's status (Contribution['status']) —
   * absent entirely means they haven't attempted one yet ("waiting" in the UI). */
  status: string;
}

/**
 * A contribution counts as "confirmed" for I1's `contributionProgress` projection once it
 * reaches AUTHORIZED or later in `packages/domain/src/contribution-state-machine.ts` — the
 * same threshold D24 defines: the participant's payment is no longer at risk of silently
 * vanishing, well before the D5 resolver's own atomic capture at full resolution
 * (`fundedAmount`). Deliberately excludes DECLINED/CANCELLED (never confirmed),
 * REFUND_PENDING/REFUND_FAILED/REFUNDED (money is leaving again, not "confirmed" progress —
 * docs/design/phase-10-implementation-readiness.md I1's own lock rule: "never treat
 * processing, failed, cancelled, returning, or unresolved contributions as confirmed").
 */
const CONFIRMED_CONTRIBUTION_STATUSES: ReadonlySet<string> = new Set([
  'AUTHORIZED',
  'CAPTURE_PENDING',
  'CAPTURED',
  'SETTLED',
]);

/** Oldest-first input (matches `VinkReader.listContributionsByVink`'s own documented order)
 * reduced to each participant's single most recent attempt — shared by `VinkSnapshot`'s
 * per-row status view and `computeContributionProgress` below, so both read the exact same
 * "most recent attempt" definition rather than two independently-drifting ones. */
export function latestContributionStatusByParticipant(
  contributions: Contribution[],
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const contribution of contributions) {
    latest.set(contribution.participantId, contribution.status);
  }
  return latest;
}

export interface ContributionProgressView {
  confirmedAmountMinor: number;
  totalAmountMinor: number;
  confirmedParticipantCount: number;
  totalParticipantCount: number;
}

/**
 * D24/D20's `contributionProgress` — sums each active participant's own `allocatedAmount`
 * (their assigned share, exact integer minor units, correct for both Equal and Custom
 * splits, and for the organizer where the organizer is a participant — no special-casing by
 * role) once their latest contribution attempt is confirmed. Never reads `fundedAmountMinor`
 * (`docs/design/phase-8-visual-system-refinement.md` §15; `fundedAmountMinor` keeps its
 * existing, unchanged, all-at-once-at-full-resolution domain meaning — this is a wholly
 * separate, additive projection, not a reinterpretation of it).
 */
export function computeContributionProgress(
  vink: Vink,
  participants: Participant[],
  latestStatusByParticipant: Map<string, string>,
): ContributionProgressView {
  const active = participants.filter((participant) => participant.status !== 'REMOVED');
  let confirmedAmountMinor = 0;
  let confirmedParticipantCount = 0;
  for (const participant of active) {
    const status = latestStatusByParticipant.get(participant.id);
    if (status !== undefined && CONFIRMED_CONTRIBUTION_STATUSES.has(status)) {
      confirmedAmountMinor += participant.allocatedAmount.amountMinor;
      confirmedParticipantCount += 1;
    }
  }
  return {
    confirmedAmountMinor,
    totalAmountMinor: vink.requiredAmount.amountMinor,
    confirmedParticipantCount,
    totalParticipantCount: active.length,
  };
}

export interface VinkSnapshot {
  vink: Vink;
  participants: Participant[];
  unallocatedAmountMinor: number;
  allowedActions: AllowedAction[];
  /** Present once the card is provisioned; clearly a simulation (Plan PV9 "labeled"). */
  card: CardView | null;
  /** Present once a recovery obligation exists (settlement overage → organizer owes). */
  recovery: RecoveryView | null;
  /** One entry per participant with at least one contribution attempt, latest attempt only —
   * the organizer lobby's "paid / processing / waiting" per-row status (PV13). */
  contributions: ParticipantContributionView[];
  /** D20/D24, additive (phase-10-implementation-readiness.md Slice I1) — the incremental,
   * server-computed progress signal the Ink Progress vessel is designed to consume. Never
   * replaces `vink.fundedAmountMinor`, which is untouched and keeps its existing meaning. */
  contributionProgress: ContributionProgressView;
}

export function computeAllowedActions(vink: Vink, participants: Participant[]): AllowedAction[] {
  const active = participants.filter((participant) => participant.status !== 'REMOVED');
  const remaining = unallocatedAmount(vink, active).amountMinor;
  const hasMember = active.some((participant) => participant.role === 'MEMBER');
  const actions: AllowedAction[] = [];
  if (vink.state === 'DRAFT') {
    if (hasMember && remaining === 0) actions.push('OPEN_VINK');
    actions.push('ADD_PARTICIPANT', 'EDIT_ALLOCATION');
    if (remaining > 0) actions.push('COVER_REMAINING');
  } else if (vink.state === 'OPEN') {
    actions.push('CANCEL_VINK', 'ADD_PARTICIPANT', 'EDIT_ALLOCATION');
    if (remaining > 0) actions.push('COVER_REMAINING');
  }
  return actions;
}

async function loadOwnedVinkForRead(
  reader: VinkReader,
  vinkId: VinkId,
  actorUserId: string,
): Promise<Vink> {
  const vink = await reader.getVink(vinkId);
  if (vink === null) throw new ApplicationError('VINK_NOT_FOUND', `vink ${vinkId} not found`);
  if (vink.organizerUserId !== actorUserId) {
    // PV3 is the organizer API; participant/guest views arrive with PV4 tokens.
    throw new ApplicationError('FORBIDDEN', 'only the organizer may view this vink');
  }
  return vink;
}

export async function getVinkSnapshot(
  reader: VinkReader,
  vinkId: VinkId,
  actorUserId: string,
): Promise<VinkSnapshot> {
  const vink = await loadOwnedVinkForRead(reader, vinkId, actorUserId);
  const participants = await reader.listParticipants(vinkId);
  const active = participants.filter((participant) => participant.status !== 'REMOVED');
  const card = await reader.getCardByVink(vinkId);
  const obligations = await reader.listRecoveryObligations(vinkId);
  const obligation = obligations.at(-1) ?? null;
  const contributions = await reader.listContributionsByVink(vinkId);
  const latestContributionByParticipant = latestContributionStatusByParticipant(contributions);
  return {
    vink,
    participants,
    unallocatedAmountMinor: unallocatedAmount(vink, active).amountMinor,
    allowedActions: computeAllowedActions(vink, participants),
    contributions: [...latestContributionByParticipant.entries()].map(
      ([participantId, status]) => ({
        participantId,
        status,
      }),
    ),
    contributionProgress: computeContributionProgress(
      vink,
      participants,
      latestContributionByParticipant,
    ),
    card:
      card === null
        ? null
        : {
            status: card.status,
            displayLastFour: card.displayLastFour,
            spendingLimitMinor: card.spendingLimit.amountMinor,
            merchantLocked: card.merchantLockKey !== null,
          },
    recovery:
      obligation === null
        ? null
        : {
            status: obligation.status,
            amountMinor: obligation.amount.amountMinor,
            attemptCount: obligation.attemptCount,
          },
  };
}

export async function getVinkActivity(
  reader: VinkReader,
  vinkId: VinkId,
  actorUserId: string,
): Promise<ActivityEntry[]> {
  await loadOwnedVinkForRead(reader, vinkId, actorUserId);
  return reader.listActivity(vinkId);
}

/** The signed-in organizer's own vinks, newest first (Plan §20 "Vink history"). Unchanged —
 * organizer-only, exactly as originally scoped; `listMyVinksWithRole` below is the additive,
 * participant-inclusive successor (Slice I2), not a replacement. */
export async function listMyVinks(reader: VinkReader, actorUserId: string): Promise<Vink[]> {
  return reader.listVinksByOrganizer(actorUserId);
}

export interface RoleAnnotatedVink {
  vink: Vink;
  /** Never computed per-Vink from organizer-only signals for a `'participant'`-role entry —
   * e.g. `RESTRICTED`'s "needs attention" framing is an organizer-only concern
   * (docs/design/phase-10-implementation-readiness.md §7.4) and stays out of this function's
   * own responsibility; it only answers "organizer or participant," not "does this need your
   * attention," which is Home's own UI-layer classification once wired in. */
  role: 'organizer' | 'participant';
}

/**
 * Phase 3 §1 / Slice I2 — the union of every Vink this user organized and every Vink they
 * merely participate in (as a `Participant.userId` match — never a guest), deduplicated when
 * both apply, newest first. The organizer role always wins when both are true (Phase 10 §7.4:
 * "organizer role always wins for action purposes") — this is the fix for the real gap Phase
 * 2/3 found: `listMyVinks` alone gives a member added by username no in-app discovery path at
 * all, not even passive.
 */
export async function listMyVinksWithRole(
  reader: VinkReader,
  actorUserId: string,
): Promise<RoleAnnotatedVink[]> {
  const [organized, participated] = await Promise.all([
    reader.listVinksByOrganizer(actorUserId),
    reader.listVinksByParticipant(actorUserId),
  ]);
  const byId = new Map<string, RoleAnnotatedVink>();
  for (const vink of organized) {
    byId.set(vink.id, { vink, role: 'organizer' });
  }
  for (const vink of participated) {
    if (!byId.has(vink.id)) {
      byId.set(vink.id, { vink, role: 'participant' });
    }
  }
  return [...byId.values()].sort((a, b) => b.vink.createdAt.localeCompare(a.vink.createdAt));
}
