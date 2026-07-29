/**
 * PostgreSQL adapter for the application-layer ports. `run` is one transaction; the vink
 * row is locked FOR UPDATE for the transaction's duration (Plan §11), so aggregate write,
 * history row, and outbox event commit atomically (D12).
 */

import type postgres from 'postgres';
import {
  CreationIdempotencyRaceError,
  InviteIdempotencyRaceError,
  type ActivityEntry,
  type ContributionStatusHistoryRow,
  type GuestIdentityRecord,
  type LedgerPostingInput,
  type OutboxEventInput,
  type PendingGuestDelivery,
  type UnitOfWork,
  type VinkReader,
  type VinkStateHistoryRow,
  type VinkTx,
} from '../../../../../packages/application/src/index.ts';
import type {
  Card,
  CardAssignment,
  CardAssignmentId,
  CardId,
  CardWalletToken,
  Contribution,
  CurrencyCode,
  GuestIdentityId,
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
    purpose: (row.purpose as string | null) ?? null,
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
    creationIdempotencyKey: row.creation_idempotency_key as string,
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
    invitedAt: toIso(row.invited_at),
    joinedAt: row.joined_at === null || row.joined_at === undefined ? null : toIso(row.joined_at),
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

function rowToCardPool(row: Row): Card {
  return {
    id: row.id as Card['id'],
    providerCardId: row.provider_card_id as string,
    displayLastFour: row.display_last_four as string,
    status: row.status as Card['status'],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToCardAssignment(row: Row): CardAssignment {
  const currency: CurrencyCode = 'USD';
  return {
    id: row.id as CardAssignment['id'],
    cardId: row.card_id as CardAssignment['cardId'],
    vinkId: row.vink_id as VinkId,
    status: row.status as CardAssignment['status'],
    provisioningStatus: row.provisioning_status as CardAssignment['provisioningStatus'],
    spendingLimit: { amountMinor: asMinor(row.spending_limit_minor, 'spending_limit'), currency },
    merchantLockKey: (row.merchant_lock_key ?? null) as string | null,
    reservedAt: toIso(row.reserved_at),
    usageWindowExpiresAt: toIso(row.usage_window_expires_at),
    returnedAt:
      row.returned_at === null || row.returned_at === undefined ? null : toIso(row.returned_at),
  };
}

function rowToCardWalletToken(row: Row): CardWalletToken {
  return {
    id: row.id as CardWalletToken['id'],
    cardAssignmentId: row.card_assignment_id as CardWalletToken['cardAssignmentId'],
    providerTokenId: row.provider_token_id as string,
    status: row.status as CardWalletToken['status'],
    provisionedAt: toIso(row.provisioned_at),
    revokedAt:
      row.revoked_at === null || row.revoked_at === undefined ? null : toIso(row.revoked_at),
  };
}

function rowToGuestIdentity(row: Row): GuestIdentityRecord {
  return {
    id: row.g_id as GuestIdentityRecord['id'],
    displayName: row.g_display_name as string,
    accessTokenHash: (row.g_hash as string | null) ?? null,
    expiresAt:
      row.g_expires_at === null || row.g_expires_at === undefined ? null : toIso(row.g_expires_at),
    createdAt: toIso(row.g_created_at),
    contactDestination: (row.g_contact_destination as string | null) ?? null,
    contactMethod: (row.g_contact_method as GuestIdentityRecord['contactMethod']) ?? null,
    deliveryMode: row.g_delivery_mode as GuestIdentityRecord['deliveryMode'],
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
    try {
      await this.#sql`INSERT INTO vinks (
        id, organizer_user_id, public_code, currency, purpose, purchase_category, payment_policy,
        subtotal_amount_minor, tip_amount_minor, maximum_amount_minor, required_amount_minor,
        funded_amount_minor, state, submission_deadline, processing_grace_deadline,
        merchant_lock_status, version, creation_idempotency_key, created_at, updated_at
      ) VALUES (
        ${vink.id}, ${vink.organizerUserId}, ${vink.publicCode}, ${vink.currency}, ${vink.purpose},
        ${vink.purchaseCategory}, ${vink.paymentPolicy}, ${vink.subtotalAmount.amountMinor},
        ${vink.tipAmount.amountMinor}, ${vink.maximumAmount.amountMinor},
        ${vink.requiredAmount.amountMinor}, ${vink.fundedAmount.amountMinor}, ${vink.state},
        ${vink.submissionDeadline}, ${vink.processingGraceDeadline}, ${vink.merchantLockStatus},
        ${vink.version}, ${vink.creationIdempotencyKey}, ${vink.createdAt}, ${vink.updatedAt}
      )`;
    } catch (error) {
      const pgError = error as { code?: string; constraint_name?: string };
      if (
        pgError.code === '23505' &&
        pgError.constraint_name === 'ux_vinks_organizer_creation_key'
      ) {
        throw new CreationIdempotencyRaceError();
      }
      throw error;
    }
  }

  async findVinkByCreationIdempotencyKey(
    organizerUserId: string,
    key: string,
  ): Promise<Vink | null> {
    const rows = await this.#sql`SELECT * FROM vinks
      WHERE organizer_user_id = ${organizerUserId} AND creation_idempotency_key = ${key}`;
    return rows.length === 0 ? null : rowToVink(rows[0] as Row);
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
    await this.#sql`INSERT INTO guest_identities (
        id, display_name, access_token_hash, expires_at, created_at,
        contact_destination, contact_method, delivery_mode
      ) VALUES (
        ${guest.id}, ${guest.displayName}, ${guest.accessTokenHash}, ${guest.expiresAt},
        ${guest.createdAt}, ${guest.contactDestination}, ${guest.contactMethod},
        ${guest.deliveryMode}
      )`;
  }

  /** Slice I4B (D38). */
  async getGuestIdentity(id: GuestIdentityId): Promise<GuestIdentityRecord | null> {
    const rows = await this.#sql`
      SELECT id AS g_id, display_name AS g_display_name, access_token_hash AS g_hash,
             expires_at AS g_expires_at, created_at AS g_created_at,
             contact_destination AS g_contact_destination, contact_method AS g_contact_method,
             delivery_mode AS g_delivery_mode
      FROM guest_identities WHERE id = ${id}`;
    const row = rows[0] as Row | undefined;
    return row === undefined ? null : rowToGuestIdentity(row);
  }

  /** Slice I4B (D38) — conditional claim; `RETURNING id` is empty when the WHERE clause
   * excludes every row (already claimed), so `rows.length > 0` is the actual "did I win"
   * signal, not just "did the statement execute." */
  async claimGuestDeliveryToken(
    guestIdentityId: GuestIdentityId,
    tokenHash: string,
    expiresAt: string,
  ): Promise<boolean> {
    const rows = await this.#sql`
      UPDATE guest_identities SET access_token_hash = ${tokenHash}, expires_at = ${expiresAt}
      WHERE id = ${guestIdentityId} AND access_token_hash IS NULL
      RETURNING id`;
    return rows.length > 0;
  }

  /** Slice I4B (D38) — resend's unconditional overwrite. */
  async setGuestDeliveryToken(
    guestIdentityId: GuestIdentityId,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void> {
    await this.#sql`
      UPDATE guest_identities SET access_token_hash = ${tokenHash}, expires_at = ${expiresAt}
      WHERE id = ${guestIdentityId}`;
  }

  /** Slice I5B (D40). */
  async clearGuestDeliveryToken(guestIdentityId: GuestIdentityId): Promise<void> {
    await this.#sql`
      UPDATE guest_identities SET access_token_hash = NULL, expires_at = NULL
      WHERE id = ${guestIdentityId}`;
  }

  /** Slice I5B (D40) — never touches access_token_hash/expires_at, see the port doc comment. */
  async updateGuestIdentity(guest: GuestIdentityRecord): Promise<void> {
    await this.#sql`
      UPDATE guest_identities SET
        display_name = ${guest.displayName},
        contact_destination = ${guest.contactDestination},
        contact_method = ${guest.contactMethod},
        delivery_mode = ${guest.deliveryMode}
      WHERE id = ${guest.id}`;
  }

  /** Slice I4 — a member's own `users.email`/`users.phone` (migration 0001), for automatic-
   * delivery destination resolution. Reads outside the vink-domain tables this store
   * otherwise touches, same precedent as the existing username lookup in
   * `apps/api/src/modules/vinks/routes.ts` (also a direct `users` read via the shared `sql`
   * connection, not routed through a separate port). */
  async getUserContactInfo(
    userId: string,
  ): Promise<{ email: string | null; phone: string | null } | null> {
    const rows = await this.#sql`SELECT email, phone FROM users WHERE id = ${userId}`;
    const row = rows[0] as { email: string | null; phone: string | null } | undefined;
    return row === undefined ? null : { email: row.email, phone: row.phone };
  }

  async insertInvitationDelivery(delivery: {
    participantId: Participant['id'];
    status: 'SENT' | 'FAILED';
    method: 'EMAIL' | 'SMS';
    destination: string;
    providerMessageId?: string;
    failureReason?: string;
  }): Promise<void> {
    await this.#sql`INSERT INTO invitation_deliveries (
      participant_id, status, method, destination, provider_message_id, failure_reason
    ) VALUES (
      ${delivery.participantId}, ${delivery.status}, ${delivery.method}, ${delivery.destination},
      ${delivery.providerMessageId ?? null}, ${delivery.failureReason ?? null}
    )`;
  }

  async recordGuestInviteIdempotencyKey(
    vinkId: VinkId,
    key: string,
    participantId: Participant['id'],
  ): Promise<void> {
    try {
      await this
        .#sql`INSERT INTO guest_invite_idempotency (vink_id, idempotency_key, participant_id)
        VALUES (${vinkId}, ${key}, ${participantId})`;
    } catch (error) {
      const pgError = error as { code?: string };
      // Unique violation on the (vink_id, idempotency_key) primary key: this pair was
      // already claimed by a concurrent request — a genuine race, not a bug.
      if (pgError.code === '23505') throw new InviteIdempotencyRaceError();
      throw error;
    }
  }

  async findGuestInviteIdempotencyKey(vinkId: VinkId, key: string): Promise<boolean> {
    const rows = await this.#sql`SELECT 1 FROM guest_invite_idempotency
      WHERE vink_id = ${vinkId} AND idempotency_key = ${key}`;
    return rows.length > 0;
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
      allocated_amount_minor, maximum_approved_amount_minor, invited_at, joined_at, updated_at
    ) VALUES (
      ${participant.id}, ${participant.vinkId}, ${participant.userId},
      ${participant.guestIdentityId}, ${participant.displayName}, ${participant.role},
      ${participant.status}, ${participant.allocatedAmount.amountMinor},
      ${participant.maximumApprovedAmount.amountMinor}, ${participant.invitedAt},
      ${participant.joinedAt}, ${participant.updatedAt}
    )`;
  }

  async listParticipants(vinkId: VinkId): Promise<Participant[]> {
    const rows = await this.#sql`SELECT * FROM participants
      WHERE vink_id = ${vinkId} ORDER BY invited_at, id`;
    return rows.map((row) => rowToParticipant(row as Row));
  }

  async updateParticipant(participant: Participant): Promise<void> {
    await this.#sql`UPDATE participants SET
      display_name = ${participant.displayName},
      status = ${participant.status},
      allocated_amount_minor = ${participant.allocatedAmount.amountMinor},
      maximum_approved_amount_minor = ${participant.maximumApprovedAmount.amountMinor},
      joined_at = ${participant.joinedAt},
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
      (contribution_id, from_status, event, to_status, actor, correlation_id, provider_reference)
      VALUES (${row.contributionId}, ${row.fromStatus}, ${row.event}, ${row.toStatus},
              ${row.actor}, ${row.correlationId}, ${row.providerReference ?? null})`;
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

  // -------------------------------------------------------------------------------------
  // RM1 (D47) — the reusable card pool.
  // -------------------------------------------------------------------------------------

  async reserveAvailableCard(): Promise<Card | null> {
    // FOR UPDATE SKIP LOCKED — the same idiom `outbox-publisher.ts`/the reconciliation
    // runner already use for concurrent-safe claiming: two simultaneous reservations each
    // lock a DIFFERENT available row instead of one blocking on the other.
    const rows = await this.#sql`SELECT * FROM cards
      WHERE status = 'AVAILABLE' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    return rows.length === 0 ? null : rowToCardPool(rows[0] as Row);
  }

  async getCard(id: CardId): Promise<Card | null> {
    const rows = await this.#sql`SELECT * FROM cards WHERE id = ${id}`;
    return rows.length === 0 ? null : rowToCardPool(rows[0] as Row);
  }

  async insertCardAssignment(assignment: CardAssignment): Promise<void> {
    await this.#sql`INSERT INTO card_assignments (
      id, card_id, vink_id, status, provisioning_status, spending_limit_minor,
      merchant_lock_key, reserved_at, usage_window_expires_at, returned_at
    ) VALUES (
      ${assignment.id}, ${assignment.cardId}, ${assignment.vinkId}, ${assignment.status},
      ${assignment.provisioningStatus}, ${assignment.spendingLimit.amountMinor},
      ${assignment.merchantLockKey}, ${assignment.reservedAt},
      ${assignment.usageWindowExpiresAt}, ${assignment.returnedAt}
    )`;
    await this.#sql`UPDATE cards SET status = 'RESERVED', updated_at = now()
      WHERE id = ${assignment.cardId}`;
  }

  async getCardAssignmentForVink(vinkId: VinkId): Promise<CardAssignment | null> {
    const rows = await this.#sql`SELECT * FROM card_assignments WHERE vink_id = ${vinkId}`;
    return rows.length === 0 ? null : rowToCardAssignment(rows[0] as Row);
  }

  async getCardAssignmentForUpdate(id: CardAssignmentId): Promise<CardAssignment | null> {
    const rows = await this.#sql`SELECT * FROM card_assignments WHERE id = ${id} FOR UPDATE`;
    return rows.length === 0 ? null : rowToCardAssignment(rows[0] as Row);
  }

  async updateCardAssignment(assignment: CardAssignment): Promise<void> {
    await this.#sql`UPDATE card_assignments SET
      status = ${assignment.status}, provisioning_status = ${assignment.provisioningStatus},
      merchant_lock_key = ${assignment.merchantLockKey},
      returned_at = ${assignment.returnedAt} WHERE id = ${assignment.id}`;
  }

  async releaseCardToPool(cardId: CardId): Promise<void> {
    await this.#sql`UPDATE cards SET status = 'AVAILABLE', updated_at = now()
      WHERE id = ${cardId}`;
  }

  async quarantineCard(cardId: CardId): Promise<void> {
    await this.#sql`UPDATE cards SET status = 'QUARANTINED', updated_at = now()
      WHERE id = ${cardId}`;
  }

  async insertCardWalletToken(token: CardWalletToken): Promise<void> {
    await this.#sql`INSERT INTO card_wallet_tokens (
      id, card_assignment_id, provider_token_id, status, provisioned_at, revoked_at
    ) VALUES (
      ${token.id}, ${token.cardAssignmentId}, ${token.providerTokenId}, ${token.status},
      ${token.provisionedAt}, ${token.revokedAt}
    )`;
  }

  async getCardWalletTokenForAssignment(
    assignmentId: CardAssignmentId,
  ): Promise<CardWalletToken | null> {
    const rows = await this.#sql`SELECT * FROM card_wallet_tokens
      WHERE card_assignment_id = ${assignmentId}`;
    return rows.length === 0 ? null : rowToCardWalletToken(rows[0] as Row);
  }

  async updateCardWalletToken(token: CardWalletToken): Promise<void> {
    await this.#sql`UPDATE card_wallet_tokens SET
      status = ${token.status}, revoked_at = ${token.revokedAt} WHERE id = ${token.id}`;
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

  /** Slice I2 (docs/design/phase-10-implementation-readiness.md) — every Vink where this
   * user has a JOINED participant row, by `user_id` (never a guest's `guest_identity_id`).
   * `DISTINCT` guards against the (not expected, but not worth assuming away) case of more
   * than one live participant row for the same (vink, user) pair.
   *
   * Invites feature (2026-07-23): deliberately `status = 'JOINED'`, not `!= 'REMOVED'` — a
   * still-`INVITED` (not yet accepted) participant must NOT appear in Home/Activity's normal
   * "my vinks" list; see `listVinksByPendingInvite` for that separate surface. */
  async listVinksByParticipant(userId: string): Promise<Vink[]> {
    const rows = await this.#sql`
      SELECT DISTINCT v.* FROM vinks v
      JOIN participants p ON p.vink_id = v.id
      WHERE p.user_id = ${userId} AND p.status = 'JOINED'
      ORDER BY v.created_at DESC`;
    return rows.map((row) => rowToVink(row as Row));
  }

  /** Invites feature (2026-07-23) — every Vink where this user has a still-pending
   * (`INVITED`, not yet accepted or declined) participant row. The counterpart surface to
   * `listVinksByParticipant` above, kept as a genuinely separate query rather than a `role`
   * value threaded through it — an invite and a real membership are different invariants for
   * every caller (Home, Activity) that already assumes "in this list" means "really in it." */
  async listVinksByPendingInvite(userId: string): Promise<Vink[]> {
    // Postgres requires every `SELECT DISTINCT` ORDER BY expression to appear in the select
    // list — `p.invited_at` is included for exactly that reason (`rowToVink` reads its own
    // named columns and ignores the extra one, same as every other enriched-select in this
    // file).
    const rows = await this.#sql`
      SELECT DISTINCT v.*, p.invited_at FROM vinks v
      JOIN participants p ON p.vink_id = v.id
      WHERE p.user_id = ${userId} AND p.status = 'INVITED'
      ORDER BY p.invited_at DESC`;
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
             g.created_at AS g_created_at, g.contact_destination AS g_contact_destination,
             g.contact_method AS g_contact_method, g.delivery_mode AS g_delivery_mode
      FROM guest_identities g
      JOIN participants p ON p.guest_identity_id = g.id
      WHERE g.access_token_hash = ${accessTokenHash} AND g.expires_at > ${now.toISOString()}
        AND p.status != 'REMOVED'`;
    const row = rows[0] as Row | undefined;
    if (row === undefined) return null;
    return { participant: rowToParticipant(row), guest: rowToGuestIdentity(row) };
  }

  /** Slice I4B (D38) — every SMS/EMAIL-mode guest of this vink still awaiting a token mint. */
  async listPendingGuestDeliveries(vinkId: VinkId): Promise<PendingGuestDelivery[]> {
    const rows = await this.#sql`
      SELECT p.id AS participant_id, g.id AS guest_id, g.display_name,
             g.contact_destination, g.contact_method, p.allocated_amount_minor
      FROM guest_identities g
      JOIN participants p ON p.guest_identity_id = g.id
      WHERE p.vink_id = ${vinkId} AND p.status != 'REMOVED'
        AND g.delivery_mode IN ('SMS', 'EMAIL') AND g.access_token_hash IS NULL
      ORDER BY p.joined_at, p.id`;
    return rows.map((raw) => {
      const row = raw as Row;
      return {
        participantId: row.participant_id as Participant['id'],
        guestIdentityId: row.guest_id as PendingGuestDelivery['guestIdentityId'],
        displayName: row.display_name as string,
        contactDestination: row.contact_destination as string,
        contactMethod: row.contact_method as 'EMAIL' | 'SMS',
        allocatedAmountMinor: asMinor(row.allocated_amount_minor, 'allocated'),
      };
    });
  }

  async listParticipants(vinkId: VinkId): Promise<Participant[]> {
    const rows = await this.#sql`SELECT * FROM participants
      WHERE vink_id = ${vinkId} ORDER BY invited_at, id`;
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

  /** Slice I6 — plain read counterparts to `listPurchaseAuthorizationsForUpdate`/
   * `listSettlementsForUpdate` above (`PostgresVinkTx`), same pattern as
   * `listContributionsByVink`'s own relationship to `listContributionsForUpdate`: Vink
   * Details is a read-only historical view, never a command, so it never needs the row lock. */
  async listPurchaseAuthorizations(vinkId: VinkId): Promise<PurchaseAuthorization[]> {
    const rows = await this.#sql`SELECT * FROM purchase_authorizations
      WHERE vink_id = ${vinkId} ORDER BY created_at, id`;
    return rows.map((row) => rowToPurchaseAuthorization(row as Row));
  }

  async listSettlements(vinkId: VinkId): Promise<Settlement[]> {
    const rows = await this.#sql`SELECT * FROM settlements
      WHERE vink_id = ${vinkId} ORDER BY created_at, id`;
    return rows.map((row) => rowToSettlement(row as Row));
  }

  /** Slice I4 — newest first (organizer-facing "Sent" / "Couldn't send" row status). */
  async listInvitationDeliveries(participantId: Participant['id']): Promise<
    Array<{
      id: string;
      participantId: Participant['id'];
      status: 'SENT' | 'FAILED';
      method: 'EMAIL' | 'SMS';
      destination: string;
      providerMessageId?: string;
      failureReason?: string;
      attemptedAt: string;
    }>
  > {
    const rows = await this.#sql`SELECT * FROM invitation_deliveries
      WHERE participant_id = ${participantId} ORDER BY attempted_at DESC`;
    return rows.map((raw) => {
      const row = raw as Row;
      return {
        id: row.id as string,
        participantId: row.participant_id as Participant['id'],
        status: row.status as 'SENT' | 'FAILED',
        method: row.method as 'EMAIL' | 'SMS',
        destination: row.destination as string,
        ...(row.provider_message_id !== null && {
          providerMessageId: row.provider_message_id as string,
        }),
        ...(row.failure_reason !== null && { failureReason: row.failure_reason as string }),
        attemptedAt: toIso(row.attempted_at),
      };
    });
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
