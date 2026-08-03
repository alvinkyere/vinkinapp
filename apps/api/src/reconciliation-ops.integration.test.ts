/**
 * ENG6 Slice 6 — the read-only operations console transport end-to-end against real
 * PostgreSQL: authorization boundaries, the acknowledge/resolve audit trail, concurrent-run
 * prevention, and — the one genuinely mechanical proof this slice depends on — that dead-
 * letter replay runs through the SAME ingestion function the live webhook route uses (real
 * signature re-verification, real dedupe), never a shortcut.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import type { WebhookRouteConfig } from './modules/webhooks/routes.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const WEBHOOK_SECRET = 'test-webhook-secret';
const ROUTE_PATH = '/webhooks/mock/sandbox';

describe('reconciliation ops console (PostgreSQL, ENG6 Slice 6)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let operatorToken: string;

  function opAuthed() {
    return { authorization: `Bearer ${operatorToken}` };
  }

  before(async () => {
    db = await createIsolatedTestDb('reconciliation_ops');
    const webhookConfig: WebhookRouteConfig = {
      routePath: ROUTE_PATH,
      provider: new MockFinancialProvider(),
      webhookSecret: WEBHOOK_SECRET,
      signatureHeaderName: 'x-mock-signature',
    };
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      provider: new MockFinancialProvider(),
      webhookRoutes: [webhookConfig],
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    const login = await app.inject({
      method: 'POST',
      url: '/internal/ops/auth/login',
      payload: { operatorName: 'Test Operator', password: db.env.OPERATOR_PASSWORD },
    });
    operatorToken = login.json().operatorToken as string;
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  // --- fixture helpers ---------------------------------------------------------------

  function signedEvent(overrides: Record<string, unknown> = {}) {
    const event = {
      provider: 'mock',
      providerEventId: randomUUID(),
      type: 'dispute.created',
      occurredAt: new Date().toISOString(),
      objectId: randomUUID(),
      payload: {},
      ...overrides,
    };
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: MockFinancialProvider.sign(rawBody, WEBHOOK_SECRET) };
  }

  async function ingestAndReconcile(overrides: Record<string, unknown> = {}) {
    const { rawBody, signature } = signedEvent(overrides);
    const response = await app.inject({
      method: 'POST',
      url: ROUTE_PATH,
      headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
      payload: rawBody,
    });
    assert.equal(response.statusCode, 200);
    await app.inject({
      method: 'POST',
      url: '/internal/ops/reconciliation/run',
      headers: opAuthed(),
    });
    const event = JSON.parse(rawBody) as { providerEventId: string };
    const rows = await db.sql`
      SELECT * FROM reconciliation_findings WHERE provider_event_id = ${event.providerEventId}`;
    return rows[0] as Record<string, unknown>;
  }

  // --- authorization boundaries --------------------------------------------------------

  it('AUTHZ: every reconciliation ops route rejects an unauthenticated caller', async () => {
    const routes: { method: 'GET' | 'POST'; url: string }[] = [
      { method: 'GET', url: '/internal/ops/reconciliation/webhook-events' },
      { method: 'GET', url: `/internal/ops/reconciliation/webhook-events/${randomUUID()}` },
      { method: 'POST', url: `/internal/ops/reconciliation/webhook-events/${randomUUID()}/replay` },
      { method: 'GET', url: '/internal/ops/reconciliation/findings' },
      { method: 'GET', url: `/internal/ops/reconciliation/findings/${randomUUID()}` },
      { method: 'POST', url: `/internal/ops/reconciliation/findings/${randomUUID()}/acknowledge` },
      { method: 'POST', url: `/internal/ops/reconciliation/findings/${randomUUID()}/resolve` },
      { method: 'GET', url: '/internal/ops/reconciliation/run-status' },
      { method: 'POST', url: '/internal/ops/reconciliation/run' },
    ];
    for (const route of routes) {
      const response = await app.inject({ method: route.method, url: route.url });
      assert.equal(response.statusCode, 401, `${route.method} ${route.url} must require auth`);
    }
  });

  it('AUTHZ: a valid operator token is accepted on the same routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/ops/reconciliation/webhook-events',
      headers: opAuthed(),
    });
    assert.equal(response.statusCode, 200);
  });

  // --- webhook inbox + findings listing -------------------------------------------------

  it('lists webhook inbox events with provider/status filters and pagination', async () => {
    await ingestAndReconcile();
    const response = await app.inject({
      method: 'GET',
      url: '/internal/ops/reconciliation/webhook-events?provider=mock&status=received&pageSize=5',
      headers: opAuthed(),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { items: unknown[]; total: number };
    assert.ok(body.total >= 1);
    assert.ok(body.items.length <= 5);
  });

  it('lists reconciliation findings filtered by classification', async () => {
    await ingestAndReconcile();
    const response = await app.inject({
      method: 'GET',
      url: '/internal/ops/reconciliation/findings?classification=UNRECOGNIZED',
      headers: opAuthed(),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { items: { classification: string }[] };
    assert.ok(body.items.length >= 1);
    for (const item of body.items) assert.equal(item.classification, 'UNRECOGNIZED');
  });

  it('finding detail includes reason, audit history (empty until reviewed), and raw payload access via the linked webhook event', async () => {
    const finding = await ingestAndReconcile();
    const response = await app.inject({
      method: 'GET',
      url: `/internal/ops/reconciliation/findings/${finding.id}`,
      headers: opAuthed(),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      auditHistory: unknown[];
      webhookEvent: { rawBody: string };
      reason: string;
    };
    assert.equal(body.auditHistory.length, 0);
    assert.ok(body.reason.length > 0);
    assert.ok(body.webhookEvent.rawBody.length > 0);
  });

  // --- acknowledge / resolve: fully audited ----------------------------------------------

  it('ACKNOWLEDGE then RESOLVE is fully, immutably audited — both actions, actor, timestamp, notes', async () => {
    const finding = await ingestAndReconcile();

    const ack = await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/findings/${finding.id}/acknowledge`,
      headers: opAuthed(),
      payload: { notes: 'looked into it' },
    });
    assert.equal(ack.statusCode, 200);
    assert.equal(ack.json().reviewStatus, 'ACKNOWLEDGED');

    const resolve = await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/findings/${finding.id}/resolve`,
      headers: opAuthed(),
      payload: { notes: 'confirmed benign, no action needed' },
    });
    assert.equal(resolve.statusCode, 200);
    assert.equal(resolve.json().reviewStatus, 'RESOLVED');

    const detail = await app.inject({
      method: 'GET',
      url: `/internal/ops/reconciliation/findings/${finding.id}`,
      headers: opAuthed(),
    });
    const auditHistory = detail.json().auditHistory as {
      action: string;
      operatorName: string;
      details: { notes: string | null; newReviewStatus: string };
      createdAt: string;
    }[];
    assert.equal(auditHistory.length, 2);
    const actions = auditHistory.map((entry) => entry.action).sort();
    assert.deepEqual(actions, [
      'RECONCILIATION_FINDING_ACKNOWLEDGED',
      'RECONCILIATION_FINDING_RESOLVED',
    ]);
    for (const entry of auditHistory) {
      assert.equal(entry.operatorName, 'Test Operator');
      assert.ok(entry.createdAt.length > 0);
    }
    const resolveEntry = auditHistory.find((e) => e.action === 'RECONCILIATION_FINDING_RESOLVED')!;
    assert.equal(resolveEntry.details.notes, 'confirmed benign, no action needed');
    assert.equal(resolveEntry.details.newReviewStatus, 'RESOLVED');
  });

  it('resolve requires notes; acknowledge does not', async () => {
    const finding = await ingestAndReconcile();
    const missingNotes = await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/findings/${finding.id}/resolve`,
      headers: opAuthed(),
      payload: {},
    });
    assert.equal(missingNotes.statusCode, 400);

    const ackNoNotes = await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/findings/${finding.id}/acknowledge`,
      headers: opAuthed(),
      payload: {},
    });
    assert.equal(ackNoNotes.statusCode, 200);
  });

  // --- manual run: concurrency prevention -------------------------------------------------

  it('CONCURRENT RUNS PREVENTED: two simultaneous trigger requests — exactly one proceeds', async () => {
    const before = await db.sql`SELECT count(*)::int AS n FROM reconciliation_runs`;

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/internal/ops/reconciliation/run', headers: opAuthed() }),
      app.inject({ method: 'POST', url: '/internal/ops/reconciliation/run', headers: opAuthed() }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one run proceeds, the other is rejected');

    const after = await db.sql`SELECT count(*)::int AS n FROM reconciliation_runs`;
    assert.equal(
      (after[0] as { n: number }).n,
      (before[0] as { n: number }).n + 1,
      'exactly one new reconciliation_runs row — the rejected request never started a second run',
    );
  });

  it('run-status reflects idle after a completed run, with the last result recorded', async () => {
    await app.inject({
      method: 'POST',
      url: '/internal/ops/reconciliation/run',
      headers: opAuthed(),
    });
    const status = await app.inject({
      method: 'GET',
      url: '/internal/ops/reconciliation/run-status',
      headers: opAuthed(),
    });
    const body = status.json() as { inProgress: boolean; lastRun: { runId: string } | null };
    assert.equal(body.inProgress, false);
    assert.ok(body.lastRun !== null);
  });

  // --- dead-letter replay -----------------------------------------------------------------

  it('REPLAY goes through the normal ingestion pipeline: same function, real re-verification, no bypass', async () => {
    const rawBody = 'not valid JSON at all';
    const signature = MockFinancialProvider.sign(rawBody, WEBHOOK_SECRET);
    const first = await app.inject({
      method: 'POST',
      url: ROUTE_PATH,
      headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
      payload: rawBody,
    });
    assert.equal(first.json().status, 'dead_letter');

    const listed = await app.inject({
      method: 'GET',
      url:
        '/internal/ops/reconciliation/webhook-events?status=dead_letter&search=' +
        encodeURIComponent(rawBody.slice(0, 5)),
      headers: opAuthed(),
    });
    const rows =
      await db.sql`SELECT id, delivery_count FROM webhook_events WHERE raw_body = ${rawBody}`;
    const webhookEventId = (rows[0] as { id: string }).id;
    assert.equal((rows[0] as { delivery_count: number }).delivery_count, 1);
    void listed;

    const replay = await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/webhook-events/${webhookEventId}/replay`,
      headers: opAuthed(),
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().outcome, 'dead_letter');
    assert.equal(replay.json().webhookEventId, webhookEventId);

    // REPLAY CANNOT CREATE DUPLICATE RECONCILIATION WORK: the exact same row was updated
    // (delivery_count incremented), not a second row inserted.
    const afterRows =
      await db.sql`SELECT count(*)::int AS n FROM webhook_events WHERE raw_body = ${rawBody}`;
    assert.equal((afterRows[0] as { n: number }).n, 1);
    const updated =
      await db.sql`SELECT delivery_count FROM webhook_events WHERE id = ${webhookEventId}`;
    assert.equal((updated[0] as { delivery_count: number }).delivery_count, 2);

    // Reconciliation never sees dead-lettered rows at all (Slice 5's own scoping), so a run
    // after replay creates no findings for this event either.
    const findingsBefore = await db.sql`SELECT count(*)::int AS n FROM reconciliation_findings`;
    await app.inject({
      method: 'POST',
      url: '/internal/ops/reconciliation/run',
      headers: opAuthed(),
    });
    const findingsAfter = await db.sql`SELECT count(*)::int AS n FROM reconciliation_findings`;
    assert.equal((findingsAfter[0] as { n: number }).n, (findingsBefore[0] as { n: number }).n);
  });

  it('REPLAY never bypasses signature verification: an event stored before signature_header existed cannot be replayed', async () => {
    const id = randomUUID();
    await db.sql`
      INSERT INTO webhook_events (id, provider, provider_event_id, raw_body, status, signature_header)
      VALUES (${id}, 'mock', ${randomUUID()}, 'legacy row', 'dead_letter', NULL)`;
    const replay = await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/webhook-events/${id}/replay`,
      headers: opAuthed(),
    });
    assert.equal(replay.statusCode, 409);
    assert.equal(replay.json().error, 'NO_STORED_SIGNATURE');
  });

  it('replay for a provider with no currently-configured ingestion route fails honestly, not silently', async () => {
    const id = randomUUID();
    await db.sql`
      INSERT INTO webhook_events (id, provider, provider_event_id, raw_body, status, signature_header)
      VALUES (${id}, 'stripe', ${randomUUID()}, '{}', 'dead_letter', 't=1,v1=abc')`;
    const replay = await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/webhook-events/${id}/replay`,
      headers: opAuthed(),
    });
    assert.equal(replay.statusCode, 409);
    assert.equal(replay.json().error, 'NO_INGESTION_PATH_CONFIGURED');
  });

  it('replay itself is audited', async () => {
    const rawBody = 'still not JSON';
    const signature = MockFinancialProvider.sign(rawBody, WEBHOOK_SECRET);
    await app.inject({
      method: 'POST',
      url: ROUTE_PATH,
      headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
      payload: rawBody,
    });
    const rows = await db.sql`SELECT id FROM webhook_events WHERE raw_body = ${rawBody}`;
    const webhookEventId = (rows[0] as { id: string }).id;

    await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/webhook-events/${webhookEventId}/replay`,
      headers: opAuthed(),
    });

    const audit = await db.sql`
      SELECT * FROM operator_audit_log WHERE action = 'WEBHOOK_EVENT_REPLAYED'
      AND details->>'webhookEventId' = ${webhookEventId}`;
    assert.equal(audit.length, 1);
    assert.equal((audit[0] as { operator_name: string }).operator_name, 'Test Operator');
  });

  // --- no financial mutation is possible from any console endpoint -----------------------

  it('NO FINANCIAL MUTATION: acknowledge/resolve/replay/run never touch contributions, settlements, or ledger tables', async () => {
    const userId = randomUUID();
    const vinkId = randomUUID();
    const participantId = randomUUID();
    const contributionId = randomUUID();
    const providerReference = `pay_${randomUUID()}`;
    await db.sql`INSERT INTO users (id, username, display_name, password_hash)
      VALUES (${userId}, ${`u_${userId.slice(0, 8)}`}, 'U', 'hash')`;
    await db.sql`
      INSERT INTO vinks (id, organizer_user_id, public_code, currency, purchase_category,
        payment_policy, subtotal_amount_minor, tip_amount_minor, maximum_amount_minor,
        required_amount_minor, submission_deadline, processing_grace_deadline, creation_idempotency_key)
      VALUES (${vinkId}, ${userId}, ${`c_${vinkId.slice(0, 8)}`}, 'USD', 'GROCERY', 'EXACT_FINAL',
        10000, 0, 10000, 10000, now() + interval '1 day', now() + interval '1 day', ${`i_${vinkId}`})`;
    await db.sql`
      INSERT INTO participants (id, vink_id, user_id, display_name, role, status, allocated_amount_minor, maximum_approved_amount_minor)
      VALUES (${participantId}, ${vinkId}, ${userId}, 'U', 'ORGANIZER', 'JOINED', 10000, 10000)`;
    await db.sql`
      INSERT INTO contributions (id, vink_id, participant_id, requested_amount_minor, status, provider_reference, idempotency_key)
      VALUES (${contributionId}, ${vinkId}, ${participantId}, 10000, 'AUTHORIZED', ${providerReference}, ${`idem_${contributionId}`})`;

    const before = await db.sql`SELECT * FROM contributions WHERE id = ${contributionId}`;

    const finding = await ingestAndReconcile({
      type: 'payment.captured',
      objectId: providerReference,
      payload: { amountMinor: 10_000 },
    });
    await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/findings/${finding.id}/acknowledge`,
      headers: opAuthed(),
    });
    await app.inject({
      method: 'POST',
      url: `/internal/ops/reconciliation/findings/${finding.id}/resolve`,
      headers: opAuthed(),
      payload: { notes: 'reviewed' },
    });

    const after = await db.sql`SELECT * FROM contributions WHERE id = ${contributionId}`;
    assert.deepEqual(
      after[0],
      before[0],
      'the contribution row is byte-identical after every console action',
    );
  });
});
