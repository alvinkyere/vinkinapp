/**
 * ENG6 Slice 5 — DB-backed correlation lookups. Pure query logic only: reads VinkIn's own
 * tables to build the plain `CorrelationLookup` snapshot `@vinkin/reconciliation`'s `classify`
 * consumes. Never mutates anything here — that boundary is what keeps classification
 * unit-testable without a database and reconciliation itself incapable of "fixing" a
 * discrepancy by construction, not just by convention.
 *
 * Plain functions, not a class: every call takes the `Sql`/`TransactionSql` to run against
 * explicitly, the same pattern `runOutboxPublish` already uses — reconciliation's own
 * transaction (runner.ts) needs every correlation query to run inside the SAME transaction
 * that holds the `webhook_events` row locks, so there is no single `sql` instance to bind at
 * construction time.
 */

import type postgres from 'postgres';
import type { Sql } from '../../db/client.ts';
import { correlationTargetFor } from '../../../../../packages/reconciliation/src/index.ts';
import type {
  CorrelationLookup,
  CorrelationTargetKind,
} from '../../../../../packages/reconciliation/src/index.ts';
import type { ProviderEvent } from '../../../../../packages/payment-provider/src/index.ts';

type Queryable = Sql | postgres.TransactionSql;

interface ContributionRow {
  id: string;
  status: string;
  authorized_amount_minor: string | null;
  captured_amount_minor: string | null;
  refunded_amount_minor: string | null;
}

interface PurchaseAuthorizationRow {
  id: string;
  status: string;
  approved_amount_minor: string | null;
}

interface TemporaryCardRow {
  vink_id: string;
}

interface SettlementRow {
  id: string;
  status: string;
  settled_amount_minor: string;
}

function contributionAmountFor(event: ProviderEvent, row: ContributionRow): number | undefined {
  const raw =
    event.type === 'payment.captured'
      ? row.captured_amount_minor
      : event.type === 'refund.completed'
        ? row.refunded_amount_minor
        : event.type === 'payment.authorized'
          ? row.authorized_amount_minor
          : null;
  return raw !== null && raw !== undefined ? Number(raw) : undefined;
}

async function correlateContribution(
  sql: Queryable,
  event: ProviderEvent,
  targetKind: CorrelationTargetKind,
): Promise<CorrelationLookup> {
  const rows = (await sql`
    SELECT id, status, authorized_amount_minor, captured_amount_minor, refunded_amount_minor
    FROM contributions WHERE provider_reference = ${event.objectId}
  `) as unknown as ContributionRow[];
  const row = rows[0];
  if (row === undefined) return { targetKind, found: false };
  return {
    targetKind,
    found: true,
    entityId: row.id,
    entityStatus: row.status,
    entityAmountMinor: contributionAmountFor(event, row),
  };
}

async function correlatePurchaseAuthorization(
  sql: Queryable,
  event: ProviderEvent,
  targetKind: CorrelationTargetKind,
): Promise<CorrelationLookup> {
  const rows = (await sql`
    SELECT id, status, approved_amount_minor
    FROM purchase_authorizations WHERE provider_authorization_id = ${event.objectId}
  `) as unknown as PurchaseAuthorizationRow[];
  const row = rows[0];
  if (row === undefined) return { targetKind, found: false };
  return {
    targetKind,
    found: true,
    entityId: row.id,
    entityStatus: row.status,
    entityAmountMinor:
      row.approved_amount_minor !== null ? Number(row.approved_amount_minor) : undefined,
  };
}

/** Two-hop: `settlements` carries no direct provider-object column (confirmed in the migration
 * — it correlates to a purchase_authorization, not a provider id), so a card-capture event is
 * traced via its payload's `providerCardId` -> `temporary_cards` -> the vink's own most recent
 * settlement. Both hops missing is a legitimate ORPHANED result, not an error. */
async function correlateSettlement(
  sql: Queryable,
  event: ProviderEvent,
  targetKind: CorrelationTargetKind,
): Promise<CorrelationLookup> {
  const providerCardId = event.payload['providerCardId'];
  if (typeof providerCardId !== 'string') return { targetKind, found: false };

  const cardRows = (await sql`
    SELECT vink_id FROM temporary_cards WHERE provider_card_id = ${providerCardId}
  `) as unknown as TemporaryCardRow[];
  const card = cardRows[0];
  if (card === undefined) return { targetKind, found: false };

  const settlementRows = (await sql`
    SELECT id, status, settled_amount_minor FROM settlements
    WHERE vink_id = ${card.vink_id} ORDER BY created_at DESC LIMIT 1
  `) as unknown as SettlementRow[];
  const settlement = settlementRows[0];
  if (settlement === undefined) return { targetKind, found: false };
  return {
    targetKind,
    found: true,
    entityId: settlement.id,
    entityStatus: settlement.status,
    entityAmountMinor: Number(settlement.settled_amount_minor),
  };
}

export async function correlate(sql: Queryable, event: ProviderEvent): Promise<CorrelationLookup> {
  const targetKind = correlationTargetFor(event.type);
  if (targetKind === 'none') return { targetKind, found: false };
  if (targetKind === 'contribution') return correlateContribution(sql, event, targetKind);
  if (targetKind === 'purchase_authorization') {
    return correlatePurchaseAuthorization(sql, event, targetKind);
  }
  return correlateSettlement(sql, event, targetKind);
}
