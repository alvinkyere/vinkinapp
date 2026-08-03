/**
 * Operations console backend end-to-end (PV11) — the exit gate ("every mock financial
 * event can be inspected and explained by an operator"), proven by driving a Vink through
 * funding → card → merchant purchase, then confirming an operator can find it, inspect
 * every table it touches, and that the two operator actions (merchant-authorization,
 * capture) are both effective and audited. Real PostgreSQL; VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { runSweeps } from './jobs/sweeps.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('operations console end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let provider: MockFinancialProvider;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let operatorToken: string;
  const stamp = Date.now();
  const users = { organizer: `pv11_org_${stamp}`, memberA: `pv11_a_${stamp}` };
  const tokens: Record<string, string> = {};

  function authed(who: keyof typeof users) {
    return { authorization: `Bearer ${tokens[who]}` };
  }
  function opAuthed() {
    return { authorization: `Bearer ${operatorToken}` };
  }

  async function fundedVink(): Promise<{ vinkId: string; publicCode: string }> {
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
    const publicCode = created.json().vink.publicCode as string;
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
    assert.equal((await db.sql`SELECT state FROM vinks WHERE id = ${vinkId}`)[0]!.state, 'FUNDED');
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
    const swept = await runSweeps(db.sql, provider);
    assert.ok(swept.cardsProvisioned >= 1);
    return { vinkId, publicCode };
  }

  async function walletTokenFor(vinkId: string): Promise<string> {
    const rows = await db.sql`
      SELECT t.provider_token_id FROM card_assignments ca
      JOIN card_wallet_tokens t ON t.card_assignment_id = ca.id
      WHERE ca.vink_id = ${vinkId}`;
    return (rows[0] as { provider_token_id: string }).provider_token_id;
  }

  before(async () => {
    db = await createIsolatedTestDb('ops');
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
    assert.equal(login.statusCode, 200);
    operatorToken = login.json().operatorToken as string;
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  it('rejects a wrong password and requires a token on every other ops route', async () => {
    const badLogin = await app.inject({
      method: 'POST',
      url: '/internal/ops/auth/login',
      payload: { operatorName: 'Someone', password: 'not-the-password' },
    });
    assert.equal(badLogin.statusCode, 401);

    const noToken = await app.inject({ method: 'GET', url: '/internal/ops/vinks' });
    assert.equal(noToken.statusCode, 401);

    const orgTokenRejected = await app.inject({
      method: 'GET',
      url: '/internal/ops/vinks',
      headers: authed('organizer'),
    });
    assert.equal(orgTokenRejected.statusCode, 401); // a regular user JWT is not an operator token
  });

  it('SH1-A: the reverse direction also fails closed — an operator token is not a user access token', async () => {
    // Structural, not just an application-level check: `verifyAccessToken` requires a
    // string `sub`/`sid`, and operator tokens carry neither (they carry `typ: 'operator'`/
    // `operatorName` instead — `auth/operator-tokens.ts`'s own header comment says this
    // works "vice versa" of the case above; this proves the vice versa, not just asserts it.
    const opTokenRejected = await app.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: opAuthed(),
    });
    assert.equal(opTokenRejected.statusCode, 401);
  });

  it('EXIT GATE: an operator finds a vink, inspects every table it touches, and every mock financial event is explained', async () => {
    const { vinkId, publicCode } = await fundedVink();

    // --- Search --------------------------------------------------------------
    const search = await app.inject({
      method: 'GET',
      url: `/internal/ops/vinks?publicCode=${publicCode}`,
      headers: opAuthed(),
    });
    assert.equal(search.statusCode, 200);
    const found = search.json().vinks as Array<{ id: string; organizerUsername: string }>;
    assert.equal(found.length, 1);
    assert.equal(found[0]!.id, vinkId);
    assert.equal(found[0]!.organizerUsername, users.organizer);

    const byOrganizer = await app.inject({
      method: 'GET',
      url: `/internal/ops/vinks?organizer=${users.organizer}`,
      headers: opAuthed(),
    });
    assert.ok((byOrganizer.json().vinks as unknown[]).length >= 1);

    // --- Merchant authorization + capture (the two operator actions) ---------
    const walletToken = await walletTokenFor(vinkId);
    const auth = await app.inject({
      method: 'POST',
      url: `/internal/ops/vinks/${vinkId}/merchant-authorizations`,
      headers: opAuthed(),
      payload: {
        merchantName: 'Corner Grocer',
        merchantIdentifier: 'PV11-GROCER',
        mcc: '5411',
        amountMinor: 6_000,
        presentedWalletToken: walletToken,
      },
    });
    assert.equal(auth.statusCode, 201);
    assert.equal(auth.json().outcome, 'APPROVED');
    const authorizationId = auth.json().authorizationId as string;
    const providerAuthorizationId = auth.json().providerAuthorizationId as string;

    const capture = await app.inject({
      method: 'POST',
      url: `/internal/ops/authorizations/${authorizationId}/capture`,
      headers: opAuthed(),
      payload: { vinkId, providerAuthorizationId, settledAmountMinor: 6_000 },
    });
    assert.equal(capture.statusCode, 200);
    assert.equal(capture.json().settlementStatus, 'MATCHED');
    assert.equal(capture.json().vinkState, 'COMPLETED');

    // --- Full inspection: every table a completed vink touches, all populated ----
    const detail = await app.inject({
      method: 'GET',
      url: `/internal/ops/vinks/${vinkId}`,
      headers: opAuthed(),
    });
    assert.equal(detail.statusCode, 200);
    const body = detail.json();
    assert.equal(body.vink.state, 'COMPLETED');
    assert.equal(body.organizer.username, users.organizer);
    assert.equal(body.participants.length, 2);
    assert.equal(body.contributions.length, 1);
    assert.equal(body.contributions[0].status, 'CAPTURED');
    // RM3B: this vink was provisioned from the card pool — the ops view's own dual-path
    // `card` row shows the pool's real shape (returned + sanitized after settlement teardown),
    // not the legacy `temporary_cards.status` field.
    assert.equal(body.card.assignment_status, 'RETURNED');
    assert.equal(body.card.provisioning_status, 'SANITIZED');
    assert.equal(body.purchaseAuthorizations.length, 1);
    assert.equal(body.purchaseAuthorizations[0].status, 'CAPTURED');
    assert.equal(body.settlements.length, 1);
    assert.equal(body.settlements[0].status, 'MATCHED');
    // The ledger is genuinely balanced and inspectable, not just non-empty.
    assert.ok(body.ledgerEntries.length > 0);
    const debits = body.ledgerEntries
      .filter((e: { direction: string }) => e.direction === 'DEBIT')
      .reduce((sum: number, e: { amount_minor: string }) => sum + Number(e.amount_minor), 0);
    const credits = body.ledgerEntries
      .filter((e: { direction: string }) => e.direction === 'CREDIT')
      .reduce((sum: number, e: { amount_minor: string }) => sum + Number(e.amount_minor), 0);
    assert.equal(debits, credits);
    assert.ok(body.outboxEvents.length > 0);
    assert.ok(body.stateHistory.length > 0);
    assert.equal(body.stateHistory.at(-1).to_state, 'COMPLETED');

    // --- Audit log: both actions attributed to the operator who took them --------
    const audit = await app.inject({
      method: 'GET',
      url: `/internal/ops/audit-log?vinkId=${vinkId}`,
      headers: opAuthed(),
    });
    assert.equal(audit.statusCode, 200);
    const entries = audit.json().entries as Array<{ operatorName: string; action: string }>;
    assert.equal(entries.length, 2);
    assert.ok(entries.every((entry) => entry.operatorName === 'Test Operator'));
    assert.deepEqual(entries.map((entry) => entry.action).sort(), [
      'CAPTURE',
      'MERCHANT_AUTHORIZATION',
    ]);
  });

  it('404s on an unknown vink', async () => {
    const detail = await app.inject({
      method: 'GET',
      url: '/internal/ops/vinks/00000000-0000-4000-8000-000000000000',
      headers: opAuthed(),
    });
    assert.equal(detail.statusCode, 404);
  });
});
