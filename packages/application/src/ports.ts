/**
 * Persistence ports. The application layer is pure orchestration; the API provides a
 * PostgreSQL implementation (single transaction, `SELECT … FOR UPDATE`), tests provide an
 * in-memory one. Everything a command writes — aggregate, history, outbox — goes through
 * ONE `UnitOfWork.run` call, which the adapter must make atomic (Plan §11/§12, D12).
 */

import type {
  DomainEventName,
  GuestIdentityId,
  Participant,
  Vink,
  VinkId,
} from '../../domain/src/index.ts';

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
  insertVink(vink: Vink): Promise<void>;
  /** Row-locked read — the adapter must lock the vink row for the transaction's duration. */
  getVinkForUpdate(id: VinkId): Promise<Vink | null>;
  /** Row-locked read by public code (guest join path). */
  getVinkByPublicCodeForUpdate(publicCode: string): Promise<Vink | null>;
  insertGuestIdentity(guest: GuestIdentityRecord): Promise<void>;
  /** Persist the full row; `vink.version` has already been incremented by the command. */
  updateVink(vink: Vink): Promise<void>;
  insertParticipant(participant: Participant): Promise<void>;
  listParticipants(vinkId: VinkId): Promise<Participant[]>;
  updateParticipant(participant: Participant): Promise<void>;
  appendHistory(row: VinkStateHistoryRow): Promise<void>;
  insertOutbox(event: OutboxEventInput): Promise<void>;
}

/** Read-only operations (no locks). */
export interface VinkReader {
  getVink(id: VinkId): Promise<Vink | null>;
  getVinkByPublicCode(publicCode: string): Promise<Vink | null>;
  listParticipants(vinkId: VinkId): Promise<Participant[]>;
  listActivity(vinkId: VinkId): Promise<ActivityEntry[]>;
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

export interface CommandContext {
  uow: UnitOfWork;
  clock: Clock;
  /** Authenticated user executing the command. */
  actorUserId: string;
  /** Request/trace correlation id for history rows. */
  correlationId: string;
}

/** Context for unauthenticated public commands (guest join) — no actor user exists. */
export interface PublicCommandContext {
  uow: UnitOfWork;
  clock: Clock;
  correlationId: string;
}
