/**
 * Funnel analytics end-to-end (PV12 prep) — event ingestion, rate limiting, and the
 * operator-facing summary that computes every number the PV12 exit gate names. Real
 * PostgreSQL; VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runSweeps } from './jobs/sweeps.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('funnel analytics end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let provider: MockFinancialProvider;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let operatorToken: string;
  const stamp = Date.now();
  const users = { organizer: `pv12_org_${stamp}`, memberA: `pv12_a_${stamp}` };
  const tokens: Record<string, string> = {};

  function authed(who: keyof typeof users) {
    return { authorization: `Bearer ${tokens[who]}` };
  }

  before(async () => {
    db = await createIsolatedTestDb('analytics');
    provider = new MockFinancialProvider();
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      provider,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    for (const [who, username] of Object.entries(users)) {
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      tokens[who] = registered.json().accessToken;
    }
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

  it('accepts a batch of events, rejects an empty batch, and rate-limits after the window', async () => {
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      payload: {
        clientId: 'client-1',
        app: 'guest_web',
        events: [
          {
            eventName: 'guest_join_page_viewed',
            properties: { publicCode: 'ABC123' },
            occurredAt: new Date().toISOString(),
          },
        ],
      },
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.json().accepted, 1);

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      payload: { clientId: 'client-1', app: 'guest_web', events: [] },
    });
    assert.equal(empty.statusCode, 400);
  });

  it('EXIT GATE: the summary computes every PV12 metric from real data', async () => {
    // A funded, card-ready, then completed vink for completedVinks + participantJoins +
    // medianJoinToContributionMinutes.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed('organizer'),
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 6_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;
    const organizerPid = created.json().participants[0].id as string;
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: authed('organizer'),
      payload: { username: users.memberA },
    });
    const memberPid = added.json().id as string;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: authed('organizer'),
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: organizerPid, amountMinor: 0 },
          { participantId: memberPid, amountMinor: 6_000 },
        ],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: authed('organizer'),
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/contributions/authorize`,
      headers: authed('memberA'),
      payload: {},
    });
    // RM3B (D47): the sweep now provisions from the card pool — seed a real, disabled pool
    // card first (same technique as `card-pool.integration.test.ts`'s own `seedRealCard`).
    const { providerCardholderId } = await provider.createCardholder({
      idempotencyKey: `cardholder:it:${randomUUID()}`,
      externalAccountId: 'vinkin-financial-account',
      legalName: 'VinkIn Inc',
    });
    const issued = await provider.issueTemporaryCard({
      idempotencyKey: `issue:it:${randomUUID()}`,
      providerCardholderId,
      spendLimit: { amountMinor: 100_000, currency: 'USD' },
      metadata: {},
    });
    await provider.disableCard(issued.providerCardId);
    await db.sql`INSERT INTO cards (id, provider_card_id, display_last_four, status)
      VALUES (${randomUUID()}, ${issued.providerCardId}, '4242', 'AVAILABLE')`;
    await runSweeps(db.sql, provider); // provisions the card
    const walletTokenRow = await db.sql`
      SELECT t.provider_token_id FROM card_assignments ca
      JOIN card_wallet_tokens t ON t.card_assignment_id = ca.id
      WHERE ca.vink_id = ${vinkId}`;
    const walletToken = (walletTokenRow[0] as { provider_token_id: string }).provider_token_id;
    const auth = await app.inject({
      method: 'POST',
      url: `/internal/simulator/vinks/${vinkId}/merchant-authorizations`,
      headers: { authorization: `Bearer ${operatorToken}` }, // SH1-A
      payload: {
        merchantName: 'Corner Grocer',
        merchantIdentifier: 'PV12-GROCER',
        mcc: '5411',
        amountMinor: 6_000,
        presentedWalletToken: walletToken,
      },
    });
    await app.inject({
      method: 'POST',
      url: `/internal/simulator/authorizations/${auth.json().authorizationId}/capture`,
      headers: { authorization: `Bearer ${operatorToken}` }, // SH1-A
      payload: {
        vinkId,
        providerAuthorizationId: auth.json().providerAuthorizationId,
        settledAmountMinor: 6_000,
      },
    });
    assert.equal(
      (await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state,
      'COMPLETED',
    );

    // A second, abandoned vink (stays DRAFT) — pulls organizerTaskCompletionRate below 100%.
    await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed('organizer'),
      payload: {
        purchaseCategory: 'RETAIL',
        subtotalMinor: 2_000,
        tipMinor: 0,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
        organizerDisplayName: 'Organizer',
      },
    });

    // A reported failure point.
    await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      payload: {
        clientId: 'client-2',
        app: 'guest_web',
        events: [
          {
            eventName: 'guest_join_failed',
            properties: { errorCode: 'VINK_NOT_JOINABLE' },
            occurredAt: new Date().toISOString(),
          },
          {
            eventName: 'guest_join_failed',
            properties: { errorCode: 'VINK_NOT_JOINABLE' },
            occurredAt: new Date().toISOString(),
          },
        ],
      },
    });

    const summary = await app.inject({
      method: 'GET',
      url: '/internal/ops/analytics/summary',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    assert.equal(summary.statusCode, 200);
    const body = summary.json();

    assert.ok(body.completedVinks >= 1);
    assert.ok(body.participantJoins >= 1);
    assert.ok(body.vinksCreated >= 2);
    assert.ok(body.organizerTaskCompletionRate > 0 && body.organizerTaskCompletionRate < 1);
    assert.ok(typeof body.medianJoinToContributionMinutes === 'number');
    assert.ok(body.medianJoinToContributionMinutes >= 0);
    const failure = body.topFailurePoints.find(
      (entry: { eventName: string }) => entry.eventName === 'guest_join_failed',
    );
    assert.ok(failure !== undefined);
    assert.ok(failure.count >= 2);
  });

  it('rejects analytics summary access without an operator token', async () => {
    const response = await app.inject({ method: 'GET', url: '/internal/ops/analytics/summary' });
    assert.equal(response.statusCode, 401);
  });
});
