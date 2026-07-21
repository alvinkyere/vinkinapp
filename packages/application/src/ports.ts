/**
 * Persistence ports. The application layer is pure orchestration; the API provides a
 * PostgreSQL implementation (single transaction, `SELECT … FOR UPDATE`), tests provide an
 * in-memory one. Everything a command writes — aggregate, history, outbox — goes through
 * ONE `UnitOfWork.run` call, which the adapter must make atomic (Plan §11/§12, D12).
 */

import type {
  Contribution,
  ContributionId,
  DomainEventName,
  GuestIdentityId,
  Participant,
  PurchaseAuthorization,
  RecoveryObligation,
  Settlement,
  TemporaryCard,
  Vink,
  VinkId,
} from '../../domain/src/index.ts';
import type { LedgerEntryInput } from '../../ledger/src/index.ts';

/** Guest identity record (identity boundary, Plan §6.1) — token stored hashed, never raw. */
export interface GuestIdentityRecord {
  id: GuestIdentityId;
  displayName: string;
  accessTokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface VinkStateHistoryRow {
  vinkId: VinkId;
  fromState: string;
  event: string;
  toState: string;
  actor: string;
  correlationId: string;
}

export interface ContributionStatusHistoryRow {
  contributionId: ContributionId;
  fromStatus: string;
  event: string;
  toStatus: string;
  actor: string;
  correlationId: string;
}

export interface LedgerPostingInput {
  referenceType: 'contribution' | 'vink' | 'settlement';
  referenceId: string;
  entries: LedgerEntryInput[];
}

export interface OutboxEventInput {
  eventType: DomainEventName;
  aggregateType: 'vink';
  aggregateId: VinkId;
  payload: Record<string, unknown>;
}

export interface ActivityEntry {
  kind: 'transition' | 'event';
  at: string;
  detail: Record<string, unknown>;
}

/** All operations inside one atomic unit of work. */
export interface VinkTx {
  /** Rejects (adapter throws `CreationIdempotencyRaceError`) if another transaction has
   * already committed a vink for this same (organizer, creation idempotency key) pair. */
  insertVink(vink: Vink): Promise<void>;
  /** For idempotent create-replay (ENG1 #4): a vink this organizer already created with this
   * exact creation idempotency key, if one exists. Plain read — an optimization ahead of the
   * database's own unique constraint, not the guard itself. */
  findVinkByCreationIdempotencyKey(organizerUserId: string, key: string): Promise<Vink | null>;
  /** Row-locked read — the adapter must lock the vink row for the transaction's duration. */
  getVinkForUpdate(id: VinkId): Promise<Vink | null>;
  /** Row-locked read by public code (guest join path). */
  getVinkByPublicCodeForUpdate(publicCode: string): Promise<Vink | null>;
  insertGuestIdentity(guest: GuestIdentityRecord): Promise<void>;
  /** ENG1 #4: records that this (vink, invitation idempotency key) pair was used, atomically
   * with the guest identity/participant it invited. Rejects (adapter throws
   * `InviteIdempotencyRaceError`) if another transaction already claimed the same pair. */
  recordGuestInviteIdempotencyKey(
    vinkId: VinkId,
    key: string,
    participantId: Participant['id'],
  ): Promise<void>;
  /** Plain read — an optimization ahead of the database's own unique constraint, not the
   * guard itself. True if this exact (vink, key) pair was already used for an invite. */
  findGuestInviteIdempotencyKey(vinkId: VinkId, key: string): Promise<boolean>;
  /** Persist the full row; `vink.version` has already been incremented by the command. */
  updateVink(vink: Vink): Promise<void>;
  insertParticipant(participant: Participant): Promise<void>;
  listParticipants(vinkId: VinkId): Promise<Participant[]>;
  updateParticipant(participant: Participant): Promise<void>;
  appendHistory(row: VinkStateHistoryRow): Promise<void>;
  insertOutbox(event: OutboxEventInput): Promise<void>;
  /** Must reject (unique violation) when the participant already has a live contribution. */
  insertContribution(contribution: Contribution): Promise<void>;
  /** All contributions of the vink, row-locked for the transaction (Plan §11). */
  listContributionsForUpdate(vinkId: VinkId): Promise<Contribution[]>;
  updateContribution(contribution: Contribution): Promise<void>;
  appendContributionHistory(row: ContributionStatusHistoryRow): Promise<void>;
  /** Balanced double-entry posting — the adapter's DB constraints are the final guard. */
  insertLedgerPosting(posting: LedgerPostingInput): Promise<void>;
  insertCard(card: TemporaryCard): Promise<void>;
  getCardByVinkForUpdate(vinkId: VinkId): Promise<TemporaryCard | null>;
  updateCard(card: TemporaryCard): Promise<void>;
  insertPurchaseAuthorization(authorization: PurchaseAuthorization): Promise<void>;
  listPurchaseAuthorizationsForUpdate(vinkId: VinkId): Promise<PurchaseAuthorization[]>;
  updatePurchaseAuthorization(authorization: PurchaseAuthorization): Promise<void>;
  insertSettlement(settlement: Settlement): Promise<void>;
  listSettlementsForUpdate(vinkId: VinkId): Promise<Settlement[]>;
  insertRecoveryObligation(obligation: RecoveryObligation): Promise<void>;
  listRecoveryObligationsForUpdate(vinkId: VinkId): Promise<RecoveryObligation[]>;
  updateRecoveryObligation(obligation: RecoveryObligation): Promise<void>;
}

/** Read-only operations (no locks). */
export interface VinkReader {
  getVink(id: VinkId): Promise<Vink | null>;
  getVinkByPublicCode(publicCode: string): Promise<Vink | null>;
  listParticipants(vinkId: VinkId): Promise<Participant[]>;
  getCardByVink(vinkId: VinkId): Promise<TemporaryCard | null>;
  listRecoveryObligations(vinkId: VinkId): Promise<RecoveryObligation[]>;
  /** Plain (unlocked) read — for status projections like the organizer lobby's
   * per-participant "paid / processing / waiting" view; commands use
   * `VinkTx.listContributionsForUpdate` instead. */
  listContributionsByVink(vinkId: VinkId): Promise<Contribution[]>;
  listActivity(vinkId: VinkId): Promise<ActivityEntry[]>;
  /** Newest first — the organizer's own vink history (Plan §20 "Vink history"). */
  listVinksByOrganizer(organizerUserId: string): Promise<Vink[]>;
  /** Newest first — every Vink where this user has a non-removed participant row, by
   * `userId` (member or organizer — a `Participant.userId` match, never a guest's
   * `guestIdentityId`). Deliberately overlaps with `listVinksByOrganizer` — the organizer is
   * also a participant of their own Vink (Phase 0 §3) — the caller (`queries.ts`) dedupes
   * and attributes a role, this port method just answers "is this user a participant here at
   * all" (docs/design/phase-10-implementation-readiness.md Slice I2). */
  listVinksByParticipant(userId: string): Promise<Vink[]>;
  /** Resolves a guest access-token hash to its participant, or null (expired/unknown). */
  findGuestParticipant(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ participant: Participant; guest: GuestIdentityRecord } | null>;
}

export interface UnitOfWork {
  run<T>(fn: (tx: VinkTx) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

/** ENG1 timer semantics: one explicit config surface instead of scattered constants
 * (createVinkCommand/configureVinkCommand). Optional on CommandContext — omitting it (most
 * tests, internal tooling) falls back to defaults that match pre-existing hardcoded
 * behavior exactly; only `apps/api`'s real HTTP context threads real config in. */
export interface VinkTimers {
  /** How long a newly created Vink stays OPEN before its submission deadline, when the
   * caller doesn't supply an explicit `submissionDeadline`. */
  openDurationSeconds: number;
  /** Spec §14: processing-grace window after the submission deadline. */
  processingGraceSeconds: number;
}

export interface CommandContext {
  uow: UnitOfWork;
  clock: Clock;
  /** Authenticated user executing the command. */
  actorUserId: string;
  /** Request/trace correlation id for history rows. */
  correlationId: string;
  timers?: VinkTimers;
}

/** Context for unauthenticated public commands (guest join) — no actor user exists. */
export interface PublicCommandContext {
  uow: UnitOfWork;
  clock: Clock;
  correlationId: string;
}
