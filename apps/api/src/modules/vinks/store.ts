/**
 * PostgreSQL adapter for the application-layer ports. `run` is one transaction; the vink
 * row is locked FOR UPDATE for the transaction's duration (Plan §11), so aggregate write,
 * history row, and outbox event commit atomically (D12).
 */

import type postgres from 'postgres';
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
} from '../../../../../packages/application/src/index.ts';
import type {
  Contribution,
  CurrencyCode,
  Participant,
  PurchaseAuthorization,
  RecoveryObligation,
  Settlement,
  TemporaryCard,
  Vink,
  VinkId,
} from '../../../../../packages/domain/src/index.ts';
import { assertBalanced } from '../../../../../packages/ledger/src/index.ts';
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

function rowToContribution(row: Row): Contribution {
  const currency: CurrencyCode = 'USD';
  const optional = (value: unknown, column: string) =>
    value === null || value === undefined
      ? null
      : { amountMinor: asMinor(value, column), currency };
  return {
    id: row.id as Contribution['id'],
    vinkId: row.vink_id as VinkId,
    participantId: row.participant_id as Contribution['participantId'],
    attemptNumber: asMinor(row.attempt_number, 'attempt_number'),
    requestedAmount: { amountMinor: asMinor(row.requested_amount_minor, 'requested'), currency },
    authorizedAmount: optional(row.authorized_amount_minor, 'authorized'),
    capturedAmount: optional(row.captured_amount_minor, 'captured'),
    refundedAmount: optional(row.refunded_amount_minor, 'refunded'),
    status: row.status as Contribution['status'],
    providerReference: (row.provider_reference ?? null) as string | null,
    idempotencyKey: row.idempotency_key as string,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToCard(row: Row): TemporaryCard {
  const currency: CurrencyCode = 'USD';
  return {
    id: row.id as TemporaryCard['id'],
    vinkId: row.vink_id as VinkId,
    providerCardId: row.provider_card_id as string,
    displayLastFour: row.display_last_four as string,
    status: row.status as TemporaryCard['status'],
    spendingLimit: { amountMinor: asMinor(row.spending_limit_minor, 'spending_limit'), currency },
    merchantLockKey: (row.merchant_lock_key ?? null) as string | null,
    expiresAt: toIso(row.expires_at),
    issuedAt: toIso(row.issued_at),
    closedAt: row.closed_at === null || row.closed_at === undefined ? null : toIso(row.closed_at),
  };
}

function rowToPurchaseAuthorization(row: Row): PurchaseAuthorization {
  const currency: CurrencyCode = 'USD';
  return {
    id: row.id as PurchaseAuthorization['id'],
    vinkId: row.vink_id as VinkId,
    temporaryCardId: row.temporary_card_id as PurchaseAuthorization['temporaryCardId'],
    providerAuthorizationId: (row.provider_authorization_id ?? null) as string | null,
    merchantName: row.merchant_name as string,
    merchantIdentifier: row.merchant_identifier as string,
    mcc: row.mcc as string,
    requestedAmount: { amountMinor: asMinor(row.requested_amount_minor, 'requested'), currency },
    approvedAmount:
      row.approved_amount_minor === null || row.approved_amount_minor === undefined
        ? null
        : { amountMinor: asMinor(row.approved_amount_minor, 'approved'), currency },
    status: row.status as PurchaseAuthorization['status'],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToSettlement(row: Row): Settlement {
  const currency: CurrencyCode = 'USD';
  return {
    id: row.id as Settlement['id'],
    vinkId: row.vink_id as VinkId,
    authorizationId: row.authorization_id as Settlement['authorizationId'],
    settledAmount: { amountMinor: asMinor(row.settled_amount_minor, 'settled'), currency },
    varianceAmount: { amountMinor: asMinor(row.variance_amount_minor, 'variance'), currency },
    status: row.status as Settlement['status'],
    settledAt: toIso(row.settled_at),
    createdAt: toIso(row.created_at),
  };
}

function rowToRecovery(row: Row): RecoveryObligation {
  const currency: CurrencyCode = 'USD';
  return {
    id: row.id as RecoveryObligation['id'],
    vinkId: row.vink_id as VinkId,
    organizerUserId: row.organizer_user_id as RecoveryObligation['organizerUserId'],
    amount: { amountMinor: asMinor(row.amount_minor, 'amount'), currency },
    reason: row.reason as RecoveryObligation['reason'],
    status: row.status as RecoveryObligation['status'],
    attemptCount: asMinor(row.attempt_count, 'attempt_count'),
    dueAt: toIso(row.due_at),
    resolvedAt:
      row.resolved_at === null || row.resolved_at === undefined ? null : toIso(row.resolved_at),
    createdAt: toIso(row.created_at),
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

  async getVinkByPublicCodeForUpdate(publicCode: string): Promise<Vink | null> {
    const rows = await this.#sql`SELECT * FROM vinks WHERE public_code = ${publicCode} FOR UPDATE`;
    return rows.length === 0 ? null : rowToVink(rows[0] as Row);
  }

  async insertGuestIdentity(guest: GuestIdentityRecord): Promise<void> {
    await this
      .#sql`INSERT INTO guest_identities (id, display_name, access_token_hash, expires_at, created_at)
      VALUES (${guest.id}, ${guest.displayName}, ${guest.accessTokenHash}, ${guest.expiresAt},
              ${guest.createdAt})`;
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

  async insertContribution(contribution: Contribution): Promise<void> {
    await this.#sql`INSERT INTO contributions (
      id, vink_id, participant_id, attempt_number, requested_amount_minor,
      authorized_amount_minor, captured_amount_minor, refunded_amount_minor,
      status, provider_reference, idempotency_key, created_at, updated_at
    ) VALUES (
      ${contribution.id}, ${contribution.vinkId}, ${contribution.participantId},
      ${contribution.attemptNumber}, ${contribution.requestedAmount.amountMinor},
      ${contribution.authorizedAmount?.amountMinor ?? null},
      ${contribution.capturedAmount?.amountMinor ?? null},
      ${contribution.refundedAmount?.amountMinor ?? null},
      ${contribution.status}, ${contribution.providerReference}, ${contribution.idempotencyKey},
      ${contribution.createdAt}, ${contribution.updatedAt}
    )`;
  }

  async listContributionsForUpdate(vinkId: VinkId): Promise<Contribution[]> {
    const rows = await this.#sql`SELECT * FROM contributions
      WHERE vink_id = ${vinkId} ORDER BY created_at, id FOR UPDATE`;
    return rows.map((row) => rowToContribution(row as Row));
  }

  async updateContribution(contribution: Contribution): Promise<void> {
    await this.#sql`UPDATE contributions SET
      authorized_amount_minor = ${contribution.authorizedAmount?.amountMinor ?? null},
      captured_amount_minor = ${contribution.capturedAmount?.amountMinor ?? null},
      refunded_amount_minor = ${contribution.refundedAmount?.amountMinor ?? null},
      status = ${contribution.status},
      provider_reference = ${contribution.providerReference},
      updated_at = ${contribution.updatedAt}
    WHERE id = ${contribution.id}`;
  }

  async appendContributionHistory(row: ContributionStatusHistoryRow): Promise<void> {
    await this.#sql`INSERT INTO contribution_status_history
      (contribution_id, from_status, event, to_status, actor, correlation_id)
      VALUES (${row.contributionId}, ${row.fromStatus}, ${row.event}, ${row.toStatus},
              ${row.actor}, ${row.correlationId})`;
  }

  async insertLedgerPosting(posting: LedgerPostingInput): Promise<void> {
    assertBalanced(posting.entries); // application-side check; the deferred trigger is final
    const inserted = await this.#sql`INSERT INTO ledger_transactions (reference_type, reference_id)
      VALUES (${posting.referenceType}, ${posting.referenceId}) RETURNING id`;
    const transactionId = (inserted[0] as { id: string }).id;
    for (const entry of posting.entries) {
      await this.#sql`INSERT INTO ledger_entries
        (transaction_id, account_id, direction, amount_minor, entry_type)
        SELECT ${transactionId}, id, ${entry.direction}, ${entry.amountMinor}, ${entry.entryType}
        FROM ledger_accounts WHERE code = ${entry.account}`;
    }
  }

  async insertOutbox(event: OutboxEventInput): Promise<void> {
    // sql.json() stores a jsonb OBJECT. Passing JSON.stringify(...) here serialized as a
    // jsonb STRING SCALAR, which turned the activity view's `||` merge into array
    // concatenation (PV3 integration defect #2; see milestone report).
    await this.#sql`INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
      VALUES (${event.eventType}, ${event.aggregateType}, ${event.aggregateId},
              ${this.#sql.json(event.payload as postgres.JSONValue)})`;
  }

  async insertCard(card: TemporaryCard): Promise<void> {
    await this.#sql`INSERT INTO temporary_cards (
      id, vink_id, provider_card_id, display_last_four, status, spending_limit_minor,
      merchant_lock_key, expires_at, issued_at, closed_at
    ) VALUES (
      ${card.id}, ${card.vinkId}, ${card.providerCardId}, ${card.displayLastFour}, ${card.status},
      ${card.spendingLimit.amountMinor}, ${card.merchantLockKey}, ${card.expiresAt},
      ${card.issuedAt}, ${card.closedAt}
    )`;
  }

  async getCardByVinkForUpdate(vinkId: VinkId): Promise<TemporaryCard | null> {
    const rows = await this.#sql`SELECT * FROM temporary_cards
      WHERE vink_id = ${vinkId} AND status <> 'FAILED' FOR UPDATE`;
    return rows.length === 0 ? null : rowToCard(rows[0] as Row);
  }

  async updateCard(card: TemporaryCard): Promise<void> {
    await this.#sql`UPDATE temporary_cards SET
      status = ${card.status}, merchant_lock_key = ${card.merchantLockKey},
      closed_at = ${card.closedAt} WHERE id = ${card.id}`;
  }

  async insertPurchaseAuthorization(authorization: PurchaseAuthorization): Promise<void> {
    await this.#sql`INSERT INTO purchase_authorizations (
      id, vink_id, temporary_card_id, provider_authorization_id, merchant_name,
      merchant_identifier, mcc, requested_amount_minor, approved_amount_minor, status,
      created_at, updated_at
    ) VALUES (
      ${authorization.id}, ${authorization.vinkId}, ${authorization.temporaryCardId},
      ${authorization.providerAuthorizationId}, ${authorization.merchantName},
      ${authorization.merchantIdentifier}, ${authorization.mcc},
      ${authorization.requestedAmount.amountMinor}, ${authorization.approvedAmount?.amountMinor ?? null},
      ${authorization.status}, ${authorization.createdAt}, ${authorization.updatedAt}
    )`;
  }

  async listPurchaseAuthorizationsForUpdate(vinkId: VinkId): Promise<PurchaseAuthorization[]> {
    const rows = await this.#sql`SELECT * FROM purchase_authorizations
      WHERE vink_id = ${vinkId} ORDER BY created_at, id FOR UPDATE`;
    return rows.map((row) => rowToPurchaseAuthorization(row as Row));
  }

  async updatePurchaseAuthorization(authorization: PurchaseAuthorization): Promise<void> {
    await this.#sql`UPDATE purchase_authorizations SET
      status = ${authorization.status},
      approved_amount_minor = ${authorization.approvedAmount?.amountMinor ?? null},
      updated_at = ${authorization.updatedAt} WHERE id = ${authorization.id}`;
  }

  async insertSettlement(settlement: Settlement): Promise<void> {
    await this.#sql`INSERT INTO settlements (
      id, vink_id, authorization_id, settled_amount_minor, variance_amount_minor, status, settled_at
    ) VALUES (
      ${settlement.id}, ${settlement.vinkId}, ${settlement.authorizationId},
      ${settlement.settledAmount.amountMinor}, ${settlement.varianceAmount.amountMinor},
      ${settlement.status}, ${settlement.settledAt}
    )`;
  }

  async listSettlementsForUpdate(vinkId: VinkId): Promise<Settlement[]> {
    const rows = await this.#sql`SELECT * FROM settlements
      WHERE vink_id = ${vinkId} ORDER BY created_at, id FOR UPDATE`;
    return rows.map((row) => rowToSettlement(row as Row));
  }

  async insertRecoveryObligation(obligation: RecoveryObligation): Promise<void> {
    await this.#sql`INSERT INTO recovery_obligations (
      id, vink_id, organizer_user_id, amount_minor, reason, status, attempt_count, due_at,
      resolved_at, created_at
    ) VALUES (
      ${obligation.id}, ${obligation.vinkId}, ${obligation.organizerUserId},
      ${obligation.amount.amountMinor}, ${obligation.reason}, ${obligation.status},
      ${obligation.attemptCount}, ${obligation.dueAt}, ${obligation.resolvedAt}, ${obligation.createdAt}
    )`;
  }

  async listRecoveryObligationsForUpdate(vinkId: VinkId): Promise<RecoveryObligation[]> {
    const rows = await this.#sql`SELECT * FROM recovery_obligations
      WHERE vink_id = ${vinkId} ORDER BY created_at, id FOR UPDATE`;
    return rows.map((row) => rowToRecovery(row as Row));
  }

  async updateRecoveryObligation(obligation: RecoveryObligation): Promise<void> {
    await this.#sql`UPDATE recovery_obligations SET
      status = ${obligation.status}, attempt_count = ${obligation.attemptCount},
      resolved_at = ${obligation.resolvedAt} WHERE id = ${obligation.id}`;
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

  async listVinksByOrganizer(organizerUserId: string): Promise<Vink[]> {
    const rows = await this.#sql`SELECT * FROM vinks
      WHERE organizer_user_id = ${organizerUserId} ORDER BY created_at DESC`;
    return rows.map((row) => rowToVink(row as Row));
  }

  async getVinkByPublicCode(publicCode: string): Promise<Vink | null> {
    const rows = await this.#sql`SELECT * FROM vinks WHERE public_code = ${publicCode}`;
    return rows.length === 0 ? null : rowToVink(rows[0] as Row);
  }

  async findGuestParticipant(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ participant: Participant; guest: GuestIdentityRecord } | null> {
    const rows = await this.#sql`
      SELECT p.*, g.id AS g_id, g.display_name AS g_display_name,
             g.access_token_hash AS g_hash, g.expires_at AS g_expires_at,
             g.created_at AS g_created_at
      FROM guest_identities g
      JOIN participants p ON p.guest_identity_id = g.id
      WHERE g.access_token_hash = ${accessTokenHash} AND g.expires_at > ${now.toISOString()}`;
    const row = rows[0] as Row | undefined;
    if (row === undefined) return null;
    return {
      participant: rowToParticipant(row),
      guest: {
        id: row.g_id as GuestIdentityRecord['id'],
        displayName: row.g_display_name as string,
        accessTokenHash: row.g_hash as string,
        expiresAt: toIso(row.g_expires_at),
        createdAt: toIso(row.g_created_at),
      },
    };
  }

  async listParticipants(vinkId: VinkId): Promise<Participant[]> {
    const rows = await this.#sql`SELECT * FROM participants
      WHERE vink_id = ${vinkId} ORDER BY joined_at, id`;
    return rows.map((row) => rowToParticipant(row as Row));
  }

  async getCardByVink(vinkId: VinkId): Promise<TemporaryCard | null> {
    const rows = await this.#sql`SELECT * FROM temporary_cards
      WHERE vink_id = ${vinkId} AND status <> 'FAILED'`;
    return rows.length === 0 ? null : rowToCard(rows[0] as Row);
  }

  async listRecoveryObligations(vinkId: VinkId): Promise<RecoveryObligation[]> {
    const rows = await this.#sql`SELECT * FROM recovery_obligations
      WHERE vink_id = ${vinkId} ORDER BY created_at, id`;
    return rows.map((row) => rowToRecovery(row as Row));
  }

  // PV13 design correction: the live lobby needs per-participant payment status ("paid" /
  // "processing" / "waiting") — a plain read, unlike listContributionsForUpdate's locked
  // variant used inside command transactions.
  async listContributionsByVink(vinkId: VinkId): Promise<Contribution[]> {
    const rows = await this.#sql`SELECT * FROM contributions
      WHERE vink_id = ${vinkId} ORDER BY created_at, id`;
    return rows.map((row) => rowToContribution(row as Row));
  }

  async listActivity(vinkId: VinkId): Promise<ActivityEntry[]> {
    // Deterministic ordering: timestamp, then kind ('event' < 'transition' — the event that
    // a transition emits sorts before its history row), then per-table insertion sequence.
    // Timestamps alone cannot break ties: rows written in one transaction share now().
    const rows = await this.#sql`
      SELECT 'transition' AS kind, created_at AS at, seq,
             jsonb_build_object('from', from_state, 'event', event, 'to', to_state,
                                'actor', actor, 'correlationId', correlation_id) AS detail
      FROM vink_state_history WHERE vink_id = ${vinkId}
      UNION ALL
      SELECT 'event' AS kind, occurred_at AS at, seq,
             jsonb_build_object('eventType', event_type) || payload AS detail
      FROM outbox_events WHERE aggregate_type = 'vink' AND aggregate_id = ${vinkId}
      ORDER BY at, kind, seq`;
    return rows.map((row) => ({
      kind: (row as Row).kind as ActivityEntry['kind'],
      at: toIso((row as Row).at),
      detail: (row as Row).detail as Record<string, unknown>,
    }));
  }
}
