/**
 * In-memory port implementation for unit tests (and future simulators). NOT transactional —
 * atomicity is the real adapter's responsibility; these tests exercise command logic, the
 * PostgreSQL adapter is exercised by the API integration suite.
 */

import type {
  Contribution,
  Participant,
  PurchaseAuthorization,
  RecoveryObligation,
  Settlement,
  TemporaryCard,
  Vink,
  VinkId,
} from '../../../domain/src/index.ts';
import { assertBalanced } from '../../../ledger/src/index.ts';
import type {
  ActivityEntry,
  ContributionStatusHistoryRow,
  GuestIdentityRecord,
  LedgerPostingInput,
  OutboxEventInput,
  UnitOfWork,
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

  async run<T>(fn: (tx: VinkTx) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async insertVink(vink: Vink): Promise<void> {
    this.vinks.set(vink.id, vink);
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

  async findGuestParticipant(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ participant: Participant; guest: GuestIdentityRecord } | null> {
    for (const guest of this.guests.values()) {
      if (guest.accessTokenHash !== accessTokenHash) continue;
      if (new Date(guest.expiresAt).getTime() <= now.getTime()) return null;
      for (const participant of this.participants.values()) {
        if (participant.guestIdentityId === guest.id) return { participant, guest };
      }
    }
    return null;
  }

  async getVink(id: VinkId): Promise<Vink | null> {
    return this.vinks.get(id) ?? null;
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
