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

/** Slice I4B (D38) — the organizer's explicit delivery choice for a named guest invite.
 * Never inferred (e.g. from provider availability) — `MANUAL` is a deliberate opt-out, not a
 * fallback. `guestJoinVinkCommand`'s anonymous self-join always stores `MANUAL`: a guest who
 * already has the link they used to join has nothing left to automatically deliver. */
export type GuestDeliveryMode = 'SMS' | 'EMAIL' | 'MANUAL';

/** Guest identity record (identity boundary, Plan §6.1) — token stored hashed, never raw.
 * Slice I4B (D38): `accessTokenHash`/`expiresAt` are null until a token actually exists —
 * true for the lifetime of an SMS/EMAIL-mode guest between invite and dispatch (D14 forbids
 * minting the raw token before the transport request that can immediately use and discard
 * it; MANUAL mode still mints synchronously at invite time, exactly as I4 did, so its hash is
 * never null). */
export interface GuestIdentityRecord {
  id: GuestIdentityId;
  displayName: string;
  accessTokenHash: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Slice I4 (D19/D27) — where an automatic invitation would be sent, captured at
   * invite/join time. Both null when the organizer used the anonymous share-link/QR path
   * instead of naming this guest (manual sharing always stays available regardless). */
  contactDestination: string | null;
  contactMethod: 'EMAIL' | 'SMS' | null;
  /** Slice I4B (D38). */
  deliveryMode: GuestDeliveryMode;
}

/** Slice I4B (D38) — one row `listPendingGuestDeliveries` returns: a guest invited with
 * automatic delivery (SMS/EMAIL) whose token has not been minted yet, i.e. either invited
 * while the vink was still DRAFT (waiting for VINK_OPENED) or a dispatch attempt that never
 * successfully claimed a slot. `contactDestination`/`contactMethod` are guaranteed non-null
 * here — `inviteGuestCommand` refuses to store an SMS/EMAIL-mode guest without them. */
export interface PendingGuestDelivery {
  participantId: Participant['id'];
  guestIdentityId: GuestIdentityId;
  displayName: string;
  contactDestination: string;
  contactMethod: 'EMAIL' | 'SMS';
  allocatedAmountMinor: number;
}

/** A member's own contact info, captured at registration (`users.email`/`users.phone`,
 * migration 0001) — read-only from the vink-domain store's perspective; profile editing is
 * the auth module's own concern (Slice I4). */
export interface UserContactInfo {
  email: string | null;
  phone: string | null;
}

/** Slice I4 — one row per delivery attempt (never a `participants` column: delivery is an
 * infrastructure concern, not domain state, Phase 10 §6). */
export interface InvitationDeliveryInput {
  participantId: Participant['id'];
  status: 'SENT' | 'FAILED';
  method: 'EMAIL' | 'SMS';
  destination: string;
  providerMessageId?: string;
  failureReason?: string;
}

export interface InvitationDeliveryRecord extends InvitationDeliveryInput {
  id: string;
  attemptedAt: string;
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
  /** Slice I4B (D38) — a single guest identity by id, for the resend command's own lookup of
   * its current `deliveryMode`/contact fields. Plain read within the transaction. */
  getGuestIdentity(id: GuestIdentityId): Promise<GuestIdentityRecord | null>;
  /** Slice I4B (D38) — the deferred-mint claim: sets the hash/expiry ONLY if none exists yet
   * (`WHERE access_token_hash IS NULL`), returning whether this call won the claim. Guards
   * against dispatching the same guest twice (e.g. a defensive re-invocation of the
   * VINK_OPENED dispatch loop) without relying solely on the state machine's own one-time
   * `VINK_OPENED` transition to prevent it. */
  claimGuestDeliveryToken(
    guestIdentityId: GuestIdentityId,
    tokenHash: string,
    expiresAt: string,
  ): Promise<boolean>;
  /** Slice I4B (D38) — resend's unconditional overwrite: mints and stores a fresh hash
   * regardless of whether one already exists, deliberately invalidating any prior token
   * (single-slot binding, migration 0002/0003 — there is no way to hold two valid tokens for
   * one guest at once). */
  setGuestDeliveryToken(
    guestIdentityId: GuestIdentityId,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void>;
  /** Slice I5B (D40) — clears a previously-minted token back to null (mode changing away
   * from MANUAL, which is the only mode that ever mints synchronously): the guest becomes
   * inert/unauthenticatable again, exactly the same state a fresh SMS/EMAIL invite starts in
   * (I4B), until a future dispatch or resend mints a new one. */
  clearGuestDeliveryToken(guestIdentityId: GuestIdentityId): Promise<void>;
  /** Slice I5B (D40) — draft-only guest-identity edit: display name, contact destination,
   * contact method, and delivery mode. Deliberately never touches `accessTokenHash`/
   * `expiresAt` — those stay exclusively managed by `claimGuestDeliveryToken`/
   * `setGuestDeliveryToken`/`clearGuestDeliveryToken`, so a display-name-only edit can never
   * accidentally clobber or reveal anything about the token. */
  updateGuestIdentity(guest: GuestIdentityRecord): Promise<void>;
  /** Slice I4 — a member's own captured contact info (`users.email`/`users.phone`), for
   * automatic-delivery destination resolution. `null` if the user doesn't exist (shouldn't
   * happen for a real participant, but the dispatch path treats it as "no contact info,"
   * never throws — manual sharing is always the fallback). */
  getUserContactInfo(userId: string): Promise<UserContactInfo | null>;
  /** Slice I4 — one row per delivery attempt; never blocks or rolls back the caller's own
   * command on failure (Phase 5 §2's locked rule — see `dispatchInvitation` in
   * `packages/application/src/delivery.ts`). */
  insertInvitationDelivery(delivery: InvitationDeliveryInput): Promise<void>;
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
  /** Slice I6 — plain reads for Vink Details' `merchantSettlementDetail`, same relationship
   * to `VinkTx.listPurchaseAuthorizationsForUpdate`/`listSettlementsForUpdate` that
   * `listContributionsByVink` already has to `listContributionsForUpdate`. */
  listPurchaseAuthorizations(vinkId: VinkId): Promise<PurchaseAuthorization[]>;
  listSettlements(vinkId: VinkId): Promise<Settlement[]>;
  listActivity(vinkId: VinkId): Promise<ActivityEntry[]>;
  /** Newest first — the organizer's own vink history (Plan §20 "Vink history"). */
  listVinksByOrganizer(organizerUserId: string): Promise<Vink[]>;
  /** Newest first — every Vink where this user has a JOINED participant row, by `userId`
   * (member or organizer — a `Participant.userId` match, never a guest's `guestIdentityId`).
   * Deliberately overlaps with `listVinksByOrganizer` — the organizer is also a participant
   * of their own Vink (Phase 0 §3) — the caller (`queries.ts`) dedupes and attributes a role,
   * this port method just answers "is this user really a participant here"
   * (docs/design/phase-10-implementation-readiness.md Slice I2). Deliberately `JOINED`-only,
   * not "non-removed" — a still-`INVITED` participant belongs to `listVinksByPendingInvite`
   * instead (Invites feature, 2026-07-23). */
  listVinksByParticipant(userId: string): Promise<Vink[]>;
  /** Newest-invited-first — every Vink where this user has a still-pending (`INVITED`)
   * participant row, not yet accepted or declined. Invites feature (2026-07-23). */
  listVinksByPendingInvite(userId: string): Promise<Vink[]>;
  /** Resolves a guest access-token hash to its participant, or null (expired/unknown). */
  findGuestParticipant(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ participant: Participant; guest: GuestIdentityRecord } | null>;
  /** Slice I4 — every delivery attempt for one participant, newest first (organizer-facing
   * "Sent" / "Couldn't send" row status, Phase 6 §9; supports "Send again" showing history). */
  listInvitationDeliveries(participantId: Participant['id']): Promise<InvitationDeliveryRecord[]>;
  /** Slice I4B (D38) — every guest of this vink invited with automatic delivery (SMS/EMAIL)
   * whose token hasn't been minted yet. The VINK_OPENED transport handler dispatches exactly
   * this list; a guest invited while the vink was still DRAFT sits here until then (D23). */
  listPendingGuestDeliveries(vinkId: VinkId): Promise<PendingGuestDelivery[]>;
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

/** ENG4 Slice 3 ("structured logging") — a minimal, dependency-free logging capability
 * commands and their callers can use, deliberately not the real Pino type: the application
 * layer stays "pure orchestration" (no logging library dependency); `apps/api` supplies a
 * real implementation adapting its Pino/Fastify logger. Optional everywhere, same "omit to
 * get pre-existing behavior" convention as `timers`/`invitesEnabled` — every existing test and
 * internal caller that never sets it is unaffected. */
export interface CommandLogger {
  info(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

export interface CommandContext {
  uow: UnitOfWork;
  clock: Clock;
  /** Authenticated user executing the command. */
  actorUserId: string;
  /** Request/trace correlation id for history rows. */
  correlationId: string;
  timers?: VinkTimers;
  /** New Invites feature (2026-07-23 decision) — when true, `addParticipantCommand` inserts
   * an existing member as `INVITED` (requiring `acceptInviteCommand`) instead of today's
   * immediate `JOINED`. Defaults to false (today's exact behavior) everywhere the flag isn't
   * explicitly threaded in, matching `timers`' own "omit to get pre-existing behavior"
   * convention. */
  invitesEnabled?: boolean;
  /** ENG4 Slice 3. */
  logger?: CommandLogger;
}

/** Context for unauthenticated public commands (guest join) — no actor user exists. */
export interface PublicCommandContext {
  uow: UnitOfWork;
  clock: Clock;
  correlationId: string;
  /** ENG4 Slice 3. */
  logger?: CommandLogger;
}
