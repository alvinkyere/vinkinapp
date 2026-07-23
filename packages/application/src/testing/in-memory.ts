/**
 * In-memory port implementation for unit tests (and future simulators). NOT transactional —
 * atomicity is the real adapter's responsibility; these tests exercise command logic, the
 * PostgreSQL adapter is exercised by the API integration suite.
 */

import type {
  Contribution,
  GuestIdentityId,
  Participant,
  PurchaseAuthorization,
  RecoveryObligation,
  Settlement,
  TemporaryCard,
  Vink,
  VinkId,
} from '../../../domain/src/index.ts';
import { assertBalanced } from '../../../ledger/src/index.ts';
import { CreationIdempotencyRaceError, InviteIdempotencyRaceError } from '../errors.ts';
import type {
  ActivityEntry,
  ContributionStatusHistoryRow,
  GuestIdentityRecord,
  InvitationDeliveryInput,
  InvitationDeliveryRecord,
  LedgerPostingInput,
  OutboxEventInput,
  PendingGuestDelivery,
  UnitOfWork,
  UserContactInfo,
  VinkReader,
  VinkStateHistoryRow,
  VinkTx,
} from '../ports.ts';

export class InMemoryVinkStore implements VinkTx, VinkReader, UnitOfWork {
  readonly vinks = new Map<string, Vink>();
  readonly participants = new Map<string, Participant>();
  readonly guests = new Map<string, GuestIdentityRecord>();
  readonly contributions = new Map<string, Contribution>();
  readonly contributionHistory: ContributionStatusHistoryRow[] = [];
  readonly ledgerPostings: LedgerPostingInput[] = [];
  readonly cards = new Map<string, TemporaryCard>();
  readonly purchaseAuthorizations = new Map<string, PurchaseAuthorization>();
  readonly settlements = new Map<string, Settlement>();
  readonly recoveryObligations = new Map<string, RecoveryObligation>();
  readonly history: VinkStateHistoryRow[] = [];
  readonly outbox: OutboxEventInput[] = [];
  /** Slice I4 — a minimal stand-in for the `users` table's contact columns; tests seed it
   * directly (`store.users.set(userId, {email, phone})`), matching this store's existing
   * convention (`store.contributions`, `store.ledgerPostings`, etc. are all seeded/read the
   * same way). */
  readonly users = new Map<string, UserContactInfo>();
  readonly invitationDeliveries: InvitationDeliveryRecord[] = [];

  async run<T>(fn: (tx: VinkTx) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async insertVink(vink: Vink): Promise<void> {
    // Mimics the DB's unique (organizer_user_id, creation_idempotency_key) index — the same
    // race a concurrent createVinkCommand retry can hit in production.
    for (const existing of this.vinks.values()) {
      if (
        existing.organizerUserId === vink.organizerUserId &&
        existing.creationIdempotencyKey === vink.creationIdempotencyKey
      ) {
        throw new CreationIdempotencyRaceError();
      }
    }
    this.vinks.set(vink.id, vink);
  }

  async findVinkByCreationIdempotencyKey(
    organizerUserId: string,
    key: string,
  ): Promise<Vink | null> {
    for (const vink of this.vinks.values()) {
      if (vink.organizerUserId === organizerUserId && vink.creationIdempotencyKey === key)
        return vink;
    }
    return null;
  }

  async getVinkForUpdate(id: VinkId): Promise<Vink | null> {
    return this.vinks.get(id) ?? null;
  }

  async getVinkByPublicCodeForUpdate(publicCode: string): Promise<Vink | null> {
    return this.getVinkByPublicCode(publicCode);
  }

  async getVinkByPublicCode(publicCode: string): Promise<Vink | null> {
    for (const vink of this.vinks.values()) {
      if (vink.publicCode === publicCode) return vink;
    }
    return null;
  }

  async insertGuestIdentity(guest: GuestIdentityRecord): Promise<void> {
    this.guests.set(guest.id, guest);
  }

  /** Slice I4B (D38). */
  async getGuestIdentity(id: GuestIdentityId): Promise<GuestIdentityRecord | null> {
    return this.guests.get(id) ?? null;
  }

  async claimGuestDeliveryToken(
    guestIdentityId: GuestIdentityId,
    tokenHash: string,
    expiresAt: string,
  ): Promise<boolean> {
    const guest = this.guests.get(guestIdentityId);
    if (guest === undefined || guest.accessTokenHash !== null) return false;
    this.guests.set(guestIdentityId, { ...guest, accessTokenHash: tokenHash, expiresAt });
    return true;
  }

  async setGuestDeliveryToken(
    guestIdentityId: GuestIdentityId,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void> {
    const guest = this.guests.get(guestIdentityId);
    if (guest === undefined) return;
    this.guests.set(guestIdentityId, { ...guest, accessTokenHash: tokenHash, expiresAt });
  }

  /** Slice I5B (D40). */
  async clearGuestDeliveryToken(guestIdentityId: GuestIdentityId): Promise<void> {
    const guest = this.guests.get(guestIdentityId);
    if (guest === undefined) return;
    this.guests.set(guestIdentityId, { ...guest, accessTokenHash: null, expiresAt: null });
  }

  /** Slice I5B (D40). */
  async updateGuestIdentity(guest: GuestIdentityRecord): Promise<void> {
    const existing = this.guests.get(guest.id);
    if (existing === undefined) return;
    this.guests.set(guest.id, {
      ...existing,
      displayName: guest.displayName,
      contactDestination: guest.contactDestination,
      contactMethod: guest.contactMethod,
      deliveryMode: guest.deliveryMode,
    });
  }

  /** Slice I4B (D38). */
  async listPendingGuestDeliveries(vinkId: VinkId): Promise<PendingGuestDelivery[]> {
    const pending: PendingGuestDelivery[] = [];
    for (const participant of this.participants.values()) {
      if (participant.vinkId !== vinkId || participant.status === 'REMOVED') continue;
      if (participant.guestIdentityId === null) continue;
      const guest = this.guests.get(participant.guestIdentityId);
      if (guest === undefined) continue;
      if (guest.deliveryMode === 'MANUAL' || guest.accessTokenHash !== null) continue;
      pending.push({
        participantId: participant.id,
        guestIdentityId: guest.id,
        displayName: guest.displayName,
        contactDestination: guest.contactDestination ?? '',
        contactMethod: (guest.contactMethod ?? 'EMAIL') as 'EMAIL' | 'SMS',
        allocatedAmountMinor: participant.allocatedAmount.amountMinor,
      });
    }
    return pending;
  }

  readonly guestInviteIdempotencyKeys = new Map<string, Participant['id']>();

  async recordGuestInviteIdempotencyKey(
    vinkId: VinkId,
    key: string,
    participantId: Participant['id'],
  ): Promise<void> {
    const composite = `${vinkId}:${key}`;
    if (this.guestInviteIdempotencyKeys.has(composite)) throw new InviteIdempotencyRaceError();
    this.guestInviteIdempotencyKeys.set(composite, participantId);
  }

  async findGuestInviteIdempotencyKey(vinkId: VinkId, key: string): Promise<boolean> {
    return this.guestInviteIdempotencyKeys.has(`${vinkId}:${key}`);
  }

  async getUserContactInfo(userId: string): Promise<UserContactInfo | null> {
    return this.users.get(userId) ?? null;
  }

  async insertInvitationDelivery(delivery: InvitationDeliveryInput): Promise<void> {
    this.invitationDeliveries.push({
      ...delivery,
      id: `delivery-${this.invitationDeliveries.length + 1}`,
      attemptedAt: new Date().toISOString(),
    });
  }

  async listInvitationDeliveries(
    participantId: Participant['id'],
  ): Promise<InvitationDeliveryRecord[]> {
    return this.invitationDeliveries
      .filter((row) => row.participantId === participantId)
      .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  }

  async findGuestParticipant(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ participant: Participant; guest: GuestIdentityRecord } | null> {
    for (const guest of this.guests.values()) {
      if (guest.accessTokenHash !== accessTokenHash) continue;
      // A matched hash is never null (an unminted guest's hash is null and can never equal a
      // real token's hash), so `expiresAt` is guaranteed set alongside it.
      if (new Date(guest.expiresAt as string).getTime() <= now.getTime()) return null;
      for (const participant of this.participants.values()) {
        if (participant.guestIdentityId === guest.id && participant.status !== 'REMOVED') {
          return { participant, guest };
        }
      }
    }
    return null;
  }

  async getVink(id: VinkId): Promise<Vink | null> {
    return this.vinks.get(id) ?? null;
  }

  async listVinksByOrganizer(organizerUserId: string): Promise<Vink[]> {
    return [...this.vinks.values()]
      .filter((vink) => vink.organizerUserId === organizerUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listVinksByParticipant(userId: string): Promise<Vink[]> {
    const vinkIds = new Set<string>();
    for (const participant of this.participants.values()) {
      if (participant.userId === userId && participant.status !== 'REMOVED') {
        vinkIds.add(participant.vinkId);
      }
    }
    return [...vinkIds]
      .map((id) => this.vinks.get(id))
      .filter((vink): vink is Vink => vink !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateVink(vink: Vink): Promise<void> {
    this.vinks.set(vink.id, vink);
  }

  async insertParticipant(participant: Participant): Promise<void> {
    this.participants.set(participant.id, participant);
  }

  async listParticipants(vinkId: VinkId): Promise<Participant[]> {
    return [...this.participants.values()].filter((participant) => participant.vinkId === vinkId);
  }

  async updateParticipant(participant: Participant): Promise<void> {
    this.participants.set(participant.id, participant);
  }

  async appendHistory(row: VinkStateHistoryRow): Promise<void> {
    this.history.push(row);
  }

  async insertOutbox(event: OutboxEventInput): Promise<void> {
    this.outbox.push(event);
  }

  async insertContribution(contribution: Contribution): Promise<void> {
    // Mimic the partial unique index: one live contribution per participant.
    for (const existing of this.contributions.values()) {
      if (
        existing.participantId === contribution.participantId &&
        existing.status !== 'DECLINED' &&
        existing.status !== 'CANCELLED'
      ) {
        throw new Error('unique violation: one live contribution per participant');
      }
    }
    this.contributions.set(contribution.id, contribution);
  }

  async listContributionsForUpdate(vinkId: VinkId): Promise<Contribution[]> {
    return [...this.contributions.values()].filter((row) => row.vinkId === vinkId);
  }

  async updateContribution(contribution: Contribution): Promise<void> {
    this.contributions.set(contribution.id, contribution);
  }

  async appendContributionHistory(row: ContributionStatusHistoryRow): Promise<void> {
    this.contributionHistory.push(row);
  }

  async insertLedgerPosting(posting: LedgerPostingInput): Promise<void> {
    assertBalanced(posting.entries); // mirrors the DB constraint trigger
    this.ledgerPostings.push(posting);
  }

  async insertCard(card: TemporaryCard): Promise<void> {
    for (const existing of this.cards.values()) {
      if (existing.vinkId === card.vinkId) throw new Error('unique violation: one card per vink');
    }
    this.cards.set(card.id, card);
  }

  async getCardByVinkForUpdate(vinkId: VinkId): Promise<TemporaryCard | null> {
    return this.getCardByVink(vinkId);
  }

  async getCardByVink(vinkId: VinkId): Promise<TemporaryCard | null> {
    for (const card of this.cards.values()) {
      if (card.vinkId === vinkId && card.status !== 'FAILED') return card;
    }
    return null;
  }

  async updateCard(card: TemporaryCard): Promise<void> {
    this.cards.set(card.id, card);
  }

  async insertPurchaseAuthorization(authorization: PurchaseAuthorization): Promise<void> {
    this.purchaseAuthorizations.set(authorization.id, authorization);
  }

  async listPurchaseAuthorizationsForUpdate(vinkId: VinkId): Promise<PurchaseAuthorization[]> {
    return [...this.purchaseAuthorizations.values()].filter((row) => row.vinkId === vinkId);
  }

  async updatePurchaseAuthorization(authorization: PurchaseAuthorization): Promise<void> {
    this.purchaseAuthorizations.set(authorization.id, authorization);
  }

  async insertSettlement(settlement: Settlement): Promise<void> {
    this.settlements.set(settlement.id, settlement);
  }

  async listSettlementsForUpdate(vinkId: VinkId): Promise<Settlement[]> {
    return [...this.settlements.values()].filter((row) => row.vinkId === vinkId);
  }

  async insertRecoveryObligation(obligation: RecoveryObligation): Promise<void> {
    this.recoveryObligations.set(obligation.id, obligation);
  }

  async listRecoveryObligationsForUpdate(vinkId: VinkId): Promise<RecoveryObligation[]> {
    return [...this.recoveryObligations.values()].filter((row) => row.vinkId === vinkId);
  }

  async updateRecoveryObligation(obligation: RecoveryObligation): Promise<void> {
    this.recoveryObligations.set(obligation.id, obligation);
  }

  async listRecoveryObligations(vinkId: VinkId): Promise<RecoveryObligation[]> {
    return [...this.recoveryObligations.values()].filter((row) => row.vinkId === vinkId);
  }

  async listContributionsByVink(vinkId: VinkId): Promise<Contribution[]> {
    return [...this.contributions.values()]
      .filter((row) => row.vinkId === vinkId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listActivity(vinkId: VinkId): Promise<ActivityEntry[]> {
    const transitions: ActivityEntry[] = this.history
      .filter((row) => row.vinkId === vinkId)
      .map((row) => ({ kind: 'transition', at: '', detail: { ...row } }));
    const events: ActivityEntry[] = this.outbox
      .filter((event) => event.aggregateId === vinkId)
      .map((event) => ({
        kind: 'event',
        at: '',
        detail: { eventType: event.eventType, ...event.payload },
      }));
    return [...transitions, ...events];
  }
}
