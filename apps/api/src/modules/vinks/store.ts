/**
 * PostgreSQL adapter for the application-layer ports. `run` is one transaction; the vink
 * row is locked FOR UPDATE for the transaction's duration (Plan §11), so aggregate write,
 * history row, and outbox event commit atomically (D12).
 */

import type postgres from 'postgres';
import type {
  ActivityEntry,
  OutboxEventInput,
  UnitOfWork,
  VinkReader,
  VinkStateHistoryRow,
  VinkTx,
} from '../../../../../packages/application/src/index.ts';
import type {
  CurrencyCode,
  Participant,
  Vink,
  VinkId,
} from '../../../../../packages/domain/src/index.ts';
import type { Sql } from '../../db/client.ts';

type Row = Record<string, unknown>;

function asMinor(value: unknown, column: string): number {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${column}: unsafe amount ${String(value)}`);
  return parsed;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToVink(row: Row): Vink {
  const currency = row.currency as CurrencyCode;
  return {
    id: row.id as VinkId,
    organizerUserId: row.organizer_user_id as Vink['organizerUserId'],
    publicCode: row.public_code as string,
    currency,
    purchaseCategory: row.purchase_category as Vink['purchaseCategory'],
    paymentPolicy: row.payment_policy as Vink['paymentPolicy'],
    subtotalAmount: { amountMinor: asMinor(row.subtotal_amount_minor, 'subtotal'), currency },
    tipAmount: { amountMinor: asMinor(row.tip_amount_minor, 'tip'), currency },
    maximumAmount: { amountMinor: asMinor(row.maximum_amount_minor, 'maximum'), currency },
    requiredAmount: { amountMinor: asMinor(row.required_amount_minor, 'required'), currency },
    fundedAmount: { amountMinor: asMinor(row.funded_amount_minor, 'funded'), currency },
    state: row.state as Vink['state'],
    submissionDeadline: toIso(row.submission_deadline),
    processingGraceDeadline: toIso(row.processing_grace_deadline),
    merchantLockStatus: row.merchant_lock_status as Vink['merchantLockStatus'],
    version: asMinor(row.version, 'version'),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToParticipant(row: Row): Participant {
  const currency: CurrencyCode = 'USD';
  return {
    id: row.id as Participant['id'],
    vinkId: row.vink_id as VinkId,
    userId: (row.user_id ?? null) as Participant['userId'],
    guestIdentityId: (row.guest_identity_id ?? null) as Participant['guestIdentityId'],
    displayName: row.display_name as string,
    role: row.role as Participant['role'],
    status: row.status as Participant['status'],
    allocatedAmount: { amountMinor: asMinor(row.allocated_amount_minor, 'allocated'), currency },
    maximumApprovedAmount: {
      amountMinor: asMinor(row.maximum_approved_amount_minor, 'maximum_approved'),
      currency,
    },
    joinedAt: toIso(row.joined_at),
    updatedAt: toIso(row.updated_at),
  };
}

class PostgresVinkTx implements VinkTx {
  readonly #sql: postgres.TransactionSql;

  constructor(sql: postgres.TransactionSql) {
    this.#sql = sql;
  }

  async insertVink(vink: Vink): Promise<void> {
    await this.#sql`INSERT INTO vinks (
      id, organizer_user_id, public_code, currency, purchase_category, payment_policy,
      subtotal_amount_minor, tip_amount_minor, maximum_amount_minor, required_amount_minor,
      funded_amount_minor, state, submission_deadline, processing_grace_deadline,
      merchant_lock_status, version, created_at, updated_at
    ) VALUES (
      ${vink.id}, ${vink.organizerUserId}, ${vink.publicCode}, ${vink.currency},
      ${vink.purchaseCategory}, ${vink.paymentPolicy}, ${vink.subtotalAmount.amountMinor},
      ${vink.tipAmount.amountMinor}, ${vink.maximumAmount.amountMinor},
      ${vink.requiredAmount.amountMinor}, ${vink.fundedAmount.amountMinor}, ${vink.state},
      ${vink.submissionDeadline}, ${vink.processingGraceDeadline}, ${vink.merchantLockStatus},
      ${vink.version}, ${vink.createdAt}, ${vink.updatedAt}
    )`;
  }

  async getVinkForUpdate(id: VinkId): Promise<Vink | null> {
    const rows = await this.#sql`SELECT * FROM vinks WHERE id = ${id} FOR UPDATE`;
    return rows.length === 0 ? null : rowToVink(rows[0] as Row);
  }

  async updateVink(vink: Vink): Promise<void> {
    await this.#sql`UPDATE vinks SET
      subtotal_amount_minor = ${vink.subtotalAmount.amountMinor},
      tip_amount_minor = ${vink.tipAmount.amountMinor},
      maximum_amount_minor = ${vink.maximumAmount.amountMinor},
      required_amount_minor = ${vink.requiredAmount.amountMinor},
      funded_amount_minor = ${vink.fundedAmount.amountMinor},
      state = ${vink.state},
      submission_deadline = ${vink.submissionDeadline},
      processing_grace_deadline = ${vink.processingGraceDeadline},
      merchant_lock_status = ${vink.merchantLockStatus},
      version = ${vink.version},
      updated_at = ${vink.updatedAt}
    WHERE id = ${vink.id}`;
  }

  async insertParticipant(participant: Participant): Promise<void> {
    await this.#sql`INSERT INTO participants (
      id, vink_id, user_id, guest_identity_id, display_name, role, status,
      allocated_amount_minor, maximum_approved_amount_minor, joined_at, updated_at
    ) VALUES (
      ${participant.id}, ${participant.vinkId}, ${participant.userId},
      ${participant.guestIdentityId}, ${participant.displayName}, ${participant.role},
      ${participant.status}, ${participant.allocatedAmount.amountMinor},
      ${participant.maximumApprovedAmount.amountMinor}, ${participant.joinedAt},
      ${participant.updatedAt}
    )`;
  }

  async listParticipants(vinkId: VinkId): Promise<Participant[]> {
    const rows = await this.#sql`SELECT * FROM participants
      WHERE vink_id = ${vinkId} ORDER BY joined_at, id`;
    return rows.map((row) => rowToParticipant(row as Row));
  }

  async updateParticipant(participant: Participant): Promise<void> {
    await this.#sql`UPDATE participants SET
      display_name = ${participant.displayName},
      status = ${participant.status},
      allocated_amount_minor = ${participant.allocatedAmount.amountMinor},
      maximum_approved_amount_minor = ${participant.maximumApprovedAmount.amountMinor},
      updated_at = ${participant.updatedAt}
    WHERE id = ${participant.id}`;
  }

  async appendHistory(row: VinkStateHistoryRow): Promise<void> {
    await this.#sql`INSERT INTO vink_state_history
      (vink_id, from_state, event, to_state, actor, correlation_id)
      VALUES (${row.vinkId}, ${row.fromState}, ${row.event}, ${row.toState}, ${row.actor},
              ${row.correlationId})`;
  }

  async insertOutbox(event: OutboxEventInput): Promise<void> {
    await this.#sql`INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
      VALUES (${event.eventType}, ${event.aggregateType}, ${event.aggregateId},
              ${JSON.stringify(event.payload)}::jsonb)`;
  }
}

export class PostgresVinkStore implements UnitOfWork, VinkReader {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async run<T>(fn: (tx: VinkTx) => Promise<T>): Promise<T> {
    return this.#sql.begin(async (tx) => fn(new PostgresVinkTx(tx))) as Promise<T>;
  }

  async getVink(id: VinkId): Promise<Vink | null> {
    const rows = await this.#sql`SELECT * FROM vinks WHERE id = ${id}`;
    return rows.length === 0 ? null : rowToVink(rows[0] as Row);
  }

  async listParticipants(vinkId: VinkId): Promise<Participant[]> {
    const rows = await this.#sql`SELECT * FROM participants
      WHERE vink_id = ${vinkId} ORDER BY joined_at, id`;
    return rows.map((row) => rowToParticipant(row as Row));
  }

  async listActivity(vinkId: VinkId): Promise<ActivityEntry[]> {
    const rows = await this.#sql`
      SELECT 'transition' AS kind, created_at AS at,
             jsonb_build_object('from', from_state, 'event', event, 'to', to_state,
                                'actor', actor, 'correlationId', correlation_id) AS detail
      FROM vink_state_history WHERE vink_id = ${vinkId}
      UNION ALL
      SELECT 'event' AS kind, occurred_at AS at,
             jsonb_build_object('eventType', event_type) || payload AS detail
      FROM outbox_events WHERE aggregate_type = 'vink' AND aggregate_id = ${vinkId}
      ORDER BY at`;
    return rows.map((row) => ({
      kind: (row as Row).kind as ActivityEntry['kind'],
      at: toIso((row as Row).at),
      detail: (row as Row).detail as Record<string, unknown>,
    }));
  }
}
