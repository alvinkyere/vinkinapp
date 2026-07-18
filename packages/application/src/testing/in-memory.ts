/**
 * In-memory port implementation for unit tests (and future simulators). NOT transactional —
 * atomicity is the real adapter's responsibility; these tests exercise command logic, the
 * PostgreSQL adapter is exercised by the API integration suite.
 */

import type { Participant, Vink, VinkId } from '../../../domain/src/index.ts';
import type {
  ActivityEntry,
  OutboxEventInput,
  UnitOfWork,
  VinkReader,
  VinkStateHistoryRow,
  VinkTx,
} from '../ports.ts';

export class InMemoryVinkStore implements VinkTx, VinkReader, UnitOfWork {
  readonly vinks = new Map<string, Vink>();
  readonly participants = new Map<string, Participant>();
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
