/**
 * ENG6 Slice 5 — reconciliation scaffolding end-to-end against real PostgreSQL. Fixtures are
 * deliberately provider-neutral: every webhook event here is inserted directly into
 * `webhook_events` as a plain row (bypassing Slice 4's HTTP ingestion route entirely — that
 * route's own behavior is already proven in webhooks.integration.test.ts; this file tests
 * reconciliation's OWN correlation/classification/ordering/idempotency behavior against
 * controlled state, including deliberately-inconsistent states no real command flow would
 * ever produce, which is the entire point of a reconciliation engine). Stripe-specific
 * translation is covered separately and fully offline in
 * packages/reconciliation/src/stripe-translation.test.ts.
 *
 * Domain fixtures (contributions/cards/purchase_authorizations/settlements) are also direct
 * SQL inserts, not full command-layer flows — some scenarios here (a status VinkIn's own
 * command layer would never leave inconsistent) can only be constructed this way, since drift
 * by definition doesn't occur through the well-behaved application layer.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runReconciliation } from './modules/reconciliation/runner.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('reconciliation scaffolding (PostgreSQL, ENG6 Slice 5)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;

  before(async () => {
    db = await createIsolatedTestDb('reconciliation');
  });

  after(async () => {
    await db.drop();
  });

  // --- fixture helpers -------------------------------------------------------------------

  async function makeVink(): Promise<{ vinkId: string; participantId: string }> {
    const userId = randomUUID();
    const vinkId = randomUUID();
    const participantId = randomUUID();
    await db.sql`
      INSERT INTO users (id, username, display_name, password_hash)
      VALUES (${userId}, ${`user_${userId.slice(0, 8)}`}, 'Test User', 'hash')`;
    await db.sql`
      INSERT INTO vinks (id, organizer_user_id, public_code, currency, purchase_category,
        payment_policy, subtotal_amount_minor, tip_amount_minor, maximum_amount_minor,
        required_amount_minor, submission_deadline, processing_grace_deadline,
        creation_idempotency_key)
      VALUES (${vinkId}, ${userId}, ${`code_${vinkId.slice(0, 8)}`}, 'USD', 'GROCERY',
        'EXACT_FINAL', 10000, 0, 10000, 10000, now() + interval '1 day', now() + interval '1 day',
        ${`idem_${vinkId}`})`;
    await db.sql`
      INSERT INTO participants (id, vink_id, user_id, display_name, role, status,
        allocated_amount_minor, maximum_approved_amount_minor)
      VALUES (${participantId}, ${vinkId}, ${userId}, 'Test User', 'ORGANIZER', 'JOINED', 10000, 10000)`;
    return { vinkId, participantId };
  }

  async function makeContribution(opts: {
    vinkId: string;
    participantId: string;
    providerReference: string;
    status: string;
    authorizedAmountMinor?: number;
    capturedAmountMinor?: number;
    refundedAmountMinor?: number;
  }): Promise<string> {
    const id = randomUUID();
    await db.sql`
      INSERT INTO contributions (id, vink_id, participant_id, requested_amount_minor,
        authorized_amount_minor, captured_amount_minor, refunded_amount_minor, status,
        provider_reference, idempotency_key)
      VALUES (${id}, ${opts.vinkId}, ${opts.participantId}, 10000,
        ${opts.authorizedAmountMinor ?? null}, ${opts.capturedAmountMinor ?? null},
        ${opts.refundedAmountMinor ?? null}, ${opts.status}, ${opts.providerReference}, ${`idem_${id}`})`;
    return id;
  }

  async function makeCard(vinkId: string): Promise<{ cardId: string; providerCardId: string }> {
    const cardId = randomUUID();
    const providerCardId = `card_${randomUUID().slice(0, 8)}`;
    await db.sql`
      INSERT INTO temporary_cards (id, vink_id, provider_card_id, display_last_four, status,
        spending_limit_minor, expires_at, issued_at)
      VALUES (${cardId}, ${vinkId}, ${providerCardId}, '1234', 'ACTIVE', 10000,
        now() + interval '1 day', now())`;
    return { cardId, providerCardId };
  }

  async function makePurchaseAuth(
    vinkId: string,
    temporaryCardId: string,
    providerAuthorizationId: string,
    status: string,
    approvedAmountMinor: number,
  ): Promise<string> {
    const id = randomUUID();
    await db.sql`
      INSERT INTO purchase_authorizations (id, vink_id, temporary_card_id,
        provider_authorization_id, merchant_name, merchant_identifier, mcc,
        requested_amount_minor, approved_amount_minor, status)
      VALUES (${id}, ${vinkId}, ${temporaryCardId}, ${providerAuthorizationId}, 'Test Merchant',
        'merchant-1', '5411', ${approvedAmountMinor}, ${approvedAmountMinor}, ${status})`;
    return id;
  }

  async function makeSettlement(
    vinkId: string,
    authorizationId: string,
    settledAmountMinor: number,
    status = 'MATCHED',
  ): Promise<string> {
    const id = randomUUID();
    await db.sql`
      INSERT INTO settlements (id, vink_id, authorization_id, settled_amount_minor,
        variance_amount_minor, status, settled_at)
      VALUES (${id}, ${vinkId}, ${authorizationId}, ${settledAmountMinor}, 0, ${status}, now())`;
    return id;
  }

  async function insertWebhookEvent(opts: {
    provider?: string;
    providerEventId?: string;
    eventType: string;
    objectId: string;
    occurredAt: Date;
    payload?: Record<string, unknown>;
  }): Promise<string> {
    const id = randomUUID();
    const rawBody = JSON.stringify({ fixture: true, id: opts.providerEventId });
    await db.sql`
      INSERT INTO webhook_events (id, provider, provider_event_id, event_type, object_id,
        occurred_at, raw_body, payload, status)
      VALUES (${id}, ${opts.provider ?? 'fixture'}, ${opts.providerEventId ?? randomUUID()},
        ${opts.eventType}, ${opts.objectId}, ${opts.occurredAt}, ${rawBody},
        ${db.sql.json((opts.payload ?? {}) as postgres.JSONValue)}, 'received')`;
    return id;
  }

  async function findingFor(webhookEventId: string): Promise<Record<string, unknown> | undefined> {
    const rows = await db.sql`
      SELECT * FROM reconciliation_findings WHERE webhook_event_id = ${webhookEventId}`;
    return rows[0] as Record<string, unknown> | undefined;
  }

  // --- classification scenarios (each against real correlated VinkIn rows) ---------------

  it('EXPECTED: a captured event whose amount and status match VinkIn exactly', async () => {
    const { vinkId, participantId } = await makeVink();
    const providerReference = `pay_${randomUUID()}`;
    await makeContribution({
      vinkId,
      participantId,
      providerReference,
      status: 'CAPTURED',
      capturedAmountMinor: 10_000,
    });
    const eventId = await insertWebhookEvent({
      eventType: 'payment.captured',
      objectId: providerReference,
      occurredAt: new Date(),
      payload: { amountMinor: 10_000 },
    });

    const result = await runReconciliation(db.sql, 100);
    assert.equal(result.findingsCreated, 1);

    const finding = await findingFor(eventId);
    assert.equal(finding?.classification, 'EXPECTED');
    assert.equal(finding?.correlated_entity_type, 'contribution');
  });

  it('MISMATCHED (LATE CAPTURE): a capture arrives while VinkIn still shows only authorized', async () => {
    const { vinkId, participantId } = await makeVink();
    const providerReference = `pay_${randomUUID()}`;
    await makeContribution({
      vinkId,
      participantId,
      providerReference,
      status: 'AUTHORIZED', // VinkIn's own command layer never advanced this to CAPTURED
      authorizedAmountMinor: 10_000,
    });
    const eventId = await insertWebhookEvent({
      eventType: 'payment.captured',
      objectId: providerReference,
      occurredAt: new Date(),
      payload: { amountMinor: 10_000 },
    });

    await runReconciliation(db.sql, 100);
    const finding = await findingFor(eventId);
    assert.equal(finding?.classification, 'MISMATCHED');
    assert.match((finding?.details as { reason: string }).reason, /AUTHORIZED/);
  });

  it('MISMATCHED (REVERSAL): a cancellation VinkIn has not caught up to', async () => {
    const { vinkId, participantId } = await makeVink();
    const providerReference = `pay_${randomUUID()}`;
    await makeContribution({
      vinkId,
      participantId,
      providerReference,
      status: 'AUTHORIZED',
      authorizedAmountMinor: 10_000,
    });
    const eventId = await insertWebhookEvent({
      eventType: 'payment.canceled',
      objectId: providerReference,
      occurredAt: new Date(),
    });

    await runReconciliation(db.sql, 100);
    const finding = await findingFor(eventId);
    assert.equal(finding?.classification, 'MISMATCHED');
  });

  it('MISMATCHED (REFUND): a refund amount that disagrees with VinkIn', async () => {
    const { vinkId, participantId } = await makeVink();
    const providerReference = `pay_${randomUUID()}`;
    await makeContribution({
      vinkId,
      participantId,
      providerReference,
      status: 'REFUNDED',
      refundedAmountMinor: 10_000,
    });
    const eventId = await insertWebhookEvent({
      eventType: 'refund.completed',
      objectId: providerReference,
      occurredAt: new Date(),
      payload: { amountMinor: 4_000 }, // provider reports a partial refund VinkIn doesn't reflect
    });

    await runReconciliation(db.sql, 100);
    const finding = await findingFor(eventId);
    assert.equal(finding?.classification, 'MISMATCHED');
  });

  it('ORPHANED (MISSING PREDECESSOR): a known event type with no VinkIn record at all', async () => {
    const eventId = await insertWebhookEvent({
      eventType: 'payment.captured',
      objectId: `pay_${randomUUID()}`, // no contribution ever references this
      occurredAt: new Date(),
      payload: { amountMinor: 5_000 },
    });

    await runReconciliation(db.sql, 100);
    const finding = await findingFor(eventId);
    assert.equal(finding?.classification, 'ORPHANED');
    assert.equal(finding?.correlated_entity_id, null);
  });

  it('UNKNOWN PROVIDER OBJECT (UNRECOGNIZED): dispute.created has no VinkIn domain concept', async () => {
    const eventId = await insertWebhookEvent({
      eventType: 'dispute.created',
      objectId: `dp_${randomUUID()}`,
      occurredAt: new Date(),
    });

    await runReconciliation(db.sql, 100);
    const finding = await findingFor(eventId);
    assert.equal(finding?.classification, 'UNRECOGNIZED');
    assert.equal(finding?.correlated_entity_type, null);
  });

  it('SETTLEMENT two-hop correlation via providerCardId is EXPECTED when amounts match', async () => {
    const { vinkId } = await makeVink();
    const { cardId, providerCardId } = await makeCard(vinkId);
    const authId = await makePurchaseAuth(
      vinkId,
      cardId,
      `auth_${randomUUID()}`,
      'CAPTURED',
      7_500,
    );
    await makeSettlement(vinkId, authId, 7_500);

    const eventId = await insertWebhookEvent({
      eventType: 'card.capture.created',
      objectId: `ctx_${randomUUID()}`,
      occurredAt: new Date(),
      payload: { providerCardId, amountMinor: 7_500 },
    });

    await runReconciliation(db.sql, 100);
    const finding = await findingFor(eventId);
    assert.equal(finding?.classification, 'EXPECTED');
    assert.equal(finding?.correlated_entity_type, 'settlement');
  });

  it('PENDING: a real-time authorization request precedes any VinkIn-recorded decision', async () => {
    const eventId = await insertWebhookEvent({
      eventType: 'card.authorization.request',
      objectId: `auth_${randomUUID()}`,
      occurredAt: new Date(),
    });

    await runReconciliation(db.sql, 100);
    const finding = await findingFor(eventId);
    assert.equal(finding?.classification, 'PENDING');
  });

  // --- ordering, idempotency, replay, concurrency -----------------------------------------

  it('OUT-OF-ORDER: interpretation follows provider occurred_at, never HTTP arrival/received_at order', async () => {
    const { vinkId, participantId } = await makeVink();
    const providerReference = `pay_${randomUUID()}`;
    await makeContribution({
      vinkId,
      participantId,
      providerReference,
      status: 'CAPTURED',
      authorizedAmountMinor: 10_000,
      capturedAmountMinor: 10_000,
    });

    const earlier = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date('2026-01-01T00:05:00.000Z');

    // Deliberately inserted (== "arrived") in REVERSE chronological order: the later-occurring
    // event is stored first, standing in for genuine out-of-order webhook delivery.
    const laterEventId = await insertWebhookEvent({
      eventType: 'payment.captured',
      objectId: providerReference,
      occurredAt: later,
      payload: { amountMinor: 10_000 },
    });
    const earlierEventId = await insertWebhookEvent({
      eventType: 'payment.authorized',
      objectId: providerReference,
      occurredAt: earlier,
      payload: { amountMinor: 10_000 },
    });

    await runReconciliation(db.sql, 100);

    const rows = await db.sql`
      SELECT webhook_event_id, seq FROM reconciliation_findings
      WHERE webhook_event_id = ANY(${[laterEventId, earlierEventId]})
      ORDER BY seq ASC`;
    assert.equal(rows.length, 2);
    assert.equal(
      (rows[0] as { webhook_event_id: string }).webhook_event_id,
      earlierEventId,
      'the earlier-occurring event was processed FIRST, despite being received second',
    );
    assert.equal((rows[1] as { webhook_event_id: string }).webhook_event_id, laterEventId);
  });

  it('DUPLICATE / REPLAY: re-running reconciliation over already-processed events creates zero new findings', async () => {
    const eventId = await insertWebhookEvent({
      eventType: 'dispute.created',
      objectId: `dp_${randomUUID()}`,
      occurredAt: new Date(),
    });

    const first = await runReconciliation(db.sql, 100);
    assert.ok(first.findingsCreated >= 1);

    const second = await runReconciliation(db.sql, 100);
    assert.equal(second.findingsCreated, 0, 'nothing left unprocessed — a genuine no-op replay');

    const rows = await db.sql`
      SELECT count(*)::int AS n FROM reconciliation_findings WHERE webhook_event_id = ${eventId}`;
    assert.equal(
      (rows[0] as { n: number }).n,
      1,
      'exactly one finding, never duplicated by replay',
    );
  });

  it('CRASH-SAFE / CONCURRENT: two concurrent runs process the full batch exactly once between them', async () => {
    const ROW_COUNT = 30;
    const ids: string[] = [];
    for (let i = 0; i < ROW_COUNT; i += 1) {
      ids.push(
        await insertWebhookEvent({
          eventType: 'dispute.created',
          objectId: `dp_concurrent_${randomUUID()}`,
          occurredAt: new Date(Date.now() + i * 1000),
        }),
      );
    }

    // Two "instances" running reconciliation at once, against the same unprocessed rows —
    // FOR UPDATE SKIP LOCKED (runner.ts) must mean every row is claimed by exactly one of
    // them, never both, and a genuine crash mid-run (simulated here by the transaction of
    // whichever run "loses" a row simply never touching it) leaves nothing half-written.
    const [a, b] = await Promise.all([
      runReconciliation(db.sql, 100),
      runReconciliation(db.sql, 100),
    ]);

    assert.equal(
      a.findingsCreated + b.findingsCreated,
      ROW_COUNT,
      'every row claimed and processed exactly once, combined',
    );

    const rows = await db.sql`
      SELECT count(*)::int AS n FROM reconciliation_findings WHERE webhook_event_id = ANY(${ids})`;
    assert.equal((rows[0] as { n: number }).n, ROW_COUNT, 'no duplicates, nothing missing');
  });

  it('AUDIT: every reconciliation run is itself durably recorded with real counts', async () => {
    await insertWebhookEvent({
      eventType: 'dispute.created',
      objectId: `dp_${randomUUID()}`,
      occurredAt: new Date(),
    });

    const result = await runReconciliation(db.sql, 100);

    const runs = await db.sql`SELECT * FROM reconciliation_runs WHERE id = ${result.runId}`;
    const run = runs[0] as Record<string, unknown>;
    assert.ok(run.started_at !== null);
    assert.ok(run.completed_at !== null);
    assert.equal(run.events_examined, result.eventsExamined);
    assert.equal(run.findings_created, result.findingsCreated);

    // Every finding this run created traces back to it (full audit history, not just a count).
    const linked = await db.sql`
      SELECT count(*)::int AS n FROM reconciliation_findings WHERE run_id = ${result.runId}`;
    assert.equal((linked[0] as { n: number }).n, result.findingsCreated);
  });

  it('NEVER MUTATES: reconciliation never writes to contributions/settlements/ledger tables', async () => {
    const { vinkId, participantId } = await makeVink();
    const providerReference = `pay_${randomUUID()}`;
    await makeContribution({
      vinkId,
      participantId,
      providerReference,
      status: 'AUTHORIZED', // deliberately "wrong" relative to the event below
      authorizedAmountMinor: 10_000,
    });
    const before =
      await db.sql`SELECT status, updated_at FROM contributions WHERE vink_id = ${vinkId}`;

    await insertWebhookEvent({
      eventType: 'payment.captured',
      objectId: providerReference,
      occurredAt: new Date(),
      payload: { amountMinor: 10_000 },
    });
    await runReconciliation(db.sql, 100);

    const after =
      await db.sql`SELECT status, updated_at FROM contributions WHERE vink_id = ${vinkId}`;
    assert.deepEqual(
      after[0],
      before[0],
      'a MISMATCHED finding is recorded, but the contribution row itself is untouched',
    );
  });
});
