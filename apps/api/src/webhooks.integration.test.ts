/**
 * ENG6 Slice 4 — the webhook ingestion route end-to-end against real PostgreSQL. Proven
 * generically against `MockFinancialProvider` (fast, no network, no credentials — this is
 * what CI runs) for the framework itself: fresh delivery, replay protection (duplicate
 * delivery is deduped, not reprocessed or rejected), signature rejection (nothing stored),
 * and the dead-letter path (a signature-valid but structurally unprocessable body). A final,
 * separately gated suite proves the identical route against the REAL Stripe sandbox adapter
 * (Slice 3) — real signature verification, real event envelope, real DB row — closing the
 * loop D46's own "isolated webhook endpoint and signing secret" language describes.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import type { WebhookRouteConfig } from './modules/webhooks/routes.ts';
import {
  MockFinancialProvider,
  type ProviderEvent,
} from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const STRIPE_RUN = process.env.VINKIN_STRIPE_SANDBOX_TEST === '1';
const WEBHOOK_SECRET = 'test-webhook-secret';
const ROUTE_PATH = '/webhooks/mock/sandbox';

function signedEvent(overrides: Partial<ProviderEvent> = {}): {
  rawBody: string;
  signature: string;
} {
  const event: ProviderEvent = {
    provider: 'mock',
    providerEventId: overrides.providerEventId ?? randomUUID(),
    type: overrides.type ?? 'payment.captured',
    occurredAt: overrides.occurredAt ?? new Date().toISOString(),
    objectId: overrides.objectId ?? randomUUID(),
    payload: overrides.payload ?? { note: 'ENG6 Slice 4 test' },
  };
  const rawBody = JSON.stringify(event);
  return { rawBody, signature: MockFinancialProvider.sign(rawBody, WEBHOOK_SECRET) };
}

describe('webhook ingestion (PostgreSQL, ENG6 Slice 4)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    db = await createIsolatedTestDb('webhook_events');
    const config: WebhookRouteConfig = {
      routePath: ROUTE_PATH,
      provider: new MockFinancialProvider(),
      webhookSecret: WEBHOOK_SECRET,
      signatureHeaderName: 'x-mock-signature',
    };
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      webhookRoutes: [config],
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  it('a validly signed event is stored raw, with the PROVIDER occurred_at, and acknowledged', async () => {
    const occurredAt = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const { rawBody, signature } = signedEvent({ occurredAt, type: 'payment.captured' });

    const response = await app.inject({
      method: 'POST',
      url: ROUTE_PATH,
      headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
      payload: rawBody,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'received');

    const rows = await db.sql`SELECT * FROM webhook_events WHERE raw_body = ${rawBody}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, 'received');
    assert.equal(rows[0]!.event_type, 'payment.captured');
    assert.equal(new Date(rows[0]!.occurred_at as string).toISOString(), occurredAt);
    assert.equal(rows[0]!.raw_body, rawBody);
  });

  it('REPLAY PROTECTION: a duplicate delivery of the same provider_event_id is acknowledged but not reprocessed', async () => {
    const { rawBody, signature } = signedEvent();
    const headers = { 'content-type': 'application/json', 'x-mock-signature': signature };

    const first = await app.inject({ method: 'POST', url: ROUTE_PATH, headers, payload: rawBody });
    const second = await app.inject({ method: 'POST', url: ROUTE_PATH, headers, payload: rawBody });

    assert.equal(first.statusCode, 200);
    assert.equal(first.json().status, 'received');
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().status, 'duplicate');

    const event = JSON.parse(rawBody) as ProviderEvent;
    const rows = await db.sql`
      SELECT * FROM webhook_events WHERE provider = 'mock' AND provider_event_id = ${event.providerEventId}`;
    assert.equal(rows.length, 1, 'exactly one row for two deliveries of the same event id');
  });

  it('an invalid signature is rejected with 400 and nothing is stored', async () => {
    const { rawBody } = signedEvent();

    const response = await app.inject({
      method: 'POST',
      url: ROUTE_PATH,
      headers: { 'content-type': 'application/json', 'x-mock-signature': 'not-the-real-signature' },
      payload: rawBody,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'INVALID_SIGNATURE');

    const rows = await db.sql`SELECT * FROM webhook_events WHERE raw_body = ${rawBody}`;
    assert.equal(rows.length, 0, 'an unverified body is never persisted');
  });

  it('a missing signature header is rejected with 400', async () => {
    const { rawBody } = signedEvent();
    const response = await app.inject({
      method: 'POST',
      url: ROUTE_PATH,
      headers: { 'content-type': 'application/json' },
      payload: rawBody,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'MISSING_SIGNATURE');
  });

  it('DEAD LETTER: a validly signed but structurally unprocessable body is durably recorded, not silently dropped', async () => {
    const rawBody = 'this is not JSON';
    const signature = MockFinancialProvider.sign(rawBody, WEBHOOK_SECRET);

    const response = await app.inject({
      method: 'POST',
      url: ROUTE_PATH,
      headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
      payload: rawBody,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'dead_letter');

    const rows = await db.sql`SELECT * FROM webhook_events WHERE raw_body = ${rawBody}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, 'dead_letter');
    assert.equal(rows[0]!.event_type, null);
    assert.ok(typeof rows[0]!.last_error === 'string' && rows[0]!.last_error.length > 0);
  });

  it('a repeated dead-letter delivery of the identical body is deduped too', async () => {
    const rawBody = 'also not JSON, but a distinct body';
    const signature = MockFinancialProvider.sign(rawBody, WEBHOOK_SECRET);
    const headers = { 'content-type': 'application/json', 'x-mock-signature': signature };

    // The dead-letter dedupe key is a best-effort extraction, not a real provider event id
    // (this body has none) — proving idempotent re-delivery still doesn't matters for a
    // sender that legitimately retries an event it never got an ack for.
    await app.inject({ method: 'POST', url: ROUTE_PATH, headers, payload: rawBody });
    await app.inject({ method: 'POST', url: ROUTE_PATH, headers, payload: rawBody });

    const rows = await db.sql`SELECT * FROM webhook_events WHERE raw_body = ${rawBody}`;
    assert.equal(rows.length, 1);
  });
});

describe(
  'webhook ingestion against the REAL Stripe sandbox (ENG6 Slice 3+4)',
  { skip: !STRIPE_RUN },
  () => {
    let db: IsolatedTestDb;
    let app: Awaited<ReturnType<typeof buildApp>>;

    before(async () => {
      const { StripeFinancialProvider, loadStripeAdapterConfig } =
        await import('../../../packages/providers/src/index.ts');
      db = await createIsolatedTestDb('webhook_events_stripe');
      const stripeConfig = loadStripeAdapterConfig();
      const config: WebhookRouteConfig = {
        routePath: '/webhooks/stripe/sandbox',
        provider: new StripeFinancialProvider(stripeConfig),
        webhookSecret: stripeConfig.webhookSecret,
        signatureHeaderName: 'stripe-signature',
      };
      app = await buildApp({
        env: db.env,
        sql: db.sql,
        webhookRoutes: [config],
        checkDb: async () => {
          await db.sql`SELECT 1`;
        },
        checkRedis: async () => {},
      });
    });

    after(async () => {
      await app.close();
      await db.drop();
    });

    it('a real Stripe-signed webhook is verified, stored, and deduped on a second delivery', async () => {
      const { createHmac } = await import('node:crypto');
      const { loadStripeAdapterConfig } = await import('../../../packages/providers/src/index.ts');
      const { webhookSecret } = loadStripeAdapterConfig();

      const providerEventId = `evt_test_${randomUUID().replace(/-/g, '')}`;
      const objectId = `pi_test_${randomUUID().replace(/-/g, '')}`;
      const rawBody = JSON.stringify({
        id: providerEventId,
        object: 'event',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: objectId, object: 'payment_intent' } },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');
      const signatureHeader = `t=${timestamp},v1=${v1}`;

      const first = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe/sandbox',
        headers: { 'content-type': 'application/json', 'stripe-signature': signatureHeader },
        payload: rawBody,
      });
      assert.equal(first.statusCode, 200);
      assert.equal(first.json().status, 'received');

      const second = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe/sandbox',
        headers: { 'content-type': 'application/json', 'stripe-signature': signatureHeader },
        payload: rawBody,
      });
      assert.equal(second.json().status, 'duplicate');

      const rows = await db.sql`
      SELECT * FROM webhook_events WHERE provider = 'stripe' AND provider_event_id = ${providerEventId}`;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.event_type, 'payment.captured');
      assert.equal(rows[0]!.object_id, objectId);
    });
  },
);
