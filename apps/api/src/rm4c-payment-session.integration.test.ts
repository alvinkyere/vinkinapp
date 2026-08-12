/**
 * RM4C-C (D49) — real hosted card collection against real PostgreSQL. Proves the whole point
 * of routing through a signed webhook rather than trusting the client: a "the provider
 * confirmed" fact known only to the mock (never told to the contribution engine directly)
 * moves the contribution to CAPTURED only once the SAME signed webhook route SH1/ENG6 already
 * hardened processes it — never on the client's own say-so, never twice, never for someone
 * else's contribution.
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
const WEBHOOK_SECRET = 'rm4c-test-webhook-secret';
const ROUTE_PATH = '/webhooks/mock/rm4c-sandbox';

describe(
  'RM4C-C: hosted card payment sessions resolved via signed webhook (PostgreSQL, D49)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;
    let provider: MockFinancialProvider;
    let app: Awaited<ReturnType<typeof buildApp>>;
    const stamp = Date.now();
    let userCounter = 0;

    before(async () => {
      db = await createIsolatedTestDb('rm4c_payment_session');
      provider = new MockFinancialProvider();
      const webhookConfig: WebhookRouteConfig = {
        routePath: ROUTE_PATH,
        provider, // SAME instance as command execution — this test proves the real wiring, not a lookalike
        webhookSecret: WEBHOOK_SECRET,
        signatureHeaderName: 'x-mock-signature',
      };
      app = await buildApp({
        env: db.env,
        sql: db.sql,
        provider,
        webhookRoutes: [webhookConfig],
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

    async function registerAndLogin(): Promise<{ token: string; username: string }> {
      userCounter += 1;
      const username = `rm4c_${stamp}_${userCounter}`;
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      assert.equal(registered.statusCode, 201);
      return { token: registered.json().accessToken as string, username };
    }

    async function openVinkWithMember(): Promise<{
      vinkId: string;
      organizer: { token: string; username: string };
      member: { token: string; username: string };
      memberPid: string;
    }> {
      const organizer = await registerAndLogin();
      const member = await registerAndLogin();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 4_000,
          tipMinor: 0,
          organizerDisplayName: 'Organizer',
        },
      });
      const vinkId = created.json().vink.id as string;
      const organizerPid = created.json().participants[0].id as string;
      const added = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/participants`,
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: { username: member.username },
      });
      const memberPid = added.json().id as string;
      await app.inject({
        method: 'PUT',
        url: `/api/v1/vinks/${vinkId}/split`,
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: {
          method: 'CUSTOM_AMOUNT',
          amounts: [
            { participantId: organizerPid, amountMinor: 0 },
            { participantId: memberPid, amountMinor: 4_000 },
          ],
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/open`,
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: {},
      });
      return { vinkId, organizer, member, memberPid };
    }

    function signedEventFor(event: ProviderEvent): { rawBody: string; signature: string } {
      const rawBody = JSON.stringify(event);
      return { rawBody, signature: MockFinancialProvider.sign(rawBody, WEBHOOK_SECRET) };
    }

    // `provider` is one shared instance across every test in this file (matching this
    // codebase's own established integration-test convention). A capture triggered by an
    // earlier test's own webhook processing emits its own `payment.captured` event that the
    // earlier test never had reason to drain — draining by objectId, not "the first thing in
    // the queue", is what makes each test robust to another test's own leftover events rather
    // than accidentally cross-wiring itself to the wrong contribution.
    function drainEventFor(objectId: string): ProviderEvent {
      const events = provider.drainEvents();
      const match = events.find((candidate) => candidate.objectId === objectId);
      assert.ok(
        match,
        `expected an emitted event for ${objectId}, got [${events.map((e) => e.objectId).join(', ')}]`,
      );
      return match!;
    }

    // A genuinely passive read — unlike the `/resolve` route (which ACTIVELY re-checks provider
    // truth and can itself advance a pending contribution, by design, E5), this proves what
    // state the row is actually in without triggering any resolution as a side effect of
    // checking.
    async function contributionStatus(contributionId: string): Promise<string> {
      const rows = await db.sql`SELECT status FROM contributions WHERE id = ${contributionId}`;
      return rows[0]!.status as string;
    }

    it('SUCCESS PATH: session creation returns a client secret and no payment method; the contribution only reaches CAPTURED after the signed webhook, never at session-creation time', async () => {
      const { vinkId, member } = await openVinkWithMember();

      const sessionRes = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/payment-session`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      assert.equal(sessionRes.statusCode, 200);
      const body = sessionRes.json();
      assert.equal(body.contribution.status, 'AUTHORIZATION_PENDING');
      assert.ok(typeof body.clientSecret === 'string' && body.clientSecret.length > 0);
      assert.equal(body.replayed, false);
      const contributionId = body.contribution.id as string;

      // The provider now genuinely knows the card was accepted (mirrors the client confirming
      // directly with Stripe) — but the contribution engine has not been told yet.
      const contributions =
        await db.sql`SELECT provider_reference FROM contributions WHERE id = ${contributionId}`;
      const providerPaymentId = contributions[0]!.provider_reference as string;
      provider.resolvePendingAuthorization(providerPaymentId, 'AUTHORIZED');

      // STILL pending — a provider-side confirmation with no webhook delivered yet must not move
      // the contribution (the required "client success without webhook" adversarial proof).
      assert.equal(
        await contributionStatus(contributionId),
        'AUTHORIZATION_PENDING',
        'confirming at the provider alone must never mark the contribution paid',
      );

      const event = drainEventFor(providerPaymentId);
      assert.ok(event, 'resolvePendingAuthorization must emit a payment.authorized event');
      const { rawBody, signature } = signedEventFor(event!);
      const webhookRes = await app.inject({
        method: 'POST',
        url: ROUTE_PATH,
        headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
        payload: rawBody,
      });
      assert.equal(webhookRes.statusCode, 200);
      assert.equal(webhookRes.json().status, 'received');

      // The signed webhook is what actually captured it — real ledger money movement, the exact
      // same captureImmediately path the token-based flow uses.
      assert.equal(await contributionStatus(contributionId), 'CAPTURED');
      const ledgerRows = await db.sql`
      SELECT le.* FROM ledger_entries le
      JOIN ledger_transactions lt ON lt.id = le.transaction_id
      WHERE lt.reference_id = ${contributionId}`;
      assert.ok(ledgerRows.length > 0, 'a real ledger posting exists for this contribution');
    });

    it('DECLINE PATH: a declined confirmation, delivered only via the webhook, marks the contribution declined — never authorized', async () => {
      const { vinkId, member } = await openVinkWithMember();
      const sessionRes = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/payment-session`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const contributionId = sessionRes.json().contribution.id as string;
      const contributions =
        await db.sql`SELECT provider_reference FROM contributions WHERE id = ${contributionId}`;
      const providerPaymentId = contributions[0]!.provider_reference as string;

      provider.resolvePendingAuthorization(providerPaymentId, 'DECLINED');
      const event = drainEventFor(providerPaymentId);
      const { rawBody, signature } = signedEventFor(event!);
      await app.inject({
        method: 'POST',
        url: ROUTE_PATH,
        headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
        payload: rawBody,
      });

      assert.equal(await contributionStatus(contributionId), 'DECLINED');
    });

    it('DUPLICATE WEBHOOK: the identical signed event delivered twice captures exactly once (no duplicate ledger postings)', async () => {
      const { vinkId, member } = await openVinkWithMember();
      const sessionRes = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/payment-session`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const contributionId = sessionRes.json().contribution.id as string;
      const contributions =
        await db.sql`SELECT provider_reference FROM contributions WHERE id = ${contributionId}`;
      const providerPaymentId = contributions[0]!.provider_reference as string;
      provider.resolvePendingAuthorization(providerPaymentId, 'AUTHORIZED');
      const event = drainEventFor(providerPaymentId);
      const { rawBody, signature } = signedEventFor(event!);
      const headers = {
        'content-type': 'application/json',
        'x-mock-signature': signature,
      } as const;

      const first = await app.inject({
        method: 'POST',
        url: ROUTE_PATH,
        headers,
        payload: rawBody,
      });
      assert.equal(first.json().status, 'received');
      const second = await app.inject({
        method: 'POST',
        url: ROUTE_PATH,
        headers,
        payload: rawBody,
      });
      assert.equal(second.json().status, 'duplicate');

      assert.equal(await contributionStatus(contributionId), 'CAPTURED');
      const ledgerRows = await db.sql`
      SELECT le.* FROM ledger_entries le
      JOIN ledger_transactions lt ON lt.id = le.transaction_id
      WHERE lt.reference_id = ${contributionId}`;
      // captureImmediately always inserts exactly two balanced postings (capture + session
      // funding), each a debit/credit pair — 4 entries for one real capture, never 8 for two.
      assert.equal(
        ledgerRows.length,
        4,
        'the duplicate webhook delivery must not double-post the ledger',
      );
    });

    it('OWNERSHIP: a user who is not a participant on the vink cannot create a payment session for it', async () => {
      const { vinkId } = await openVinkWithMember();
      const outsider = await registerAndLogin();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/payment-session`,
        headers: { authorization: `Bearer ${outsider.token}` },
        payload: {},
      });
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error, 'FORBIDDEN');
    });

    it('IDEMPOTENCY: a double-tap session request returns the existing in-flight contribution with no fresh client secret', async () => {
      const { vinkId, member } = await openVinkWithMember();
      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/payment-session`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/payment-session`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      assert.equal(second.statusCode, 200);
      assert.equal(second.json().replayed, true);
      assert.equal(second.json().clientSecret, null);
      assert.equal(second.json().contribution.id, first.json().contribution.id);
    });

    it('DEADLINE: a payment session cannot be created once the submission deadline has passed, even though the vink row is still OPEN', async () => {
      const { vinkId, member } = await openVinkWithMember();
      await db.sql`UPDATE vinks SET submission_deadline = ${new Date(Date.now() - 5_000).toISOString()}
      WHERE id = ${vinkId}`;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/contributions/payment-session`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      assert.equal(res.statusCode, 422);
      assert.equal(res.json().error, 'INVALID_COMMAND');
    });

    it('GUEST PATH: a guest can create and complete their own hosted payment session end-to-end', async () => {
      const organizer = await registerAndLogin();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 3_000,
          tipMinor: 0,
          organizerDisplayName: 'Organizer',
        },
      });
      const vinkId = created.json().vink.id as string;
      const organizerPid = created.json().participants[0].id as string;
      const invited = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/guests`,
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: { displayName: 'Guest Payer', deliveryMode: 'manual' },
      });
      assert.equal(invited.statusCode, 201, JSON.stringify(invited.json()));
      const guestToken = invited.json().guestToken as string;
      const guestPid = invited.json().participant.id as string;
      await app.inject({
        method: 'PUT',
        url: `/api/v1/vinks/${vinkId}/split`,
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: {
          method: 'CUSTOM_AMOUNT',
          amounts: [
            { participantId: organizerPid, amountMinor: 0 },
            { participantId: guestPid, amountMinor: 3_000 },
          ],
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/open`,
        headers: { authorization: `Bearer ${organizer.token}` },
        payload: {},
      });

      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/guest/contributions/payment-session',
        headers: { authorization: `Bearer ${guestToken}` },
        payload: {},
      });
      assert.equal(sessionRes.statusCode, 200, JSON.stringify(sessionRes.json()));
      const contributionId = sessionRes.json().contribution.id as string;
      const contributions =
        await db.sql`SELECT provider_reference FROM contributions WHERE id = ${contributionId}`;
      const providerPaymentId = contributions[0]!.provider_reference as string;
      provider.resolvePendingAuthorization(providerPaymentId, 'AUTHORIZED');
      const event = drainEventFor(providerPaymentId);
      const { rawBody, signature } = signedEventFor(event!);
      await app.inject({
        method: 'POST',
        url: ROUTE_PATH,
        headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
        payload: rawBody,
      });

      const finalRes = await app.inject({
        method: 'GET',
        url: '/api/v1/guest/session',
        headers: { authorization: `Bearer ${guestToken}` },
      });
      assert.equal(finalRes.statusCode, 200);
      // Guest-safe projection (D24/D25), not the raw domain status — 'confirmed' is what
      // CAPTURED/AUTHORIZED/SETTLED all project to for a guest's own view.
      assert.equal(finalRes.json().participant.contributionStatus, 'confirmed');
    });

    it('a webhook event for a payment intent no contribution references is a harmless no-op (reconciliation, not this route, surfaces it)', async () => {
      const event: ProviderEvent = {
        provider: 'mock',
        providerEventId: randomUUID(),
        type: 'payment.captured',
        occurredAt: new Date().toISOString(),
        objectId: `pay_${randomUUID()}`,
        payload: {},
      };
      const { rawBody, signature } = signedEventFor(event);
      const res = await app.inject({
        method: 'POST',
        url: ROUTE_PATH,
        headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
        payload: rawBody,
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().status, 'received');
    });
  },
);
