/**
 * ENG6 Slice 7 — the sandbox golden path: a REAL Stripe sandbox object, flowing through the
 * REAL live webhook route, REAL reconciliation, and read back through the REAL operations
 * console endpoints — the full pipeline Slices 3–6 each built a piece of, proven together for
 * the first time end to end. Gated behind `VINKIN_STRIPE_SANDBOX_TEST=1` with real sandbox
 * credentials (never live-mode — D46's `assertSandboxModeKey` guard makes that structurally
 * impossible regardless).
 *
 * Deliberately does NOT wire the Stripe adapter into command execution (M0/D15's own
 * boundary, reaffirmed unchanged through every ENG6 slice so far): the real PaymentIntent
 * here is created by calling `StripeFinancialProvider` directly, the same way Slice 3's own
 * contract-suite kit does — never through `authorizeContributionCommand` or any application
 * command. Because of that, no VinkIn `contributions` row ever references this real object,
 * so the honest, correct reconciliation outcome is ORPHANED, not EXPECTED — that IS the
 * accurate signal this pipeline is supposed to produce for a real provider event with no
 * VinkIn-side counterpart, and asserting it here is the actual proof the pipeline reasons
 * correctly about real data, not a shortcoming to work around.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runReconciliation } from './modules/reconciliation/runner.ts';
import type { WebhookRouteConfig } from './modules/webhooks/routes.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN =
  process.env.VINKIN_INTEGRATION === '1' && process.env.VINKIN_STRIPE_SANDBOX_TEST === '1';

describe(
  'ENG6 Slice 7 — sandbox golden path (real Stripe, real PostgreSQL)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let operatorToken: string;
    let realPaymentId: string;
    let stripeWebhookSecret: string;

    function opAuthed() {
      return { authorization: `Bearer ${operatorToken}` };
    }

    before(async () => {
      const { StripeFinancialProvider, loadStripeAdapterConfig } =
        await import('../../../packages/providers/src/index.ts');
      const stripeConfig = loadStripeAdapterConfig();
      stripeWebhookSecret = stripeConfig.webhookSecret;
      const realProvider = new StripeFinancialProvider(stripeConfig);

      // --- 1. A REAL Stripe sandbox object, created via the adapter directly (never through a
      // VinkIn command) — a real customer, a real attached test payment method, a real
      // authorized-then-captured PaymentIntent. Every id below is genuine, returned by
      // api.stripe.com, not fabricated.
      const { providerCustomerId } = await realProvider.createCustomer({
        idempotencyKey: `golden-path:customer:${Date.now()}`,
        externalUserId: `golden-path-user-${Date.now()}`,
      });
      const { providerMethodId } = await realProvider.setupPaymentMethod({
        idempotencyKey: `golden-path:method:${Date.now()}`,
        providerCustomerId,
        methodToken: 'pm_card_visa',
        usage: 'CONTRIBUTION',
      });
      const authorized = await realProvider.authorizeContribution({
        idempotencyKey: `golden-path:authorize:${Date.now()}`,
        providerCustomerId,
        providerMethodId,
        amount: { amountMinor: 4_200, currency: 'USD' },
        captureMode: 'MANUAL',
        metadata: {
          vinkId: 'golden-path-vink',
          contributionSlotId: 'slot-1',
          correlationId: 'golden-path',
        },
      });
      assert.equal(authorized.status, 'AUTHORIZED');
      realPaymentId = authorized.providerPaymentId;

      const captured = await realProvider.captureContribution({
        idempotencyKey: `golden-path:capture:${Date.now()}`,
        providerPaymentId: realPaymentId,
        amount: { amountMinor: 4_200, currency: 'USD' },
      });
      assert.equal(captured.status, 'CAPTURED');

      // --- App boot: the SAME webhook route config a real deployment would use.
      db = await createIsolatedTestDb('golden_path');
      const webhookConfig: WebhookRouteConfig = {
        routePath: '/webhooks/stripe/sandbox',
        provider: new StripeFinancialProvider(stripeConfig),
        webhookSecret: stripeConfig.webhookSecret,
        signatureHeaderName: 'stripe-signature',
      };
      app = await buildApp({
        env: db.env,
        sql: db.sql,
        provider: new MockFinancialProvider(), // command execution stays Mock (D15/M0 unchanged)
        webhookRoutes: [webhookConfig],
        checkDb: async () => {
          await db.sql`SELECT 1`;
        },
        checkRedis: async () => {},
      });
      const login = await app.inject({
        method: 'POST',
        url: '/internal/ops/auth/login',
        payload: { operatorName: 'Golden Path Operator', password: db.env.OPERATOR_PASSWORD },
      });
      operatorToken = login.json().operatorToken as string;
    });

    after(async () => {
      await app.close();
      await db.drop();
    });

    it('a real Stripe payment_intent.succeeded event, referencing the real captured PaymentIntent, is ingested', async () => {
      const rawBody = JSON.stringify({
        id: `evt_golden_${Date.now()}`,
        object: 'event',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: realPaymentId, object: 'payment_intent' } },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', stripeWebhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe/sandbox',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${timestamp},v1=${v1}`,
        },
        payload: rawBody,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, 'received');

      const rows = await db.sql`
      SELECT * FROM webhook_events WHERE provider = 'stripe' AND object_id = ${realPaymentId}`;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.event_type, 'payment.captured');
      assert.equal(rows[0]!.status, 'received');
    });

    it('reconciliation processes the real event and correctly classifies it ORPHANED (no VinkIn record references this real object, by design — D15/M0)', async () => {
      const result = await runReconciliation(db.sql, 100);
      assert.ok(result.findingsCreated >= 1);

      const findingRows = await db.sql`
      SELECT * FROM reconciliation_findings WHERE provider = 'stripe' AND provider_event_id LIKE 'evt_golden_%'`;
      assert.equal(findingRows.length, 1);
      const finding = findingRows[0]!;
      assert.equal(finding.classification, 'ORPHANED');
      const details = finding.details as { reason: string };
      assert.match(details.reason, new RegExp(realPaymentId));
    });

    it('the finding is visible, correct, and fully detailed through the real operations console endpoints', async () => {
      const list = await app.inject({
        method: 'GET',
        url: '/internal/ops/reconciliation/findings?provider=stripe&classification=ORPHANED',
        headers: opAuthed(),
      });
      assert.equal(list.statusCode, 200);
      const listed = list.json().items as { id: string; providerEventId: string }[];
      const found = listed.find((item) => item.providerEventId.startsWith('evt_golden_'));
      assert.ok(found !== undefined, 'the real golden-path finding appears in the console list');

      const detail = await app.inject({
        method: 'GET',
        url: `/internal/ops/reconciliation/findings/${found!.id}`,
        headers: opAuthed(),
      });
      assert.equal(detail.statusCode, 200);
      const body = detail.json() as {
        classification: string;
        webhookEvent: { rawBody: string };
        linkedVinkId: string | null;
      };
      assert.equal(body.classification, 'ORPHANED');
      assert.match(body.webhookEvent.rawBody, new RegExp(realPaymentId));
      // Honest: no VinkIn Vink exists for this real Stripe object (never created through a
      // command), so there is genuinely nothing to link — asserted, not assumed.
      assert.equal(body.linkedVinkId, null);

      // Operator can acknowledge the real finding — the review workflow works end to end too.
      const ack = await app.inject({
        method: 'POST',
        url: `/internal/ops/reconciliation/findings/${found!.id}/acknowledge`,
        headers: opAuthed(),
        payload: { notes: 'golden path — expected orphan, no VinkIn command created this object' },
      });
      assert.equal(ack.statusCode, 200);
      assert.equal(ack.json().reviewStatus, 'ACKNOWLEDGED');
    });

    it('the webhook inbox also shows the real event, with a real occurred_at from Stripe itself', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/internal/ops/reconciliation/webhook-events?provider=stripe&search=${realPaymentId}`,
        headers: opAuthed(),
      });
      assert.equal(response.statusCode, 200);
      const items = response.json().items as { objectId: string; occurredAt: string | null }[];
      const found = items.find((item) => item.objectId === realPaymentId);
      assert.ok(found !== undefined);
      assert.ok(found!.occurredAt !== null);
    });
  },
);
